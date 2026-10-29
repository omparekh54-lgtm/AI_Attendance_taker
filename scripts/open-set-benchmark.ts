/**
 * Open-set benchmark: how often does the board give a REGISTERED student's name to someone who is NOT registered?
 *
 * Usage
 *   npx tsx scripts/open-set-benchmark.ts roster.json      # real students (roster = the board's /api/attendance response)
 *   npx tsx scripts/open-set-benchmark.ts --synthetic      # generated class with look-alikes (for development only)
 *   add --json to print the full result as JSON
 *
 * Protocol (repeated over FOLDS random splits):
 *   - About 30% of the people are treated as unregistered classmates: they are left out of training entirely.
 *     Classmates are the hardest strangers (same age, same background), which is exactly the classroom problem.
 *   - Of the registered students, every fifth enrolment sample is held out for testing and never trained on.
 *   - Class photos: each registered student is present with probability PRESENT_RATE (one held-out sample),
 *     and every unregistered classmate appears (one sample), all through the app's own recognizeCapture().
 *   - Class videos: the same, but each person contributes FRAMES held-out samples as separate video frames.
 *   - Second lesson: strangers the teacher dismissed as "Not a student" in the first lesson are remembered;
 *     they then appear again with a different sample.
 * Test samples are made harder than enrolment (see SHRINK and CLASS_NOISE), as classroom faces are.
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import {recognizeCapture, type DetectedFace, type Observation} from '../src/attendance';
import * as identity from '../src/identity';
// Tuning only: IMPOSTOR_PERCENTILE / IMPOSTOR_GAP override the per-student limit settings (newer code only).
const tuning = identity as {IMPOSTOR?: {percentile: number; gap: number}};
if (tuning.IMPOSTOR && process.env.IMPOSTOR_PERCENTILE) tuning.IMPOSTOR.percentile = Number(process.env.IMPOSTOR_PERCENTILE);
if (tuning.IMPOSTOR && process.env.IMPOSTOR_GAP) tuning.IMPOSTOR.gap = Number(process.env.IMPOSTOR_GAP);

type Person = {id: string; samples: number[][]; classroom: number[][]};
const FOLDS = 10, PRESENT_RATE = 0.85, FRAMES = 4;
/** Classroom conditions: small, dim or blurry faces lose detail, so their features drift towards the class's
 *  average face (SHRINK) and gain noise. This pulls strangers and students closer together, as in a real room. */
const SHRINK = Number(process.env.SHRINK ?? 0.2), CLASS_NOISE = 0.016;
const args = process.argv.slice(2), asJson = args.includes('--json');
const source = args.find(a => !a.startsWith('--'));

// Deterministic randomness so before/after comparisons use identical splits.
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = rng(Number(process.env.SEED ?? 20261029));
const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
const shuffle = <T>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const add = (a: number[], b: number[], k = 1) => a.map((v, i) => v + k * b[i]);
const noise = (sd: number) => Array.from({length: 128}, () => sd * gauss());
const mean = (vs: number[][]) => vs[0].map((_, i) => vs.reduce((n, v) => n + v[i], 0) / vs.length);

function loadRoster(file: string): Person[] {
  const data = JSON.parse(readFileSync(file, 'utf8')) as {students: {id: string; faces: {embedding?: number[]}[]; classroom?: number[][]}[]};
  return data.students.map(s => ({id: s.id, samples: s.faces.flatMap(f => (f.embedding ? [f.embedding] : [])), classroom: s.classroom ?? []}))
    .filter(p => p.samples.length >= 10);
}

/** A class of people whose face features behave like face-api descriptors: different people ~0.75 apart,
 *  photos of one person ~0.35 apart, and about a third of people with a close look-alike (~0.45–0.5 apart). */
function syntheticClass(count = 40, perPerson = 26): Person[] {
  const basis = Array.from({length: 32}, () => noise(1 / Math.sqrt(128)));
  const center = (sd: number) => basis.reduce((v, b) => add(v, b, sd * gauss()), Array(128).fill(0) as number[]);
  const base = Array.from({length: 128}, () => 0.09 * gauss());
  const centers: number[][] = [];
  for (let i = 0; i < count; i++) {
    const lookAlike = i > 3 && random() < 0.35;
    centers.push(lookAlike ? add(centers[Math.floor(random() * i)], center(0.075)) : add(base, center(0.095)));
  }
  return centers.map((c, i) => {
    const spread = 0.019 * (0.75 + 0.6 * random());
    const samples = Array.from({length: perPerson}, () => add(c, noise(spread)));
    return {id: 's' + i, samples, classroom: samples.slice(0, 8).map(v => add(v, noise(spread)))};
  });
}

type Tally = {present: number; markedRight: number; markedWrong: number; suggestedRight: number; suggestedWrong: number; missed: number;
  strangers: number; strangerMarked: number; strangerSuggested: number; strangerUnknown: number};
const tally = (): Tally => ({present: 0, markedRight: 0, markedWrong: 0, suggestedRight: 0, suggestedWrong: 0, missed: 0, strangers: 0, strangerMarked: 0, strangerSuggested: 0, strangerUnknown: 0});

