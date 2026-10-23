# EigenRoll — BTI DS 2022 - 28

Single-batch smartboard attendance with local face detection and PCA + regularized LDA recognition. Django stores the shared student roster and face samples in Postgres. The direct attendance screen reads the current batch names, SAP IDs and recognition vectors; enrollment photographs, pending submissions, historical sessions and all batch edits remain behind teacher management.

## Classroom workflow

Bookmark https://ai-attendance-taker.vercel.app/ on the smartboard. Select **Open camera** directly (no teacher access key), allow access, and select a classroom-facing camera if multiple cameras are available. Select **Take photo** to see present names and SAP IDs. Capture more classroom sections as needed; students are counted only once. Check uncertain faces and correct individual marks.

**Clear results** starts over. Results remain in the current tab's memory. No lecture, subject, timetable, automatic batch detection, saved attendance, or history is created. Refreshing or signing out clears attendance results. Existing historical data is retained privately.

**Use phone camera** is optional. The smartboard creates a private 15-minute QR connection. The phone sends detected face crops and vectors through Django; the board performs recognition and acknowledges receipt. Received payloads are cleared after acknowledgement. Closing pairing deletes the relay session. Expired sessions cannot be accessed and are cleaned up when another pairing is created. The phone never receives the student roster, templates, or teacher credentials.

## Registrations

The active class ID is `classroom`, displayed as **BTI DS 2022 - 28**. Submitted IDs are preserved; non-11-digit identifiers are flagged under **Manage batch** for correction. New registrations require approval. A missing or stale recognition model is trained in a Web Worker. Rebuild recognition after changing face samples.

The home page offers **Take attendance** (`?page=attendance`) and **Student registration** (`?page=register`); neither asks for a key. Registration saves the student straight into the roster and computes their class-photo features on their own device, and the board rebuilds its recognition model from the roster each time it opens (about a second), so a new student is recognised from the next capture. The board receives names, SAP IDs and face features but never enrolment photos. The teacher page (`?page=manage`, not linked from the home page) still asks for the key; opening it once fills in class-photo features for students registered before they existed.

## Recognition and limitations

Classroom photos use a group face detector (SSD MobileNet v1 from the pinned face-api package) that scans the full frame and two scales of overlapping tiles, so small back-row faces are found. MediaPipe's short-range BlazeFace, which only sees faces near the camera, is still used for enrollment selfies. On a synthetic classroom test (six group photos tiled into one frame, 23 faces), detection went from 1/23 to 22/23 at 1080p and from 3/23 to 22/23 at 4K. Identity features are computed from a sharper crop of up to 224 px taken from the original photo.

After a capture, the board shows **X of N present** and **Y absent** against the registered batch, with a progress bar while the photo is scanned.

### Tested on the registered students

Measured on the 26 registered students using 472 of their enrolment photos that the model never trained on, placed in 60-person class photos (6 rows, faces 110 px at the front down to 32 px at the back, with 34 strangers):

| Class photo | Marked automatically | One-tap confirmations | Missed | Wrong student / stranger marked |
|---|---|---|---|---|
| Clear, all 26 present | 20 | 6 | 0 | 0 / 0 |
| Dark and slightly soft, 20 present | 13 | 5 | 2 | 0 / 0 |
| 35% of faces blurred, 23 present | 17 | 3 | 3 | 0 / 0 |

Before these changes the same photos gave 18/26, 11/20 and 15/23. What changed: a finer scan for 12 MP+ photos, face detection on a brightened copy of dark photos, a class-style gallery entry for each gallery photo (built when the teacher presses **Rebuild recognition**), and recognising faces down to 22 px. Faces smaller than 32 px are only ever suggested, never marked automatically, because 1 of 416 unregistered look-alike tests at that size matched someone. These photos are composed from enrolment selfies, so real classrooms (angles, people blocking each other) can do worse; strangers were occasionally offered as one-tap suggestions (1–3 per photo), so check the face before tapping **Yes**.

### Big classes, several photos and video

A class photo can hold 60+ people; only registered students can be named, and everyone else is left alone.

- **Photos:** take one photo, or 2–3 (left, middle, right) for a large room. Every capture is combined and no student is counted twice.
- **Video:** record up to 20 s on the board (or upload up to 60 s). About one frame per second is scanned; each face is followed across frames by position, with camera-pan compensation and a small appearance check so neighbouring seats are not confused. Each person's identity features are averaged over their three largest views, then recognised once. Someone who leaves the view and comes back is not treated as a conflict.
- **Phone:** a phone capture can now send up to 150 faces (it previously stopped at 40).
- **Faces from 32 px wide are recognised** (was 45 px). Classroom faces use the full 68-point landmark model and are averaged with their mirror image; enrolment features are unchanged, so no one needs to re-register.

