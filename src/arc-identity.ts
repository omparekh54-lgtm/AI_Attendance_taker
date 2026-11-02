/**
 * Recognition with ArcFace features (see arcface.ts), with the project's from-scratch PCA + LDA on top.
 *
 * A face's score for a student is the mean cosine similarity of its 3 closest gallery features (registration crops,
 * also described as seen small in a class photo). Decisions, measured on the 27 registered students and two real
 * group photos (research/arcface-class-photos.md):
 *  - same person in a class photo: 0.35–0.71; unregistered people in the same photos: at most 0.29.
 *  - each student gets their own bar, set just above the closest any CLASSMATE comes to them (look-alike pairs such
 *    as two students with similar glasses get a higher bar than a student nobody resembles).
 *  - a mark also needs a clear lead over the next student and the PCA/LDA projection to agree.
 */
import {train, features, type Model, type Sample} from './model';
import {ARC_EXTRACTOR, ARC_DIMENSIONS} from './arcface';

/** Bumped when the matching rules change, so a saved model is rebuilt. */
export const ARC_RULES = 1;
export type ArcModel = {extractor: typeof ARC_EXTRACTOR; rules: number; gallery: Record<string, number[][]>; accept: Record<string, number>; pcaLda: Model; centroids: Record<string, number[]>};

export const ARC = {
  /** Gallery features averaged per student (top-k cosine). */
  neighbors: 3,
  /** Student's bar = the closest classmates come to them (98th percentile) + gap, kept within [floor, ceiling]. */
  impostorPercentile: 0.98, impostorGap: 0.06, floor: 0.36, ceiling: 0.52,
  /** Lead over the next student needed to mark automatically / to suggest. */
  margin: 0.1, suggestMargin: 0.06,
  /** Suggest ("Is this …?") down to this far below the student's bar, never below `suggestFloor`. */
  suggestBelow: 0.12, suggestFloor: 0.3,
  /** Best guess ("Maybe …?"): only a face that still clearly leans to one student. Strangers in the real class
   *  photos reached 0.29 with almost no lead, so below this the face is simply "Not registered". */
  guessFloor: 0.27, guessMargin: 0.05,
  /** Faces narrower than this (detector box, px) are never marked on their own. */
  autoMarkMinPx: 16,
  /** A face this close (cosine) to someone the teacher marked "Not a student", relative to its best student, is left unknown. */
  strangerGap: 0.03,
};

const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = (v: number[]) => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
export const isArcFeature = (v: unknown): v is number[] => Array.isArray(v) && v.length === ARC_DIMENSIONS && v.every(x => Number.isFinite(x) && Math.abs(x) <= 1.0001);

function topMean(gallery: number[][], v: number[], k: number) {
  const s = gallery.map(g => dot(g, v)).sort((a, b) => b - a);
  const n = Math.min(k, s.length);
  return s.slice(0, n).reduce((a, b) => a + b, 0) / Math.max(n, 1);
}
export function arcScores(model: Pick<ArcModel, 'gallery'>, v: number[]) {
  return Object.entries(model.gallery).map(([label, g]) => ({label, score: topMean(g, v, ARC.neighbors)})).sort((a, b) => b.score - a.score);
}

/** Per student: registration features (several sizes) plus faces the teacher confirmed in class photos. */
export type ArcStudent = {id: string; arc: number[][]; learned?: number[][]};

export function trainArc(students: ArcStudent[]): ArcModel {
  if (students.length < 2) throw Error('Register at least two students before training.');
  for (const s of students) if (s.arc.length < 5 || !s.arc.every(isArcFeature)) throw Error('Invalid ArcFace features for a student.');
  const gallery: Record<string, number[][]> = {};
  for (const s of students) gallery[s.id] = [...s.arc, ...(s.learned ?? []).filter(isArcFeature)].map(unit);
  // How close does every OTHER student's photo come to this student? Unregistered people are classmates of the same
  // age and background, so the class itself is the best stand-in for strangers.
  const accept: Record<string, number> = {};
  for (const s of students) {
    const others = students.filter(o => o.id !== s.id).flatMap(o => gallery[o.id].map(v => topMean(gallery[s.id], v, ARC.neighbors))).sort((a, b) => a - b);
    const closest = others.length ? others[Math.floor((others.length - 1) * ARC.impostorPercentile)] : 0;
    accept[s.id] = Math.min(ARC.ceiling, Math.max(ARC.floor, closest + ARC.impostorGap));
  }
  // The from-scratch PCA (64 components) + LDA, trained on the same gallery. It votes on WHO a face is (it agreed with
  // every confident match on the real photos) but cannot tell a stranger apart, so it never marks anyone by itself.
  const samples: Sample[] = students.flatMap(s => gallery[s.id].map(vector => ({label: s.id, vector})));
  const pcaLda = train(samples, {components: 64});
  const centroids: Record<string, number[]> = {};
  for (const s of students) {
    const z = gallery[s.id].map(v => unit(features(pcaLda, v)));
    centroids[s.id] = unit(z[0].map((_, i) => z.reduce((a, r) => a + r[i], 0) / z.length));
  }
  return {extractor: ARC_EXTRACTOR, rules: ARC_RULES, gallery, accept, pcaLda: {...pcaLda, templates: []}, centroids};
}

