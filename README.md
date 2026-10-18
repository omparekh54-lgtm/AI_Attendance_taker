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

MediaPipe face detection uses overlapping tiles for classroom photos. Eye-based alignment and grayscale normalization produce 576-dimensional vectors, reduced through 16 PCA components and regularized LDA. Distance and ambiguity thresholds reject uncertain identities. Two faces matching the same identity within one photograph both require review. One clear image can suggest attendance; multiple images merge results.

Actual classroom-photo accuracy has not been measured. Enrollment-session holdouts are diagnostics, not classroom benchmarks. Hidden, blurred, distant, or side-on faces may require a closer capture or manual correction. This is not liveness verification.

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

