/**
 * Open-set + head-count test on REAL face photos (features computed by the app's own pipeline in a browser).
 *
 *   npx tsx scripts/real-face-test.ts features.json [--json]
 *
 * features.json: [{id, photos: [{embedding, yaw, at48, at36} | null] x10, classroom: number[][]}]
 *   photos 0-6 are the person's registration, 7-9 unseen test photos. at48/at36: the same photo described as it looks
 *   in a class photo with a 48 / 36 px wide face (embeddings.describeAsSeenInClass). classroom: the app's class-photo
 *   references built from photos 0-6 (classroom-features.classroomFeatures).
 *
 * Per split, ~70% of people are registered and ~30% are unregistered classmates who were never trained on.
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import {recognizeCapture, type DetectedFace, type Observation} from '../src/attendance';
import * as counting from '../src/head-count';

type Photo = {embedding: number[]; yaw: number; at48: number[] | null; at36: number[] | null} | null;
type Person = {id: string; photos: Photo[]; classroom: number[][]};
const SPLITS = 20, LESSONS = 3, PRESENT_RATE = 0.85;
const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
if (!file) throw Error('Usage: npx tsx scripts/real-face-test.ts features.json [--json]');
const people = (JSON.parse(readFileSync(file, 'utf8')) as Person[]).filter(p => p.photos.slice(0, 7).filter(Boolean).length >= 5);

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const random = rng(Number(process.env.SEED ?? 7));
const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const mean = (vs: number[][]) => vs[0].map((_, i) => vs.reduce((n, v) => n + v[i], 0) / vs.length);
const recognise = recognizeCapture as unknown as (m: ReturnType<typeof buildModel>, f: DetectedFace[], strangers?: number[][]) => Observation[];
const face = (embedding: number[], extra: Partial<DetectedFace> = {}): DetectedFace => ({face: {image: '', vector: [], embedding}, usable: true, ...extra});

type Quality = 'registration' | 'at48' | 'at36';
const view = (p: Photo, q: Quality) => (p ? (q === 'registration' ? p.embedding : p[q]) : null);
/** A registered person's unseen test views, or any of a stranger's views. */
const views = (p: Person, q: Quality, registered: boolean) =>
  p.photos.flatMap((ph, i) => ((!registered || i >= 7) && view(ph, q) ? [view(ph, q)!] : []));

type Tally = {present: number; markedRight: number; markedWrong: number; suggestedRight: number; suggestedWrong: number; missed: number; strangers: number; strangerMarked: number; strangerSuggested: number};
const tally = (): Tally => ({present: 0, markedRight: 0, markedWrong: 0, suggestedRight: 0, suggestedWrong: 0, missed: 0, strangers: 0, strangerMarked: 0, strangerSuggested: 0});
function score(t: Tally, truth: (string | null)[], result: Observation[]) {
  result.forEach((o, i) => {
    const who = truth[i];
    if (who === null) { t.strangers++; if (o.studentId) t.strangerMarked++; else if (o.suggestion) t.strangerSuggested++; }
    else { t.present++; if (o.studentId) o.studentId === who ? t.markedRight++ : t.markedWrong++; else if (o.suggestion) o.suggestion === who ? t.suggestedRight++ : t.suggestedWrong++; else t.missed++; }
  });
}
function countPeople(result: Observation[]) {
  const present = new Set(result.flatMap(o => (o.studentId ? [o.studentId] : [])));
  return counting.headCount ? counting.headCount(result, present).total : present.size + result.filter(o => !o.studentId).length;
}

const results: Record<string, {photo: Tally; video: Tally; nextLesson: Tally; count: {lessons: number; exact: number; off1: number; error: number; naive: number}}> = {};
for (const q of ['registration', 'at48', 'at36'] as Quality[]) results[q] = {photo: tally(), video: tally(), nextLesson: tally(), count: {lessons: 0, exact: 0, off1: 0, error: 0, naive: 0}};

