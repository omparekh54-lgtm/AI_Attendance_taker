# EigenRoll

**Attendance, in focus.** A local-first classroom attendance web application served by Django with a React/TypeScript interface, using PCA and regularized LDA recognition implemented from scratch.

## Features

- Class management, individual registration and roster CSV import (`roll,name`).
- Student face registration via camera or photo upload; up to 30 samples, at least five per student and two students to train.
- Local MediaPipe face detection, eye-based alignment, grayscale normalization, 24×24 face vectors.
- PCA using deflated power iteration and regularized Fisher LDA using a Jacobi eigensolver, in a Web Worker.
- Distance matching with unknown/ambiguity rejection and repeated-observation aggregation.
- Classroom photos, multiple photo uploads, camera video recording and uploaded video processing.
- Teacher review: unresolved students must be explicitly marked, not silently made absent.
- Confirmed lecture history, manual corrections with an audit trail, CSV reports.
- IndexedDB persistence and JSON backup/restore. No server receives student face images.
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

The postinstall script copies MediaPipe WASM into `public/wasm`. The face detector model is included in the repository; if missing, it downloads Google's official model. No AI API key, account or database service is required.

Vercel settings: **Django** framework, `python build.py`, repository root, and no custom output directory. `manage.py` and `pyproject.toml` identify the WSGI entrypoint. Vercel serves `/static/` through its CDN and routes pages/API requests through Django. The deployment contains application assets only, never registered student data.

Django owns the application document and safe JSON runtime configuration. `/api/health` identifies the Django backend and `/api/config` provides read-only recognition/capture settings. Recognition still runs in a browser Web Worker; this framework conversion does not move student biometrics to the server. There is no server ORM persistence or teacher account system.

Netlify does not natively provide a Python/Django function runtime. A static-only Netlify deployment would not satisfy the Django-hosting requirement; do not use it as a substitute without arranging a separate Django host.

Optional environment variables: `DJANGO_SECRET_KEY` (persistent private key if signed sessions/auth are added), `DJANGO_ALLOWED_HOSTS` (comma-separated custom domains), `DJANGO_DEBUG=1` for local diagnostics only. Vercel-provided deployment domains are allowlisted automatically. No secret is committed. Without a configured secret, this stateless app generates an ephemeral process key; no signed sessions are used.

## Teacher workflow

1. Create a class.
2. Import the roster CSV or add students manually.
3. Obtain permission and collect varied face samples for each student. Aim for 20–30 across different capture sessions and lighting. The five-sample minimum is only a technical minimum.
4. Train the class model. Changes to registration invalidate the model and require retraining.
5. Select the subject/lecture, capture several sections, or record/upload a short slow video. Multiple clear observations are required for suggested presence.
6. Check every unresolved student and explicitly mark present/absent.
7. Confirm attendance. Export CSV or back up the complete workspace.

## Storage and privacy

All workspace data, face crops, feature vectors, model versions, and attendance records are stored in the current browser's IndexedDB. They are **not synchronized across devices** and are not protected by a server login. Use a trusted, password-protected device/browser profile. Clearing browser data can delete the workspace. JSON backups contain biometric samples; store them privately. Data import replaces the workspace after confirmation.

No raw classroom video is retained after processing. Student templates are retained for recognition. No background face scanning occurs. Manual attendance remains available.

## Recognition limitations

This is an academic, teacher-supervised implementation, not a validated biometric security product. Accuracy has **not** been measured on a real classroom dataset. PCA/LDA on grayscale faces is sensitive to pose, lighting, occlusion and scale. A short-range detector may miss small faces: capture closer classroom sections. Unknown rejection thresholds are heuristics derived from training distances and must be calibrated on independently captured validation data before relying on automatic matches. Similar appearances and unfamiliar faces can still be misclassified. Multiple video frames are correlated, and repeated matches do not establish liveness or prevent photograph spoofing.

The app samples approximately 1.7 video frames per second, uses the first 60 seconds, accepts videos up to 200 MB and images up to 30 MB. Minimum face crop size is 45 pixels. Matching requires a best/second-best distance ratio below 0.72 and a class-specific distance limit. Detection is an imported pretrained model; recognition math is our TypeScript implementation. YOLO is a future detector comparison, not falsely claimed as implemented here.

## Evaluation

Five Django tests cover rendering, health/config routes, safe runtime configuration, static WASM/model packaging and invalid route handling. Browser checks on the actual Django server cover CSV import, persistence, real-image face detection, teacher review, saving attendance, audited corrections and mobile layout. Five recognition/data tests cover synthetic class separation and unknown-pattern rejection, PCA orthonormality, model serialization, input validation and spreadsheet-safe CSV. These tests demonstrate implementation behavior, **not face-recognition accuracy**. Evaluate with students and unknown people from separate capture days; never split adjacent video frames into train/test. Report false attendance, misses, unknown acceptance/rejection, and CPU processing time.

## Model provenance

MediaPipe Tasks Vision by Google: https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector
Detector model: https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite

MediaPipe is Apache-2.0 licensed. Its notices are included under `THIRD_PARTY_NOTICES.md`.
