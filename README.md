# EigenRoll

**Attendance, in focus.** A shared classroom attendance web application served by Django with a React/TypeScript interface, using PCA and regularized LDA recognition implemented from scratch.

## Features

- Class management, individual registration and roster CSV import (`roll,name`).
- Student face registration via camera or photo upload; up to 30 samples, at least five per student and two students to train.
- Local MediaPipe face detection, eye-based alignment, grayscale normalization, 24×24 face vectors.
- PCA using deflated power iteration and regularized Fisher LDA using a Jacobi eigensolver, in a Web Worker.
- Distance matching with unknown/ambiguity rejection and repeated-observation aggregation.
- Classroom photos, multiple photo uploads, camera video recording and uploaded video processing.
- Teacher review: unresolved students must be explicitly marked, not silently made absent.
- Confirmed lecture history, manual corrections with an audit trail, CSV reports.
- Guided self-registration, teacher approval, shared Postgres persistence and JSON backup/restore.
- Responsive desktop/mobile interface and camera permission/error handling.

## Run

```sh
python -m venv .venv
# Activate .venv using the command for your operating system.
python -m pip install -r requirements.txt
python build.py
python manage.py runserver
```

Verification:

```sh
python manage.py test eigenroll_server
npm test
```

Open http://127.0.0.1:8000 after running Django. `python build.py` installs the browser dependencies, builds the interface, produces the Django template, and collects static files. `npm run dev` is a frontend development preview only; it is not the production Django server.

The postinstall script copies MediaPipe WASM into `public/wasm`. The face detector model is included in the repository; if missing, it downloads Google's official model. No paid AI API is used. Shared enrollment requires a configured database and private teacher access key.

Vercel settings: **Django** framework, `python build.py`, repository root, and no custom output directory. `manage.py` and `pyproject.toml` identify the WSGI entrypoint. Vercel serves `/static/` through its CDN and routes pages/API requests through Django. Registered student data is stored in the separate database, not in deployment artifacts.

Django owns application rendering, runtime configuration, teacher authentication and the shared-storage API. Recognition still runs in a browser Web Worker.

Netlify does not natively provide a Python/Django function runtime. A static-only Netlify deployment would not satisfy the Django-hosting requirement; do not use it as a substitute without arranging a separate Django host.

Optional configuration: `DJANGO_ALLOWED_HOSTS` for custom domains and `DJANGO_DEBUG=1` for local diagnostics. Production enrollment requires the private environment configuration documented below; without it, submission remains disabled.

## Teacher workflow

1. Sign in as teacher, then select the default classroom or create a class.
2. Share the main registration page (default class) or generate a signed class link. You can also import the roster CSV or add students manually.
3. Review and approve classmates’ submissions, or collect face samples manually. Aim for 20–30 across different capture sessions and lighting. The five-sample minimum is only a technical minimum.
4. Train the class model. Changes to registration invalidate the model and require retraining.
5. Select the subject/lecture, capture several sections, or record/upload a short slow video. Multiple clear observations are required for suggested presence.
6. Check every unresolved student and explicitly mark present/absent.
7. Confirm attendance. Export CSV or back up the complete workspace.

## Storage and privacy

Submitted face crops, vectors, models and attendance are stored in the private shared Postgres workspace. Student registration does not provide access to other students' data. Teacher authentication is required to retrieve records. Backups contain biometric data; store them privately. The old browser workspace is retained for backup migration.

No raw classroom video is retained after processing. Student templates are retained for recognition. No background face scanning occurs. Manual attendance remains available.

## Recognition limitations

This is an academic, teacher-supervised implementation, not a validated biometric security product. Accuracy has **not** been measured on a real classroom dataset. PCA/LDA on grayscale faces is sensitive to pose, lighting, occlusion and scale. A short-range detector may miss small faces: capture closer classroom sections. Unknown rejection thresholds are heuristics derived from training distances and must be calibrated on independently captured validation data before relying on automatic matches. Similar appearances and unfamiliar faces can still be misclassified. Multiple video frames are correlated, and repeated matches do not establish liveness or prevent photograph spoofing.