function score(t: Tally, truth: (string | null)[], result: Observation[]) {
  result.forEach((o, i) => {
    const who = truth[i];
    if (who === null) {
      t.strangers++;
      if (o.studentId) t.strangerMarked++; else if (o.suggestion) t.strangerSuggested++; else t.strangerUnknown++;
    } else {
      t.present++;
      if (o.studentId) o.studentId === who ? t.markedRight++ : t.markedWrong++;
      else if (o.suggestion) o.suggestion === who ? t.suggestedRight++ : t.suggestedWrong++;
      else t.missed++;
    }
  });
}

const face = (embedding: number[], frameEmbeddings?: number[][]): DetectedFace =>
  ({face: {image: '', vector: [], embedding}, usable: true, ...(frameEmbeddings ? {frameEmbeddings, frames: [0, 39] as [number, number]} : {})});
// The app's recognizeCapture gained a third argument (remembered strangers). Older versions simply ignore it.
const recognise = recognizeCapture as unknown as (m: ReturnType<typeof buildModel>, f: DetectedFace[], strangers?: number[][]) => Observation[];

function run(people: Person[]) {
  const photo = tally(), video = tally(), secondLesson = tally();
  for (let fold = 0; fold < FOLDS; fold++) {
    const order = shuffle(people), registeredCount = Math.max(2, Math.round(order.length * 0.7));
    const registered = order.slice(0, registeredCount), strangers = order.slice(registeredCount);
    const held = new Map(registered.map(p => [p.id, p.samples.filter((_, i) => i % 5 === fold % 5)]));
    const model = buildModel(registered.map(p => ({id: p.id, faces: p.samples.filter((_, i) => i % 5 !== fold % 5).map(e => ({image: '', vector: [], embedding: e})), classroom: p.classroom})), 'bench');
    const average = mean(people.flatMap(p => p.samples));
    const harder = (v: number[]) => add(add(v, add(average, v, -1), SHRINK), noise(CLASS_NOISE));
    const pick = (vs: number[][]) => vs[Math.floor(random() * vs.length)];
    for (let lesson = 0; lesson < 3; lesson++) {
      const present = registered.filter(() => random() < PRESENT_RATE);
      const truth = [...present.map(p => p.id), ...strangers.map(() => null)];
      // Class photo
      const photoFaces = [...present.map(p => harder(pick(held.get(p.id)!))), ...strangers.map(p => harder(pick(p.samples)))];
      const photoResult = recognise(model, photoFaces.map(e => face(e)));
      score(photo, truth, photoResult);
      // Class video: several frames per person, averaged as the app does (older code only used the average).
      const frames = [...present.map(p => shuffle(held.get(p.id)!).slice(0, FRAMES).map(harder)), ...strangers.map(p => shuffle(p.samples).slice(0, FRAMES).map(harder))];
      score(video, truth, recognise(model, frames.map(f => face(mean(f), f))));
      // Next lesson: faces the teacher dismissed as "Not a student" are remembered on the board.
      const dismissed = photoResult.flatMap((o, i) => (truth[i] === null && !o.studentId ? [photoFaces[i]] : []));
      const next = [...present.map(p => harder(pick(held.get(p.id)!))), ...strangers.map(p => harder(pick(p.samples)))];
      score(secondLesson, truth, recognise(model, next.map(e => face(e)), dismissed));
    }
  }
  return {photo, video, secondLesson};
}

const people = source ? loadRoster(source) : syntheticClass();
if (people.length < 4) throw Error('Need at least 4 people with 10 or more samples each.');
if (args.includes('--stats')) {
  // Distance profile of the data: same person vs. different people (nearest other person).
  const d = (a: number[], b: number[]) => Math.sqrt(a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0));
  const q = (x: number[], p: number) => [...x].sort((a, b) => a - b)[Math.floor(p * (x.length - 1))].toFixed(3);
  const same = people.flatMap(p => p.samples.slice(1, 8).map(s => d(p.samples[0], s)));
  const nearestOther = people.map(p => Math.min(...people.filter(o => o !== p).flatMap(o => o.samples.slice(0, 8).map(s => d(p.samples[0], s)))));
  const other = people.flatMap((p, i) => people.slice(i + 1).map(o => d(p.samples[0], o.samples[0])));
  console.log(`same person: median ${q(same, .5)}, 95th pct ${q(same, .95)}`);
  console.log(`different people: 1st pct ${q(other, .01)}, median ${q(other, .5)}`);
  console.log(`closest other person per person: min ${q(nearestOther, 0)}, 25th pct ${q(nearestOther, .25)}, median ${q(nearestOther, .5)}`);
  process.exit(0);
}
const result = run(people);
if (asJson) console.log(JSON.stringify({people: people.length, source: source ?? 'synthetic', ...result}, null, 1));
else {
  const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
  console.log(`${source ? 'Roster ' + source : 'Synthetic class'} · ${people.length} people · ${FOLDS} splits · ~30% treated as unregistered\n`);
  console.log('Scenario        | Students marked right | Marked WRONG student | Strangers given a name | Strangers suggested | Students to confirm');
  for (const [name, t] of Object.entries(result))
    console.log(`${name.padEnd(15)} | ${pct(t.markedRight, t.present).padStart(21)} | ${String(t.markedWrong).padStart(20)} | ${(t.strangerMarked + ' / ' + t.strangers).padStart(22)} | ${pct(t.strangerSuggested, t.strangers).padStart(19)} | ${pct(t.suggestedRight, t.present).padStart(19)}`);
}
