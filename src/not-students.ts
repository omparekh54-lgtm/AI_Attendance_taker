/** Faces the teacher marked "Not a student" on this board, kept as face features only (no photos) so the same
 *  unregistered people are recognised as strangers in later photos and lessons. Stays on this device. */
const KEY = 'eigenroll-not-students-v1';
/** The oldest are forgotten first. */
export const MAX_NOT_STUDENTS = 300;

export function loadNotStudents(storage: Pick<Storage, 'getItem'> = localStorage): number[][] {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter(v => Array.isArray(v) && v.length === 128 && v.every(x => Number.isFinite(x) && Math.abs(x) <= 5)) : [];
  } catch { return []; }
}

export function rememberNotStudents(existing: number[][], added: number[][], storage: Pick<Storage, 'setItem'> = localStorage): number[][] {
  const next = [...existing, ...added.map(v => v.map(x => Math.round(x * 1e5) / 1e5))].slice(-MAX_NOT_STUDENTS);
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: still used for this lesson */ }
  return next;
}

export function forgetNotStudents(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try { storage.removeItem(KEY); } catch { /* storage unavailable */ }
}
