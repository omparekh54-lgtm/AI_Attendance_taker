import {api} from './api';
import type {Student} from './store';

type Row = {id: string; payload: Student; revision: number};

/** Builds and saves the ArcFace gallery for students who registered without one (their phone could not prepare it).
 *  Runs on the attendance board, which is signed in as the teacher, so a new student is recognised by the ArcFace
 *  engine within a minute of registering, with no visit to the teacher page. Only those students' records are written. */
export async function prepareMissingArc(ids: Set<string>, onProgress: (text: string) => void) {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 5) {
    const r = await api<{rows: Row[]}>('workspace?kind=students&offset=' + offset);
    rows.push(...r.rows.filter(row => ids.has(row.payload.id)));
    if (r.rows.length < 5) break;
  }
  const {arcGallery} = await import('./arc-gallery');
  const ready: string[] = [], failed: {name: string; reason: string}[] = [];
  for (const [n, row] of rows.entries()) {
    const s = row.payload;
    try {
      if (s.faces.length < 5 || !s.faces.every(f => f.image)) throw Error('registration photos are missing; ask them to register again');
      const arc = await arcGallery(s.faces, (d, t) => onProgress(`Preparing recognition for ${s.name} (${n + 1} / ${rows.length}) · ${Math.round(100 * d / t)}%`));
      await api('workspace', 'POST', {id: row.id, kind: 'students', payload: {...s, ...arc}, revision: row.revision});
      ready.push(s.id);
    } catch (e) { failed.push({name: s.name, reason: (e as Error).message}); }
  }
  return {ready, failed};
}
