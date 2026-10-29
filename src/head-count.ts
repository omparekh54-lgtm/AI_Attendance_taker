import type {Observation} from './attendance';

/** How many people are in the room, from every capture combined.
 *  students: registered students present (recognised, confirmed or marked by the teacher).
 *  toConfirm: people the board thinks are a (not yet present) student, waiting for the teacher's Yes.
 *  unregistered: other people with a readable face, including those marked "Not a student".
 *  unclear: faces too small or blurry to read; the largest number in any single capture (they cannot be told apart
 *  across photos, so adding them up would count the same blurry face once per photo). */
export type HeadCount = {total: number; students: number; toConfirm: number; unregistered: number; unclear: number};

/** Two faces from different captures closer than this are taken to be the same person. Measured on 400 real photos of
 *  40 people (the app's own pipeline): 90–95% of same-person pairs are under 0.45–0.51 and only 0.1% of different-person
 *  pairs under 0.47–0.51. 0.45 left the same person counted twice too often (exact 45–65%); 0.50 counted the room
 *  exactly in 77–90% of lessons, within ±1 in 98–100%, and never too few (also on generated classes with look-alikes). */
export const SAME_PERSON_DISTANCE = 0.5;

const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0));

/** Two faces seen at the same moment are two different people: the same photo, or overlapping time in one video. */
export function sameMoment(a: Observation, b: Observation) {
  if ((a.capture ?? 0) !== (b.capture ?? 0)) return false;
  if (a.frames && b.frames) return !(a.frames[1] < b.frames[0] || b.frames[1] < a.frames[0]);
  return true;
}

type Group = {faces: Observation[]; student?: string; suggestion?: string};

export function headCount(observations: Observation[], presentIds: Set<string>, samePerson = SAME_PERSON_DISTANCE): HeadCount {
  const groups: Group[] = [];
  const studentGroups = new Map<string, Group>(), suggestionGroups = new Map<string, Group[]>();
  const fits = (g: Group, o: Observation) => !g.faces.some(f => sameMoment(f, o));
  // 1. Every face given to a student belongs to that student.
  for (const o of observations) if (o.studentId) {
    const g = studentGroups.get(o.studentId) ?? {faces: [], student: o.studentId};
    if (!studentGroups.has(o.studentId)) { studentGroups.set(o.studentId, g); groups.push(g); }
    g.faces.push(o);
  }
  // 2. Faces offered as "Is this X?" count once per X (one card per student on the board). If X is already present,
  //    the face is most likely X seen again. But two faces seen at the same moment are two people: the second one is
  //    counted like any other face below.
  const rest: Observation[] = [];
  for (const o of observations) if (!o.studentId && o.suggestion && !o.notStudent) {
    const present = presentIds.has(o.suggestion) ? studentGroups.get(o.suggestion) : undefined;
    if (presentIds.has(o.suggestion)) {
      if (present && fits(present, o)) present.faces.push(o);
      else if (present) { if (o.embedding) rest.push(o); }
      continue;
    }
    const options = suggestionGroups.get(o.suggestion) ?? [];
    const g = options.find(x => fits(x, o));
    if (g) g.faces.push(o);
    else { const fresh = {faces: [o], suggestion: o.suggestion}; options.push(fresh); suggestionGroups.set(o.suggestion, options); groups.push(fresh); }
  }
  // 3. Everyone else with a readable face joins the closest person already seen in a different capture (or at a
  //    different moment of a video), or is a new person.
  rest.push(...observations.filter(o => !o.studentId && (!o.suggestion || o.notStudent) && o.embedding));
  rest.sort((a, b) => (a.capture ?? 0) - (b.capture ?? 0));
  for (const o of rest) {
    let best: Group | undefined, bestD = samePerson;
    for (const g of groups) {
      if (g.faces.some(f => sameMoment(f, o))) continue;
      const d = Math.min(...g.faces.flatMap(f => (f.embedding ? [distance(f.embedding, o.embedding!)] : [])));
      if (d <= bestD) { bestD = d; best = g; }
    }
    if (best) best.faces.push(o); else groups.push({faces: [o]});
  }
  // 4. Unreadable faces: per capture, so the same blurry person in three photos is not counted three times.
  const unclearPerCapture = new Map<number, number>();
  for (const o of observations) if (!o.studentId && !o.embedding && !(o.suggestion && !o.notStudent))
    unclearPerCapture.set(o.capture ?? 0, (unclearPerCapture.get(o.capture ?? 0) ?? 0) + 1);
  const unclear = Math.max(0, ...unclearPerCapture.values());

  const students = presentIds.size;
  const toConfirm = groups.filter(g => g.suggestion).length;
  const unregistered = groups.filter(g => !g.student && !g.suggestion).length;
  return {total: students + toConfirm + unregistered + unclear, students, toConfirm, unregistered, unclear};
}
