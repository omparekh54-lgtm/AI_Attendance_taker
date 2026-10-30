/**
 * Class photos end to end: faces found by the app's classroom scan, recognised by this version of the code, scored per
 * seat. Compares the previous rules ("before": class-photo references at 80/36 px, no two-photo agreement) with the
 * current ones ("after": + 24 px references and agreeAcrossCaptures) on exactly the same detections.
 *
 *   npx tsx scripts/class-photo-benchmark.ts features.json shot1-detections.json [shot2-detections.json] [--json]
 *
 * features.json: as for real-face-test.ts, with an optional `at24` view per registration photo.
 * shotN-detections.json: [{registered: [ids], seats: [{person, registered, box:[x,y,w,h], faceWidth}], faces: DetectedFace[]}]
 * (the same class photos; shot 2 taken a few seconds after shot 1).
 */
import {readFileSync} from 'node:fs';
import {buildModel} from '../src/build-model';
import {recognizeCapture, agreeAcrossCaptures, type DetectedFace, type Observation} from '../src/attendance';
import {headCount} from '../src/head-count';

type Photo = {embedding: number[]; yaw: number; at24?: number[] | null} | null;
type Person = {id: string; photos: Photo[]; classroom: number[][]};
type Seat = {person: string; registered: boolean; box: [number, number, number, number]; faceWidth: number};
type Shot = {registered: string[]; seats: Seat[]; faces: DetectedFace[]}[];
const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const people = new Map((JSON.parse(readFileSync(files[0], 'utf8')) as Person[]).map(p => [p.id, p]));
const shots = files.slice(1).map(f => JSON.parse(readFileSync(f, 'utf8')) as Shot);
const rows = (w: number) => (w >= 40 ? 'front' : w >= 25 ? 'middle' : 'back');

function run(version: 'before' | 'after') {
  const t: Record<string, number> = {};
  const add = (k: string, n = 1) => { t[k] = (t[k] ?? 0) + n; };
  shots[0].forEach((photo, n) => {
    const model = buildModel(photo.registered.filter(id => people.has(id)).map(id => {
      const p = people.get(id)!, reg = p.photos.slice(0, 7);
      return {id, faces: reg.flatMap(ph => (ph ? [{image: '', vector: [], embedding: ph.embedding, yaw: ph.yaw}] : [])),
        classroom: [...p.classroom, ...(version === 'after' ? reg.flatMap(ph => (ph?.at24 ? [ph.at24] : [])) : [])],
        classroomPx: [...p.classroom.map(() => 0), ...reg.flatMap(ph => (ph?.at24 ? [process.env.NO_GATE ? 0 : 24] : []))]};
    }), 'benchmark');
    // Which seat each detected face belongs to (face centre inside the seat).
    const seatOf = (s: Shot[number], f: DetectedFace) => {
      const cx = (f.box!.x + f.box!.w / 2) * f.sourceWidth!, cy = (f.box!.y + f.box!.h / 2) * f.sourceHeight!;
      return s.seats.findIndex(x => cx >= x.box[0] && cx <= x.box[0] + x.box[2] && cy >= x.box[1] && cy <= x.box[1] + x.box[3]);
    };
    for (const [label, used] of [['one photo', shots.slice(0, 1)], ['two photos', shots]] as const) {
      if (label === 'two photos' && shots.length < 2) continue;
      let all: (Observation & {seat: number})[] = [];
      used.forEach((shot, c) => {
        const s = shot[n], obs = recognizeCapture(model, s.faces).map(o => ({...o, capture: c + 1}));
        all.push(...obs.map((o, i) => ({...o, seat: seatOf(s, s.faces[i])})));
      });
      if (version === 'after') { const agreed = agreeAcrossCaptures(all); all = all.map((o, i) => ({...agreed[i], seat: o.seat})); }
      const k = (x: string) => `${label}|${x}`;
      photo.seats.forEach((seat, i) => {
        const mine = all.filter(o => o.seat === i), row = rows(shots[0][n].seats[i].faceWidth);
        if (seat.registered) {
          add(k('students')); add(k(`students ${row}`));
          if (mine.some(o => o.studentId === seat.person)) { add(k('marked')); add(k(`marked ${row}`)); }
          else if (mine.some(o => o.suggestion === seat.person)) { add(k('confirm')); add(k(`confirm ${row}`)); }
          if (mine.some(o => o.studentId && o.studentId !== seat.person)) add(k('wrong'));
        } else {
          add(k('strangers'));
          if (mine.some(o => o.studentId)) add(k('strangerNamed'));
          else if (mine.some(o => o.suggestion)) add(k('strangerOffered'));
        }
        if (mine.some(o => o.embedding)) add(k(`readable ${row}`));
        add(k(`people ${row}`));
      });
      const present = new Set(all.flatMap(o => (o.studentId ? [o.studentId] : [])));
      const counted = headCount(all, present).total;
      add(k('countError'), Math.abs(counted - photo.seats.length)); add(k('photos'));
    }
  });
  return t;
}
const result = {before: run('before'), after: run('after')};
if (args.includes('--json')) console.log(JSON.stringify(result));
else {
  const pct = (a = 0, b = 0) => (b ? `${(100 * a / b).toFixed(0)}%` : '–');
  for (const label of ['one photo', 'two photos']) {
    const b = result.before, a = result.after, k = (x: string) => `${label}|${x}`;
    if (!b[k('photos')]) continue;
    console.log(`\n== ${label} · ${b[k('photos')]} class photos · ${b[k('students')]} registered students, ${b[k('strangers')]} unregistered`);
    console.log('measure | before | after');
    console.log(`students marked automatically | ${pct(b[k('marked')], b[k('students')])} | ${pct(a[k('marked')], a[k('students')])}`);
    console.log(`marked or offered to confirm | ${pct((b[k('marked')] ?? 0) + (b[k('confirm')] ?? 0), b[k('students')])} | ${pct((a[k('marked')] ?? 0) + (a[k('confirm')] ?? 0), a[k('students')])}`);
    for (const row of ['front', 'middle', 'back']) if (b[k(`students ${row}`)])
      console.log(`  ${row} rows: marked / marked+offered | ${pct(b[k(`marked ${row}`)], b[k(`students ${row}`)])} / ${pct((b[k(`marked ${row}`)] ?? 0) + (b[k(`confirm ${row}`)] ?? 0), b[k(`students ${row}`)])} | ${pct(a[k(`marked ${row}`)], a[k(`students ${row}`)])} / ${pct((a[k(`marked ${row}`)] ?? 0) + (a[k(`confirm ${row}`)] ?? 0), a[k(`students ${row}`)])} (faces readable ${pct(b[k(`readable ${row}`)], b[k(`people ${row}`)])})`);
    console.log(`WRONG student marked | ${b[k('wrong')] ?? 0} | ${a[k('wrong')] ?? 0}`);
    console.log(`unregistered given a name | ${b[k('strangerNamed')] ?? 0} of ${b[k('strangers')]} | ${a[k('strangerNamed')] ?? 0} of ${a[k('strangers')]}`);
    console.log(`unregistered offered "Is this …?" | ${pct(b[k('strangerOffered')], b[k('strangers')])} | ${pct(a[k('strangerOffered')], a[k('strangers')])}`);
    console.log(`head count average error | ${((b[k('countError')] ?? 0) / b[k('photos')]).toFixed(1)} | ${((a[k('countError')] ?? 0) / a[k('photos')]).toFixed(1)}`);
  }
}