After a capture:
- **Confirm these students**: one card per likely student who was not certain enough to mark automatically, with how many separate captures agreed (for example "Seen in 4 photos"). One tap marks them present. A student who is the likely match in several photos is listed first.
- **Other faces not recognised** are folded away (usually unregistered students or visitors) and can be opened to name anyone.
- Faces that look like a student already present are hidden automatically.

**Measured on labelled photos** (8 people enrolled from 5 portraits each, alongside the 26 real students; tested on 5 different group photos of them, crowd photos of about 45 strangers, a 12 MP class photo of 83 faces, and a panning class video):

| Scenario | Marked automatically | One-tap confirmations | Missed | Wrong student marked |
|---|---|---|---|---|
| 5 separate group photos combined (7 people present) | 5 of 7 | 2 (seen in 3–4 photos) | 0 | 0 |
| One 12 MP photo, 7 enrolled among 75 strangers | 4 | 2 | 1 | 0 |
| 10 s panning video, 7 enrolled among ~100 strangers | 5 | 1 | 1 | 0 |
| Strangers (121 faces) | 0 accepted | 8 offered as suggestions | – | 0 |

Per face, the new classroom features doubled automatic matches on the group photos (5 → 10 of 22) with no wrong students. Linking unknown faces across photos by similarity alone was rejected: in testing it would have marked an unregistered classmate as someone else, so cross-photo agreement is shown to the teacher instead of being auto-marked.

Results are kept on the device for the rest of the day, so a refresh does not lose them. **Download CSV** exports name, SAP ID, status and how each student was marked; **Copy absent list** copies a ready-to-paste list; **Start new attendance** clears the screen for the next class.

Recognition is now hybrid: local MediaPipe detection and face alignment, pretrained 128-dimensional identity features from the pinned face-api package, followed by 32-component PCA and regularized LDA. A compact gallery keeps up to eight diverse samples per student. A match needs two close gallery neighbors, an absolute distance limit, a clear margin over the next identity, and agreement with PCA/LDA. A face is also accepted when it is within 0.47 of a student who is clearly ahead of everyone else (ratio ≤ 0.75, margin ≥ 0.12) and PCA/LDA agrees. On the class's 208 enrolment templates (leave-one-out and leave-one-student-out) this added correct matches with 0 wrong students and 0 unregistered faces accepted; on a synthetic group photo it raised automatic matches of enrolled people from 3 to 6 of 17, with 0 of 22 strangers accepted or suggested. In one photo, each student is given to at most one face: if two faces match the same student, the clearly closer one keeps the match and the rest go to review. The pixel-based Eigenface/Fisherface model remains available as the baseline implementation; the enhanced engine does not silently fall back to it when identity features are missing.

Recognition weights are copied from the installed package and served from this application. Only landmark and identity networks are loaded. Captures are processed on the device, and phone captures are transferred only to the connected board. New registrations include identity features. Manage batch can rebuild both models from stored samples; classmates do not need to register again for this upgrade.

Enrollment-session diagnostic: 26 students / 680 samples. With every fifth image held out, the baseline recognized 83/132 correctly and the enhanced model recognized 119/132; neither assigned a wrong identity in that set. Five identity-exclusion folds tested 680 images with their student absent from training; the enhanced model rejected all 680. These are development diagnostics from the same registration sessions, not independent classroom accuracy or a universal false-match guarantee. See `research/recognition-enrollment-evaluation.json`.

Classroom accuracy remains unmeasured. Hidden, blurred, distant, or side-on faces may require another capture or manual correction. This is not liveness verification. Unknown, low-quality, duplicate, or ambiguous matches remain unconfirmed and do not assign absences.

## Startup performance

The attendance screen renders while the current batch loads. One compact snapshot request supplies the roster, sample counts, and saved recognition model; photos and training vectors are omitted. A missing or stale model still loads the training samples through the original endpoint. Camera detection, phone pairing, registration, and batch management load on demand. API responses use gzip when supported and remain uncached.

## Development and verification

```bash
npm ci
python -m pip install -r requirements.txt
python build.py
python manage.py runserver
```

For frontend development, use `npm run dev`. Build with `python build.py` before Django tests; it injects runtime configuration and collects model/WASM assets.

```bash
npm test
python build.py
python manage.py test
```

Existing server variables: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EIGENROLL_SERVER_TOKEN`, `EIGENROLL_TEACHER_PASSWORD`. Never expose server credentials to clients. `database/phone_capture.sql` adds the private relay table to an existing database; the initial gateway setup is in `database/schema.sql`. Relay access uses the existing server-only RLS helper.

Deploy to the existing Django Vercel project. Do not commit student data, private models, or credentials.

