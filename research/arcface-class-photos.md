# ArcFace engine — measurements on the real class (2 November 2026)

Data: the 27 registered students of BTI DS 2022 - 28 (20–30 registration crops each, 96×96 px) and two real group
photos taken on 30 October 2026, received as WhatsApp copies (1280×960). Photo 1: 19 people standing in a lecture
hall, faces 18–30 px wide. Photo 2: about 20 people in a lab, faces 28–53 px wide. Both include teachers and guests
who are not registered.

Pipeline: SCRFD-10G detector (whole photo + 2× tiles) → 5-point alignment to ArcFace's 112×112 template → ArcFace
ResNet-50 (WebFace600K), averaged with the mirror image. A face's score for a student is the mean cosine similarity of
its 3 closest gallery features. The prototype (Python, onnxruntime) and the browser code agree to cosine 0.995 on the
same crops.

## Detection

SCRFD found 18 faces in each photo with no false detections. The people it missed are mostly hidden behind someone.

## Scores in the real photos

| | Photo 1 (18–30 px) | Photo 2 (28–53 px) |
|---|---|---|
| Faces matching a student (visually checked) | 0.35–0.62, next student 0.21–0.41 | 0.39–0.71, next student 0.20–0.37 |
| Everyone else (teachers, guests, unclear) | at most 0.29 | at most 0.27 |

The old engine (face-api 128-D) on the same photos marked 0 / 3 students automatically.

## Classmates as stand-in strangers (registration crops, leave-one-out)

| Query size | same person, 1st percentile | different person, 99.9th percentile | max |
|---|---|---|---|
| full | 0.667 | 0.372 | 0.428 |
| shrunk to 36 px | 0.647 | 0.395 | 0.443 |
| shrunk to 24 px | 0.549 | 0.418 | 0.473 |

Same-person scores between registration crops are optimistic (same session); in the class photos the same people
scored 0.35–0.71. Closest pairs: Snigdha Mishra ↔ Kritika Singh (98th percentile 0.45), Himanshu Thakkar ↔ Shayan
Mandrekar (0.42), Om Parekh ↔ Calvin Dsouza (0.40), Oqba Momin ↔ Jash Visaria (0.39). This is why each student's
bar is set from their own closest classmates (98th percentile + 0.06, within 0.36–0.52) instead of one global value.

## PCA + LDA on ArcFace features

PCA (64 components) + regularised LDA, trained on the gallery, chose the same student as ArcFace for every confident
match in both photos. For strangers it still names someone, often with a high LDA similarity, so it is used as an
agreement check (a vote on who), not to decide whether a face is registered.

## Model size

ArcFace R50 is 174 MB. Weight-only 8-bit (per-output-channel scales, `DequantizeLinear` in front of each weight,
opset 13) is 44 MB, runs in onnxruntime-web's WebAssembly build, and gives features with cosine ≥ 0.9997 to the
full model on the class-photo faces (no top match changed). Dynamic 8-bit quantization (`ConvInteger`) is not
supported by onnxruntime-web and drifted more (0.955 on noise).

## Gallery size

Using the 16 most varied crops per student (chosen with their existing features) instead of all of them lowered the
best scores in the photos by about 0.015 on average and changed no confident match.

## Far faces: labelled test and steps 1–2 (2 November 2026, afternoon)

Every face in both photos was labelled by hand (20 registered students, 16 teachers/guests, no registered student
missed by the detector). Baseline with the app as deployed: 17 of 20 students marked, 2 offered to confirm, 1 missed,
0 wrong names, 0 teachers/guests named or offered. The app's first choice was the right student for all 20; the three
not marked were 19–24 px wide and scored 0.33–0.35 against bars of 0.36. The highest teacher/guest score was 0.295.

Experiments (Python prototype mirroring the app; relative changes):

| Change | Effect on the hard far faces | Kept |
|---|---|---|
| Landmarks measured again on a 3× enlarged crop (faces < 40 px) | lead of the hardest face 0.059 → 0.074 (now offered); others ±0.01 | yes |
| Jittered reading (8–16 shifted/scaled/rotated reads averaged) | ±0.005, no decision changed | no (slower, no gain) |
| Gallery + 18 px copies | Aagam 0.33 → 0.40, marked; teacher/guest max 0.29 → 0.32, still below every bar | yes |
| Gallery: 24/18 px with blur | mixed (one student down to 0.36) | no |
| Gallery: WhatsApp-style double JPEG | mixed | no |
| Gallery: darker/brighter copies | one student lost its lead | no |
| Gallery: all crops instead of 16 | ≈ no change | no |

Browser check with the app's own code after porting both kept changes (galleries rebuilt through the teacher page):
18 of 20 students marked, 2 offered to confirm (0.35, 0.36), 0 missed, 0 wrong, 0 teachers/guests named or offered.
Highest teacher/guest score 0.338 (lead 0.067), below every bar.

Also fixed while rebuilding: with 64 gallery features per student, PCA/LDA training passed ~100,000 values to
`Math.min(...)` and overflowed the call stack; the limit calculation now uses a loop (test: a full 27-student class).
