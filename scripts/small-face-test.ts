/**
 * Small-face test on REAL faces: registered students and unregistered people as they look in a LOW-RESOLUTION class
 * photo (faces 32 / 26 / 22 / 18 px wide, JPEG-compressed, described exactly as the classroom scan does).
 *
 *   npx tsx scripts/small-face-test.ts features.json small-features.json [--json]
 *
 * features.json       : registration (photos 0-6 per person) + the app's class-photo references (see real-face-test.ts)
 * small-features.json : [{id, sizes: {"32": [vector|null x10], "26": [...], ...}}]
 * Registered people are tested on their unseen photos 7-9; unregistered people on all 10.
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import * as identityRules from '../src/identity';
// NO_NORM=1: without per-student score normalisation (to compare with the previous behaviour).
const normTune = identityRules as unknown as {SCORE_NORM_CONFIG?: {on: boolean}};
if (normTune.SCORE_NORM_CONFIG && process.env.NO_NORM) normTune.SCORE_NORM_CONFIG.on = false;
import * as identity from '../src/identity';
const {predictIdentity} = identity;
// Tuning only (newer code): SMALL_EXTRA, SMALL_TO, MAX_CAP, CEILING override the small-face settings.
const tune = identity as unknown as {SMALL_FACE?: {from: number; to: number; extra: number}; IMPOSTOR?: {maxCap: number; ceiling: number}};
if (tune.SMALL_FACE && process.env.SMALL_EXTRA) tune.SMALL_FACE.extra = Number(process.env.SMALL_EXTRA);
if (tune.SMALL_FACE && process.env.SMALL_TO) tune.SMALL_FACE.to = Number(process.env.SMALL_TO);
if (tune.IMPOSTOR && process.env.MAX_CAP) tune.IMPOSTOR.maxCap = Number(process.env.MAX_CAP);
if (tune.IMPOSTOR && process.env.CEILING) tune.IMPOSTOR.ceiling = Number(process.env.CEILING);
import {recognizeCapture, type DetectedFace} from '../src/attendance';

type Person = {id: string; photos: ({embedding: number[]; yaw: number; at48?: number[] | null; at36?: number[] | null} | null)[]; classroom: number[][]};
// Experiment: EXTRA_REFS=at48,at36 adds each registration photo described as seen at 48 / 36 px as class-photo references.
const extraRefs = (process.env.EXTRA_REFS ?? '').split(',').filter(Boolean) as ('at48' | 'at36')[];
type Small = {id: string; sizes: Record<string, (number[] | null)[]>};
const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const small = new Map((JSON.parse(readFileSync(files[1], 'utf8')) as Small[]).map(s => [s.id, s]));
// Only people whose small faces have been computed (the file can be read while it is still being filled).
const people = (JSON.parse(readFileSync(files[0], 'utf8')) as Person[]).filter(p => small.has(p.id));
const SPLITS = 20, sizes = Object.keys([...small.values()][0].sizes).sort((a, b) => Number(b) - Number(a));

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const random = rng(11);
const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// A face `px` wide in a 1280 x 960 photo.
const face = (embedding: number[], px: number): DetectedFace => ({face: {image: '', vector: [], embedding}, usable: true, box: {x: .4, y: .4, w: px / 1280, h: px / 960}, sourceWidth: 1280, sourceHeight: 960});
const predict = predictIdentity as unknown as (m: unknown, v: number[], s: number[][], px: number) => {label: string; accepted: boolean; suggested: boolean};

type T = {students: number; accepted: number; acceptedWrong: number; marked: number; markedWrong: number; confirm: number; confirmWrong: number; strangers: number; strangerAccepted: number; strangerMarked: number; strangerOffered: number};
const tally = (): T => ({students: 0, accepted: 0, acceptedWrong: 0, marked: 0, markedWrong: 0, confirm: 0, confirmWrong: 0, strangers: 0, strangerAccepted: 0, strangerMarked: 0, strangerOffered: 0});
const results: Record<string, T> = Object.fromEntries(sizes.map(s => [s, tally()]));
for (let split = 0; split < SPLITS; split++) {
  const order = shuffle(people), cut = Math.round(order.length * 0.7), registered = order.slice(0, cut), strangers = order.slice(cut);
  const model = buildModel(registered.map(p => ({id: p.id, faces: p.photos.slice(0, 7).flatMap(ph => (ph ? [{image: '', vector: [], embedding: ph.embedding, yaw: ph.yaw}] : [])), classroom: [...p.classroom, ...p.photos.slice(0, 7).flatMap(ph => extraRefs.flatMap(k => (ph?.[k] ? [ph[k]!] : [])))]})), 'small');
  for (const size of sizes) {
    const t = results[size], px = Number(size);
    for (const p of registered) for (const v of small.get(p.id)!.sizes[size].slice(7)) {
      if (!v) continue;
      t.students++;
      const q = predict(model.identity, v, [], px);
      if (q.accepted) { q.label === p.id ? t.accepted++ : t.acceptedWrong++; }
      const [o] = recognizeCapture(model, [face(v, px)]);
      if (o.studentId) o.studentId === p.id ? t.marked++ : t.markedWrong++;
      else if (o.suggestion) o.suggestion === p.id ? t.confirm++ : t.confirmWrong++;
    }
    for (const p of strangers) for (const v of small.get(p.id)!.sizes[size]) {
      if (!v) continue;
      t.strangers++;
      if (predict(model.identity, v, [], px).accepted) t.strangerAccepted++;
      const [o] = recognizeCapture(model, [face(v, px)]);
      if (o.studentId) t.strangerMarked++; else if (o.suggestion) t.strangerOffered++;
    }
  }
}
if (args.includes('--json')) console.log(JSON.stringify(results));
else {
  const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
  console.log(`${people.length} real people · ${SPLITS} splits · ~30% unregistered · faces in a 1280x960 photo\n`);
  console.log('Face | Matched (before size rule) | Marked automatically | To confirm (right) | Wrong student marked | Wrong suggestion | Strangers matched | Strangers marked | Strangers offered');
  for (const s of sizes) {
    const t = results[s];
    console.log(`${(s + 'px').padStart(4)} | ${pct(t.accepted, t.students).padStart(26)} | ${pct(t.marked, t.students).padStart(20)} | ${pct(t.confirm, t.students).padStart(18)} | ${String(t.markedWrong).padStart(20)} | ${String(t.confirmWrong).padStart(16)} | ${(t.strangerAccepted + '/' + t.strangers).padStart(17)} | ${(t.strangerMarked + '/' + t.strangers).padStart(16)} | ${pct(t.strangerOffered, t.strangers).padStart(17)}`);
  }
}
