import {diverse, GALLERY_PER_STUDENT, CLASS_STYLE_SIZES} from './identity';
import {describeAsSeenInClass} from './embeddings';

/** A student's most varied enrolment photos, described as they look small and far away in a class photo.
 *  Computed once (at registration, or on the teacher page for older records) and stored with the student. */
export async function classroomFeatures(faces: {image: string; embedding: number[]}[], onProgress?: (done: number, total: number) => void) {
  const picks = diverse(faces.map(f => f.embedding), GALLERY_PER_STUDENT).flatMap(i => CLASS_STYLE_SIZES.map(px => ({image: faces[i].image, px})));
  const out: number[][] = [];
  for (const [n, p] of picks.entries()) {
    onProgress?.(n, picks.length);
    try { out.push((await describeAsSeenInClass(p.image, p.px)).map(v => Math.round(v * 1e5) / 1e5)); } catch { /* unusable photo */ }
  }
  return out;
}
