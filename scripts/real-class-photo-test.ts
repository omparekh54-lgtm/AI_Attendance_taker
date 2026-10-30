/**
 * End-to-end class photo test: faces found by the app's classroom scan in composed class photos of real people,
 * then recognised and counted by this version of the code.
 *
 *   npx tsx scripts/real-class-photo-test.ts features.json class-detections.json
 *
 * class-detections.json: [{registered: [ids], seats: [{person, registered, box:[x,y,w,h]}], faces: DetectedFace[]}]
 * (faces from vision.detect(photo, {group: true}) in a browser). features.json as for real-face-test.ts.
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import {recognizeCapture, type DetectedFace, type Observation} from '../src/attendance';
// Older versions have no head count; they are scored on students present plus every other face.
const counting: {headCount?: typeof import('../src/head-count').headCount} = await import('../src/head-count').catch(() => ({}));

// Experiment: EXTRA_REFS=at36 adds registration photos described as seen at 36 px (as CLASS_STYLE_SIZES [80, 36] does).
const extraRefs = (process.env.EXTRA_REFS ?? '').split(',').filter(Boolean) as ('at48' | 'at36')[];
type Person = {id: string; photos: ({embedding: number[]; yaw: number} | null)[]; classroom: number[][]};
type Seat = {person: string; registered: boolean; box: [number, number, number, number]; faceWidth: number};
const [featuresFile, detectionsFile] = process.argv.slice(2);
const people = new Map((JSON.parse(readFileSync(featuresFile, 'utf8')) as Person[]).map(p => [p.id, p]));
const photos = JSON.parse(readFileSync(detectionsFile, 'utf8')) as {registered: string[]; seats: Seat[]; faces: DetectedFace[]}[];

const t = {people: 0, students: 0, strangers: 0, found: 0, readable: 0, falseFaces: 0, markedRight: 0, markedWrong: 0, suggestedRight: 0, suggestedWrong: 0,
  studentMissed: 0, strangerNamed: 0, strangerOffered: 0, countExact: 0, countError: 0, countSigned: 0, naiveError: 0, backRowStudents: 0, backRowMarked: 0};
for (const photo of photos) {
  const model = buildModel(photo.registered.filter(id => people.has(id)).map(id => {
    const p = people.get(id)!;
    return {id, faces: p.photos.slice(0, 7).flatMap(ph => (ph ? [{image: '', vector: [], embedding: ph.embedding, yaw: ph.yaw}] : [])), classroom: [...p.classroom, ...p.photos.slice(0, 7).flatMap(ph => extraRefs.flatMap(k => ((ph as Record<string, unknown> | null)?.[k] ? [(ph as Record<string, number[]>)[k]] : [])))]};
  }), 'class-photo');
  const result: Observation[] = recognizeCapture(model, photo.faces).map(o => ({...o, capture: 1}));
  // Which seat did each detected face come from? (face centre inside the pasted photo)
  const seatOf = photo.faces.map(f => {
    const W = f.sourceWidth!, H = f.sourceHeight!, cx = (f.box!.x + f.box!.w / 2) * W, cy = (f.box!.y + f.box!.h / 2) * H;
    return photo.seats.findIndex(s => cx >= s.box[0] && cx <= s.box[0] + s.box[2] && cy >= s.box[1] && cy <= s.box[1] + s.box[3]);
  });
  t.people += photo.seats.length;
  t.students += photo.seats.filter(s => s.registered).length;
  t.strangers += photo.seats.filter(s => !s.registered).length;
  const seen = new Set(seatOf.filter(i => i >= 0));
  t.found += seen.size;
  t.falseFaces += seatOf.filter(i => i < 0).length;
  t.readable += photo.faces.filter((f, i) => f.usable && seatOf[i] >= 0).length;
  photo.seats.forEach((s, i) => {
    const mine = result.filter((_, k) => seatOf[k] === i);
    if (s.registered) {
      if (s.faceWidth <= 50) t.backRowStudents++;
      if (mine.some(o => o.studentId === s.person)) { t.markedRight++; if (s.faceWidth <= 50) t.backRowMarked++; }
      else if (mine.some(o => o.suggestion === s.person)) t.suggestedRight++;
      else t.studentMissed++;
      t.markedWrong += mine.filter(o => o.studentId && o.studentId !== s.person).length;
      t.suggestedWrong += mine.filter(o => !o.studentId && o.suggestion && o.suggestion !== s.person).length;
    } else {
      t.strangerNamed += mine.filter(o => o.studentId).length;
      t.strangerOffered += mine.filter(o => !o.studentId && o.suggestion).length;
    }
  });
  const present = new Set(result.flatMap(o => (o.studentId ? [o.studentId] : [])));
  const counted = counting.headCount ? counting.headCount(result, present).total : NaN;
  const naive = present.size + result.filter(o => !o.studentId).length;
  if (counted === photo.seats.length) t.countExact++;
  t.countError += Math.abs(counted - photo.seats.length); t.countSigned += counted - photo.seats.length;
  t.naiveError += Math.abs(naive - photo.seats.length);
}
const pct = (a: number, b: number) => (b ? (100 * a / b).toFixed(1) + '%' : '–');
console.log(`${photos.length} class photos · ${t.people} people (${t.students} registered students, ${t.strangers} unregistered)`);
console.log(`Faces found: ${t.found}/${t.people} (${pct(t.found, t.people)}), readable ${t.readable}; detections that were not a seated person: ${t.falseFaces}`);
console.log(`Students: marked right ${t.markedRight} (${pct(t.markedRight, t.students)}), to confirm ${t.suggestedRight} (${pct(t.suggestedRight, t.students)}), missed ${t.studentMissed}; WRONG student marked ${t.markedWrong}; wrong suggestion ${t.suggestedWrong}`);
console.log(`Back rows (faces ≤ 50 px): marked right ${t.backRowMarked}/${t.backRowStudents}`);
console.log(`Unregistered: given a student's name ${t.strangerNamed}/${t.strangers}, offered as "Is this …?" ${t.strangerOffered}/${t.strangers}`);
console.log(Number.isNaN(t.countError) ? `Head count: not available in this version (students + other faces would be off by ${(t.naiveError / photos.length).toFixed(1)} per photo)`
  : `Head count: exact in ${t.countExact}/${photos.length} photos, average error ${(t.countError / photos.length).toFixed(2)} (net ${t.countSigned >= 0 ? '+' : ''}${t.countSigned})`);
