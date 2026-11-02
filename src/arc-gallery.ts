import {landmarksInCrop, alignFace, degradeAligned, arcEmbed, packFeature} from './arcface';
import {diverse} from './identity';

/** Bumped when the gallery recipe changes, so the teacher page rebuilds older records. */
export const ARC_VERSION = 1;
/** Registration crops kept per student. On the real class photos, 16 of ~25 crops kept the scores within 0.01–0.02
 *  of using every crop, at two thirds of the work (this runs on students' phones at registration). */
export const ARC_CROPS_PER_STUDENT = 16;
/** Face widths (px) at which each kept crop is also described as seen in a class photo. On the real class photos the
 *  students' faces were 18–53 px wide. */
export const ARC_CLASS_SIZES = [36, 24];

async function load(url: string) { const img = new Image(); img.src = url; await img.decode(); return img; }

/** A student's ArcFace gallery from their registration crops: the most varied crops (chosen with the face features
 *  they already have), each at full size and as it would look 36 px and 24 px wide in a class photo.
 *  Stored compactly (packFeature): about 33 KB per student. */
export async function arcGallery(faces: {image: string; embedding?: number[]}[], onProgress?: (done: number, total: number) => void) {
  const known = faces.every(f => f.embedding?.length);
  const order = known ? diverse(faces.map(f => f.embedding!), faces.length) : faces.map((_, i) => i);
  const aligned: HTMLCanvasElement[] = [];
  const steps = ARC_CROPS_PER_STUDENT * (1 + ARC_CLASS_SIZES.length);
  for (const i of order) {
    if (aligned.length >= ARC_CROPS_PER_STUDENT) break;
    onProgress?.(aligned.length, steps);
    try {
      const found = await landmarksInCrop(await load(faces[i].image));
      if (found) aligned.push(alignFace(found.canvas, found.kps));
    } catch { /* unreadable crop */ }
  }
  if (aligned.length < 5) throw Error('Not enough clear face samples to prepare recognition. Ask the student to register again.');
  const variants: HTMLCanvasElement[] = [...aligned];
  for (const a of aligned) for (const px of ARC_CLASS_SIZES) variants.push(await degradeAligned(a, px));
  const vectors: number[][] = [];
  for (let k = 0; k < variants.length; k += 8) {
    onProgress?.(ARC_CROPS_PER_STUDENT + Math.round(k * (steps - ARC_CROPS_PER_STUDENT) / variants.length), steps);
    vectors.push(...await arcEmbed(variants.slice(k, k + 8), false));
  }
  return {arc: vectors.map(packFeature), arcVersion: ARC_VERSION, arcFaces: faces.length};
}