/** LDA's choice: the student whose class centre the projected face points at most. */
export function ldaChoice(model: ArcModel, v: number[]) {
  const z = unit(features(model.pcaLda, v));
  let best = '', bestS = -Infinity;
  for (const [label, c] of Object.entries(model.centroids)) { const s = dot(z, c); if (s > bestS) { bestS = s; best = label; } }
  return best;
}

export type ArcPrediction = {label: string; score: number; second: number; margin: number; bar: number; accepted: boolean; suggested: boolean; guessable: boolean; stranger: boolean; ldaAgrees: boolean; candidates: string[]; scores: {label: string; score: number}[]};

/** `facePx`: width of the face in the photo (detector box). `strangers`: features of people marked "Not a student". */
export function predictArc(model: ArcModel, vector: number[], strangers: number[][] = [], facePx = Infinity): ArcPrediction {
  if (!isArcFeature(vector)) throw Error('Invalid face features.');
  const v = unit(vector), scores = arcScores(model, v), best = scores[0], second = scores[1]?.score ?? 0;
  const margin = best.score - second, bar = model.accept[best.label] ?? ARC.ceiling;
  const strangerScore = strangers.filter(isArcFeature).reduce((m, s) => Math.max(m, dot(unit(s), v)), -1);
  const stranger = strangerScore >= best.score - ARC.strangerGap;
  const ldaAgrees = ldaChoice(model, v) === best.label;
  const accepted = !stranger && ldaAgrees && best.score >= bar && margin >= ARC.margin && facePx >= ARC.autoMarkMinPx;
  const suggested = !accepted && !stranger && best.score >= Math.max(ARC.suggestFloor, bar - ARC.suggestBelow) && margin >= ARC.suggestMargin;
  const guessable = !accepted && !suggested && !stranger && best.score >= ARC.guessFloor && margin >= ARC.guessMargin;
  return {label: best.label, score: best.score, second, margin, bar, accepted, suggested, guessable, stranger, ldaAgrees, candidates: scores.slice(0, 3).map(s => s.label), scores};
}

/** Hungarian algorithm (minimum cost), square or rectangular cost matrix rows × cols. Returns the column per row (-1: none). */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length, m = cost[0]?.length ?? 0, N = Math.max(n, m), BIG = 1e9;
  if (!n || !m) return Array(n).fill(-1);
  const a = Array.from({length: N}, (_, i) => Array.from({length: N}, (_, j) => (i < n && j < m ? cost[i][j] : BIG / 1e3)));
  const u = Array(N + 1).fill(0), v = Array(N + 1).fill(0), p = Array(N + 1).fill(0), way = Array(N + 1).fill(0);
  for (let i = 1; i <= N; i++) {
    p[0] = i; let j0 = 0;
    const minv = Array(N + 1).fill(Infinity), used = Array(N + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) if (!used[j]) {
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = Array(n).fill(-1);
  for (let j = 1; j <= N; j++) if (p[j] && p[j] <= n && j <= m) out[p[j] - 1] = j - 1;
  return out;
}

/** One student per face in a photo: the assignment with the highest total score among students each face could be
 *  (score at least the suggestion floor). Returns, per face, the student it keeps (undefined: none). */
export function assignStudents(predictions: (ArcPrediction | undefined)[]): (string | undefined)[] {
  const labels = [...new Set(predictions.flatMap(p => (p ? p.scores.filter(s => s.score >= ARC.suggestFloor).map(s => s.label) : [])))];
  if (!labels.length) return predictions.map(() => undefined);
  const cost = predictions.map(p => labels.map(l => { const s = p?.scores.find(x => x.label === l)?.score ?? 0; return s >= ARC.suggestFloor ? 1 - s : 10; }));
  return hungarian(cost).map((j, i) => (j >= 0 && cost[i][j] < 10 ? labels[j] : undefined));
}

/** Faces closer than this (cosine) in different captures are taken to be the same person (head count).
 *  Real class photos: the same student scored 0.35–0.71 against their own registration; strangers 0.29 at most. */
export const ARC_SAME_PERSON = 0.35;
