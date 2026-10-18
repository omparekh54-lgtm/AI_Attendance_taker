# EigenRoll — BTI DS 2022 - 28

Single-batch smartboard attendance with local face detection and PCA + regularized LDA recognition. Django stores the shared student roster and face samples in Postgres. The direct attendance screen reads the current batch names, SAP IDs and recognition vectors; enrollment photographs, pending submissions, historical sessions and all batch edits remain behind teacher management.

## Classroom workflow

Bookmark https://ai-attendance-taker.vercel.app/ on the smartboard. Select **Open camera** directly (no teacher access key), allow access, and select a classroom-facing camera if multiple cameras are available. Select **Take photo** to see present names and SAP IDs. Capture more classroom sections as needed; students are counted only once. Check uncertain faces and correct individual marks.

**Clear results** starts over. Results remain in the current tab's memory. No lecture, subject, timetable, automatic batch detection, saved attendance, or history is created. Refreshing or signing out clears attendance results. Existing historical data is retained privately.

**Use phone camera** is optional. The smartboard creates a private 15-minute QR connection. The phone sends detected face crops and vectors through Django; the board performs recognition and acknowledges receipt. Received payloads are cleared after acknowledgement. Closing pairing deletes the relay session. Expired sessions cannot be accessed and are cleaned up when another pairing is created. The phone never receives the student roster, templates, or teacher credentials.

## Registrations

The active class ID is `classroom`, displayed as **BTI DS 2022 - 28**. Submitted IDs are preserved; non-11-digit identifiers are flagged under **Manage batch** for correction. New registrations require approval. A missing or stale recognition model is trained in a Web Worker. Rebuild recognition after changing face samples.

The root URL opens the attendance camera screen directly. Batch management remains protected at `?page=manage`. Open `?page=register` to enroll. Existing `?invite=...` registration links continue working. Only registered students can be recognized. **Not detected does not mean absent.**

## Recognition and limitations

Recognition is now hybrid: local MediaPipe detection and face alignment, pretrained 128-dimensional identity features from the pinned face-api package, followed by 32-component PCA and regularized LDA. A compact gallery keeps up to eight diverse samples per student. A match needs two close gallery neighbors, an absolute distance limit, a clear margin over the next identity, and agreement with PCA/LDA. The pixel-based Eigenface/Fisherface model remains available as the baseline implementation; the enhanced engine does not silently fall back to it when identity features are missing.

Recognition weights are copied from the installed package and served from this application. Only landmark and identity networks are loaded. Captures are processed on the device, and phone captures are transferred only to the connected board. New registrations include identity features. Manage batch can rebuild both models from stored samples; classmates do not need to register again for this upgrade.

Enrollment-session diagnostic: 26 students / 680 samples. With every fifth image held out, the baseline recognized 83/132 correctly and the enhanced model recognized 119/132; neither assigned a wrong identity in that set. Five identity-exclusion folds tested 680 images with their student absent from training; the enhanced model rejected all 680. These are development diagnostics from the same registration sessions, not independent classroom accuracy or a universal false-match guarantee. See `research/recognition-enrollment-evaluation.json`.

Classroom accuracy remains unmeasured. Hidden, blurred, distant, or side-on faces may require another capture or manual correction. This is not liveness verification. Unknown, low-quality, duplicate, or ambiguous matches remain unconfirmed and do not assign absences.

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

