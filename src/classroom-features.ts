import {diverse, GALLERY_PER_STUDENT, CLASS_STYLE_SIZES} from './identity';
import {describeAsSeenInClass, describeFaceWithPose} from './embeddings';
import {TURNED_FACE_YAW} from './face-geometry';

/** Bumped when the class-photo features gain something new, so the teacher page refreshes older records.
 *  3: also described at 36 px (low-resolution class photos). 4: also at 24 px (back rows). 5: each feature's size is
 *  stored (classroomPx), so 24 px features can mark only small faces. */
export const CLASSROOM_VERSION = 5;
/** Turned (side) views per direction that also become class-photo references. */
export const TURNED_PER_SIDE = 3;
export const MAX_CLASSROOM_FEATURES = GALLERY_PER_STUDENT * CLASS_STYLE_SIZES.length + 2 * TURNED_PER_SIDE;

async function yawOf(image: string) {
  const img = new Image(); img.src = image; await img.decode();
  return (await describeFaceWithPose(img)).yaw;
}

/** Which photos to use: the most varied ones, plus the most clearly turned views to each side.
 *  A face seen from the side in class looks different enough that it needs side references of its own. */
export function classroomPicks(faces: {embedding: number[]; yaw?: number}[]) {
  const picks = diverse(faces.map(f => f.embedding), GALLERY_PER_STUDENT);
  const chosen = new Set(picks);
  const turned = (sign: 1 | -1) => faces.map((f, i) => ({i, yaw: (f.yaw ?? 0) * sign}))
    .filter(f => f.yaw >= TURNED_FACE_YAW && !chosen.has(f.i)).sort((a, b) => b.yaw - a.yaw).slice(0, TURNED_PER_SIDE).map(f => f.i);
  return {frontal: picks, turned: [...turned(1), ...turned(-1)]};
}

/** A student's enrolment photos described as they look small and far away in a class photo.
 *  Computed once (at registration, or on the teacher page for older records) and stored with the student. */
export async function classroomFeatures(faces: {image: string; embedding: number[]; yaw?: number}[], onProgress?: (done: number, total: number) => void) {
  const posed: {image: string; embedding: number[]; yaw: number}[] = [];
  for (const f of faces) {
    let yaw = f.yaw;
    if (typeof yaw !== 'number') { try { yaw = await yawOf(f.image); } catch { yaw = 0; } }
    posed.push({...f, yaw});
  }
  const {frontal, turned} = classroomPicks(posed);
  const jobs = [...frontal.flatMap(i => CLASS_STYLE_SIZES.map(px => ({image: posed[i].image, px}))), ...turned.map(i => ({image: posed[i].image, px: CLASS_STYLE_SIZES[0]}))];
  const out: number[][] = [], sizes: number[] = [];
  for (const [n, p] of jobs.entries()) {
    onProgress?.(n, jobs.length);
    try { out.push((await describeAsSeenInClass(p.image, p.px)).map(v => Math.round(v * 1e5) / 1e5)); sizes.push(p.px); } catch { /* unusable photo */ }
  }
  return {classroom: out, classroomPx: sizes, yaws: posed.map(f => f.yaw)};
}

/** Class-photo features for newly added side views only (the straight-on ones are already stored). */
export async function turnedClassroomFeatures(faces: {image: string; yaw?: number}[], onProgress?: (done: number, total: number) => void) {
  const pick = (sign: 1 | -1) => faces.filter(f => (f.yaw ?? 0) * sign >= TURNED_FACE_YAW).sort((a, b) => (b.yaw ?? 0) * sign - (a.yaw ?? 0) * sign).slice(0, TURNED_PER_SIDE);
  const jobs = [...pick(1), ...pick(-1)], out: number[][] = [];
  for (const [n, f] of jobs.entries()) {
    onProgress?.(n, jobs.length);
    try { out.push((await describeAsSeenInClass(f.image, CLASS_STYLE_SIZES[0])).map(v => Math.round(v * 1e5) / 1e5)); } catch { /* unusable photo */ }
  }
  return out;
}
