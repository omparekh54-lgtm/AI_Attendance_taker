/**
 * Open-set test on a REAL class roster's own registration photos (no class photos needed).
 *
 *   npx tsx scripts/roster-holdout-test.ts roster.json [--json]
 *
 * roster.json: the board's /api/attendance?kind=snapshot response (face features only).
 * Per split, ~70% of students are registered (25% of their photos held out as test faces) and ~30% act as
 * unregistered classmates (all their photos are test faces). Also reports "hubness": the largest share of
 * unregistered test faces whose closest student is one and the same student.
 * NO_NORM=1 turns off score normalisation; MIN_RADIUS=0.35 turns on outlier-photo removal (experiments).
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import * as identity from '../src/identity';
import {recognizeCapture, type DetectedFace} from '../src/attendance';
import type {Student} from '../src/store';

const tune = identity as unknown as {GALLERY_INLIER?: {minRadius: number; mads: number; keep: number}; SCORE_NORM_CONFIG?: {on: boolean}};
if (tune.SCORE_NORM_CONFIG && process.env.NO_NORM) tune.SCORE_NORM_CONFIG.on = false;
if (tune.GALLERY_INLIER && process.env.MIN_RADIUS) tune.GALLERY_INLIER.minRadius = Number(process.env.MIN_RADIUS);
const file = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!file) throw Error('Usage: npx tsx scripts/roster-holdout-test.ts roster.json [--json]');
const students = (JSON.parse(readFileSync(file, 'utf8')) as {students: Student[]}).students.filter(s => s.faces.length >= 8 && s.faces.every(f => f.embedding));

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const random = rng(Number(process.env.SEED ?? 5));
const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const face = (embedding: number[]): DetectedFace => ({face: {image: '', vector: [], embedding}, usable: true});

const t = {students: 0, marked: 0, markedWrong: 0, confirm: 0, confirmWrong: 0, top1: 0, strangers: 0, strangerMarked: 0, strangerOffered: 0, hub: 0, splits: 0};
for (let split = 0; split < Number(process.env.SPLITS ?? 20); split++) {
  const order = shuffle(students), cut = Math.round(order.length * 0.7), registered = order.slice(0, cut), strangers = order.slice(cut);
  const probes: {who: string | null; e: number[]}[] = [];
  const train = registered.map(s => {
    const faces = shuffle(s.faces), held = Math.max(2, Math.round(faces.length * 0.25));
    probes.push(...faces.slice(0, held).map(f => ({who: s.id, e: f.embedding!})));
    return {id: s.id, faces: faces.slice(held)};
  });
  for (const s of strangers) probes.push(...s.faces.map(f => ({who: null, e: f.embedding!})));
  const model = buildModel(train, 'holdout');
  const result = probes.map(p => recognizeCapture(model, [face(p.e)])[0]);
  const closest = new Map<string, number>();
  probes.forEach((p, i) => {
    const o = result[i];
    if (p.who) {
      t.students++;
      if (o.candidates?.[0] === p.who) t.top1++;
      if (o.studentId) o.studentId === p.who ? t.marked++ : t.markedWrong++;
      else if (o.suggestion) o.suggestion === p.who ? t.confirm++ : t.confirmWrong++;
    } else {
      t.strangers++;
      if (o.studentId) t.strangerMarked++; else if (o.suggestion) t.strangerOffered++;
      const c = o.candidates?.[0]; if (c) closest.set(c, (closest.get(c) ?? 0) + 1);
    }
  });
  const strangerProbes = probes.filter(p => !p.who).length;
  t.hub += Math.max(...closest.values()) / strangerProbes; t.splits++;
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
if (process.argv.includes('--json')) console.log(JSON.stringify(t));
else {
  console.log(`${students.length} students · ${t.splits} splits · ~30% unregistered · registration-quality faces`);
  console.log(`Right student closest ${pct(t.top1, t.students)} | marked right ${pct(t.marked, t.students)} | to confirm ${pct(t.confirm, t.students)} | WRONG marked ${t.markedWrong} | wrong suggestion ${t.confirmWrong}`);
  console.log(`Unregistered: named ${t.strangerMarked}/${t.strangers} | offered ${pct(t.strangerOffered, t.strangers)} | one student closest to ${pct(t.hub, t.splits)} of them (hub)`);
}