The app samples approximately 1.7 video frames per second, uses the first 60 seconds, accepts videos up to 200 MB and images up to 30 MB. Minimum face crop size is 45 pixels. Matching requires a best/second-best distance ratio below 0.72 and a class-specific distance limit. Detection is an imported pretrained model; recognition math is our TypeScript implementation. YOLO is a future detector comparison, not falsely claimed as implemented here.

## Evaluation

Fourteen Django tests cover authentication, signed invitations, CSRF, enrollment validation, revisions, rendering, health/config routes, safe runtime configuration, static WASM/model packaging and invalid route handling. Browser checks on the actual Django server cover real-image face detection, the sample minimum, registration details/consent, submission and approval across independent browser sessions, duplicate rejection, student access isolation, persistence and mobile layout. The enrollment API portion uses synthetic samples; it is not an accuracy evaluation. Earlier attendance checks covered CSV import, saving lectures and audited corrections. Five recognition/data tests cover synthetic class separation and unknown-pattern rejection, PCA orthonormality, model serialization, input validation and spreadsheet-safe CSV. These tests demonstrate implementation behavior, **not face-recognition accuracy**. Evaluate with students and unknown people from separate capture days; never split adjacent video frames into train/test. Report false attendance, misses, unknown acceptance/rejection, and CPU processing time.

## Model provenance

MediaPipe Tasks Vision by Google: https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector
Detector model: https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite

MediaPipe is Apache-2.0 licensed. Its notices are included under `THIRD_PARTY_NOTICES.md`.

## Shared student registration (Django + Supabase)

The main page is **Enter your data**. Students provide their name and roll, give permission, capture 20–30 varied face samples (guided camera or photo uploads), review and submit. A private teacher workspace reviews pending submissions, approves them into the roster and trains that class's PCA/LDA model. Registration does not automatically mark attendance.

Create a dedicated Supabase project. Apply `database/schema.sql` after substituting `SERVER_TOKEN_SHA256` with the SHA256 of a cryptographically random server token. Seed an entity with ID `classes:classroom`, kind `classes`, payload `{"id":"classroom","name":"Our classroom"}`. Add these **server-only** Vercel production environment variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `EIGENROLL_SERVER_TOKEN`, `EIGENROLL_TEACHER_PASSWORD`, `DJANGO_SECRET_KEY`. Never use a `VITE_` prefix for secrets or commit credential files. All five are required before public submissions or teacher sign-in are enabled. Redeploy after configuring.

Django handles CSRF protection, signed HttpOnly teacher sessions (8 hours), 30-day signed class invites, validation, duplicate rolls, hourly attempt limits and teacher-only paginated reads/writes. The Supabase publishable key alone cannot access records: every table has RLS requiring the additional server token. The token never reaches students or teachers' browsers. No security-definer database functions are used. Face samples, pending registrations, class models and attendance are stored in Postgres as JSON records. Each teacher record is saved separately with optimistic revision checks; a whole multi-record workspace save is not atomic. Reopen the workspace after a conflict. The Data & privacy page can export the previous IndexedDB workspace on the same browser. Review that backup, then restore it after teacher sign-in. Teacher access key rotation requires changing the environment key and `DJANGO_SECRET_KEY` together to invalidate existing sessions; issue new class links afterward. The default classroom enrollment link is refreshed by Django for visitors.

## Public dataset training and evaluation

`research/olivetti-model.json` is a trained **research baseline** using the same TypeScript PCA/LDA implementation. It is not used as the classroom roster. `research/olivetti-benchmark.json` documents a fixed, independent test split: 224 training crops from 32 people; 96 known test crops; 80 crops from 8 unseen people. See `public/benchmark.json` for the published report. Reproduce with `python scripts/prepare_olivetti.py /tmp/olivetti.json` and `node --import tsx scripts/benchmark.ts /tmp/olivetti.json` (Python: scikit-learn, numpy, Pillow required only for research).

On this split, forced nearest-identity accuracy was 93/96 (96.875%), but the app's cautious open-set rules automatically accepted just 20/96 known crops, all correct, and rejected all 80 unknown crops. This low acceptance rate matters: this is **not** a measured 96.875% automatic attendance rate. Dataset crops skip classroom detection, alignment and camera conditions. Thresholds are heuristic, not validated for classroom deployment. Classmate samples are still required to learn their identities. Students should collect varied views and teachers must review recognition suggestions.