for (let split = 0; split < SPLITS; split++) {
  const order = shuffle(people), cut = Math.round(order.length * 0.7);
  const registered = order.slice(0, cut), strangers = order.slice(cut);
  const model = buildModel(registered.map(p => ({id: p.id, faces: p.photos.slice(0, 7).flatMap(ph => (ph ? [{image: '', vector: [], embedding: ph.embedding, yaw: ph.yaw}] : [])), classroom: p.classroom})), 'real');
  for (const q of ['registration', 'at48', 'at36'] as Quality[]) {
    const r = results[q];
    for (let lesson = 0; lesson < LESSONS; lesson++) {
      const present = registered.filter(p => random() < PRESENT_RATE && views(p, q, true).length);
      const room = [...present.map(p => ({p, reg: true})), ...strangers.filter(p => views(p, q, false).length).map(p => ({p, reg: false}))];
      const truth = room.map(x => (x.reg ? x.p.id : null));
      const pick = (x: {p: Person; reg: boolean}) => { const v = views(x.p, q, x.reg); return v[Math.floor(random() * v.length)]; };
      const photoFaces = room.map(pick);
      const photo = recognise(model, photoFaces.map(e => face(e)));
      score(r.photo, truth, photo);
      const frames = room.map(x => shuffle(views(x.p, q, x.reg)).slice(0, 4));
      score(r.video, truth, recognise(model, frames.map(f => face(mean(f), {frameEmbeddings: f, frames: [0, 39]}))));
      const dismissed = photo.flatMap((o, i) => (truth[i] === null && !o.studentId ? [photoFaces[i]] : []));
      score(r.nextLesson, truth, recognise(model, room.map(x => face(pick(x))), dismissed));
      // Head count: left and right photo of the room (middle third in both) + a video with ~15% leaving and returning.
      const seats = shuffle(room), third = Math.ceil(seats.length / 3);
      const all: Observation[] = [];
      [seats.slice(0, 2 * third), seats.slice(third)].forEach((g, c) => all.push(...recognise(model, g.map(x => face(pick(x)))).map(o => ({...o, capture: c + 1}))));
      const tracks = [...seats.map(x => ({x, frames: [0, 20] as [number, number]})), ...seats.filter(() => random() < 0.15).map(x => ({x, frames: [30, 39] as [number, number]}))];
      all.push(...recognise(model, tracks.map(t => { const f = shuffle(views(t.x.p, q, t.x.reg)).slice(0, 4); return face(mean(f), {frameEmbeddings: f, frames: t.frames}); })).map(o => ({...o, capture: 3})));
      const counted = countPeople(all), naive = new Set(all.flatMap(o => (o.studentId ? [o.studentId] : []))).size + all.filter(o => !o.studentId).length;
      r.count.lessons++; if (counted === room.length) r.count.exact++; if (Math.abs(counted - room.length) <= 1) r.count.off1++;
      r.count.error += Math.abs(counted - room.length); r.count.naive += Math.abs(naive - room.length);
    }
  }
}

if (args.includes('--json')) console.log(JSON.stringify({people: people.length, results}, null, 1));
else {
  const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
  console.log(`${people.length} real people · ${SPLITS} splits · ~30% unregistered\n`);
  for (const [q, r] of Object.entries(results)) {
    console.log(`== Test faces at ${q === 'registration' ? 'registration quality' : q.slice(2) + ' px (class photo)'}`);
    for (const name of ['photo', 'video', 'nextLesson'] as const) {
      const t = r[name];
      console.log(`  ${name.padEnd(10)} marked right ${pct(t.markedRight, t.present).padStart(6)} | to confirm ${pct(t.suggestedRight, t.present).padStart(6)} | WRONG student ${String(t.markedWrong).padStart(3)} | strangers named ${t.strangerMarked}/${t.strangers} | strangers offered ${pct(t.strangerSuggested, t.strangers)}`);
    }
    const c = r.count;
    console.log(`  head count exact ${pct(c.exact, c.lessons)}, within ±1 ${pct(c.off1, c.lessons)}, avg error ${(c.error / c.lessons).toFixed(2)} (adding up faces: ${(c.naive / c.lessons).toFixed(1)})\n`);
  }
}
