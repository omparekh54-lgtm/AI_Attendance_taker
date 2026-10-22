import type {Observation} from './attendance';

/** Today's attendance on this device, so an accidental refresh or closed tab does not lose it. */
export type SavedAttendance = {startedAt: string; captures: number; observations: Observation[]; manual: Record<string, boolean>};
const KEY = 'eigenroll-attendance-v1';
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function loadSavedAttendance(now = new Date(), storage: Pick<Storage, 'getItem' | 'removeItem'> = localStorage): SavedAttendance | undefined {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null') as SavedAttendance | null;
    if (!saved || typeof saved.captures !== 'number' || !Array.isArray(saved.observations) || typeof saved.manual !== 'object') return undefined;
    // Yesterday's class should never show up as today's attendance.
    if (!saved.startedAt || !sameDay(new Date(saved.startedAt), now)) { storage.removeItem(KEY); return undefined; }
    return saved;
  } catch { return undefined; }
}

export function saveAttendance(record: SavedAttendance, storage: Pick<Storage, 'setItem'> = localStorage) {
  // Recognised faces only need their student id; keep face images just for the ones still to check.
  const compact = {...record, startedAt: record.startedAt || new Date().toISOString(),
    observations: record.observations.map(o => (o.studentId ? {id: o.id, image: '', studentId: o.studentId, confirmed: o.confirmed} : o))};
  try { storage.setItem(KEY, JSON.stringify(compact)); }
  catch {
    // Storage full: keep the decisions even if review thumbnails are lost.
    try { storage.setItem(KEY, JSON.stringify({...compact, observations: compact.observations.filter(o => o.studentId)})); } catch { /* storage unavailable */ }
  }
}

export function clearSavedAttendance(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try { storage.removeItem(KEY); } catch { /* storage unavailable */ }
}
