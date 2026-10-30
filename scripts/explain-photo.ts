/**
 * Explain, face by face, what the board decides for a class photo and why.
 *
 *   npx tsx scripts/explain-photo.ts roster.json faces.json [--json]
 *
 * roster.json : the board's /api/attendance?kind=snapshot response
 * faces.json  : [{file, w, h, faces: [{px, box, usable, yaw, embedding}]}] (faces found by vision.detect in a browser)
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import * as identity from '../src/identity';
const {predictIdentity} = identity;
// NO_NORM=1: without per-student score normalisation (to compare with the previous behaviour).
const tune = identity as unknown as {SCORE_NORM_CONFIG?: {on: boolean}};
if (tune.SCORE_NORM_CONFIG && process.env.NO_NORM) tune.SCORE_NORM_CONFIG.on = false;
import {recognizeCapture, type DetectedFace} from '../src/attendance';
import type {Student} from '../src/store';

const [rosterFile, facesFile] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const roster = JSON.parse(readFileSync(rosterFile, 'utf8')) as {students: Student[]};
const photos = JSON.parse(readFileSync(facesFile, 'utf8')) as {file: string; w: number; h: number; faces: {px: number; box: {x: number; y: number; w: number; h: number}; usable: boolean; yaw?: number; embedding?: number[]}[]}[];
const students = roster.students.filter(s => s.faces.length && s.faces.every(f => f.embedding));
const name = new Map(students.map(s => [s.id, s.name]));
const model = buildModel(students, 'explain');
const rows: Record<string, unknown>[] = [];
for (const [p, photo] of photos.entries()) {
  const faces: DetectedFace[] = photo.faces.map(f => ({face: {image: '', vector: [], embedding: f.embedding, yaw: f.yaw}, usable: f.usable, box: f.box, sourceWidth: photo.w, sourceHeight: photo.h}));
  const decided = recognizeCapture(model, faces);
  photo.faces.forEach((f, i) => {
    const o = decided[i];
    const q = f.embedding ? predictIdentity(model.identity!, f.embedding, [], f.px) : undefined;
    rows.push({photo: p + 1, face: i + 1, x: Math.round((f.box.x + f.box.w / 2) * photo.w), y: Math.round((f.box.y + f.box.h / 2) * photo.h), px: f.px, yaw: f.yaw === undefined ? null : Math.round(f.yaw * 100) / 100,
      best: q ? name.get(q.label) : null, distance: q ? Math.round(q.distance * 1000) / 1000 : null, limit: q ? Math.round(q.limit * 1000) / 1000 : null,
      second: q ? name.get(q.candidates[1]) : null, margin: q ? Math.round(q.margin * 1000) / 1000 : null, ratio: q ? Math.round(q.ratio * 100) / 100 : null, pcaAgrees: q?.pcaAgreement ?? null,
      result: o.studentId ? 'MARKED ' + name.get(o.studentId) : o.suggestion ? 'CONFIRM? ' + name.get(o.suggestion) : 'not recognised', reason: o.reason ?? ''});
  });
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
else for (const r of rows) console.log(Object.values(r).join('\t'));
