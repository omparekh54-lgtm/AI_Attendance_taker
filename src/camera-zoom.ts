/** Zoom steps offered for a second photo of the back rows (capped at what the camera supports). Back-row faces are
 *  often 20-30 px in a whole-class photo, too small to mark; at 2-3x they are 40-90 px, where recognition is reliable. */
export const BACK_ROW_ZOOMS = [1, 2, 3];
export function zoomSteps(range?: {min: number; max: number}) {
  if (!range || !(range.max >= 1.5)) return [];
  const steps = BACK_ROW_ZOOMS.filter(z => z >= range.min && z <= range.max);
  if (range.max < 3 && range.max >= 1.5 && !steps.includes(range.max)) steps.push(Math.round(range.max * 10) / 10);
  return steps.length > 1 ? steps : [];
}
