/** Follow faces across video frames by position. Robust to camera panning: the frame-to-frame shift is the one
 *  that lines up the most faces (every face pair is a candidate shift), then each face joins the nearest track. */
export type Track<T> = {cx: number; cy: number; size: number; firstFrame?: number; startX?: number; startY?: number; lastFrame: number; shiftX: number; shiftY: number; sig?: number[]; samples: T[]};
/** `sig`: a tiny normalised grey thumbnail of the face; it stops neighbouring seats being confused during fast pans. */
export type Point<T> = {cx: number; cy: number; size: number; sig?: number[]; sample: T};

/** Correlation of two normalised signatures, -1..1. */
export function likeness(a?: number[], b?: number[]) {
  if (!a || !b || a.length !== b.length) return 1;
  return a.reduce((n, v, i) => n + v * b[i], 0) / a.length;
}
const MIN_LIKENESS = 0.2;

const MAX_GAP = 3, MATCH_RADIUS = 0.6, SIZE_RATIO = 1.7;

export function linkFrame<T>(tracks: Track<T>[], frame: number, points: Point<T>[]) {
  const active = tracks.filter(t => frame - t.lastFrame <= MAX_GAP);
  const similar = (a: number, b: number) => Math.max(a, b) / Math.min(a, b) <= SIZE_RATIO;
  const matches = (dx: number, dy: number) => {
    const pairs: {t: Track<T>; p: Point<T>; d: number}[] = [];
    for (const t of active) for (const p of points) {
      if (!similar(t.size, p.size) || likeness(t.sig, p.sig) < MIN_LIKENESS) continue;
      const gap = frame - t.lastFrame;
      const d = Math.hypot(p.cx - (t.cx + dx * gap), p.cy - (t.cy + dy * gap)) / Math.min(t.size, p.size);
      // Distance in face widths, penalised when the faces look different.
      if (d < MATCH_RADIUS) pairs.push({t, p, d: d + (1 - likeness(t.sig, p.sig)) * 0.5});
    }
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set<Track<T>>(), usedP = new Set<Point<T>>(), chosen: typeof pairs = [];
    for (const m of pairs) if (!usedT.has(m.t) && !usedP.has(m.p)) { usedT.add(m.t); usedP.add(m.p); chosen.push(m); }
    return chosen;
  };
  // Candidate per-frame shifts: no motion, the previous motion, and every plausible face-to-face displacement.
  const hypotheses = new Map<string, [number, number]>([['0,0', [0, 0]]]);
  for (const t of active) {
    hypotheses.set(`${Math.round(t.shiftX)},${Math.round(t.shiftY)}`, [t.shiftX, t.shiftY]);
    for (const p of points) if (similar(t.size, p.size) && likeness(t.sig, p.sig) >= MIN_LIKENESS) {
      const gap = frame - t.lastFrame, dx = (p.cx - t.cx) / gap, dy = (p.cy - t.cy) / gap;
      hypotheses.set(`${Math.round(dx / 4)},${Math.round(dy / 4)}`, [dx, dy]);
    }
  }
  let best: ReturnType<typeof matches> = [], bestShift: [number, number] = [0, 0];
  for (const [dx, dy] of hypotheses.values()) {
    const m = matches(dx, dy);
    const cost = (x: typeof m) => x.reduce((n, a) => n + a.d, 0);
    if (m.length > best.length || (m.length === best.length && cost(m) < cost(best))) { best = m; bestShift = [dx, dy]; }
  }
  // A single coincidental pair is not enough to believe a large pan when several faces are visible.
  if (best.length === 1 && active.length > 2 && points.length > 2 && Math.hypot(...bestShift) > best[0].p.size) best = matches(0, 0), bestShift = [0, 0];
  const matched = new Set<Point<T>>();
  for (const {t, p} of best) {
    matched.add(p);
    Object.assign(t, {cx: p.cx, cy: p.cy, size: p.size, sig: p.sig ?? t.sig, lastFrame: frame, shiftX: bestShift[0], shiftY: bestShift[1]});
    t.samples.push(p.sample);
  }
  for (const p of points) if (!matched.has(p)) tracks.push({cx: p.cx, cy: p.cy, size: p.size, sig: p.sig, firstFrame: frame, startX: p.cx, startY: p.cy, lastFrame: frame, shiftX: bestShift[0], shiftY: bestShift[1], samples: [p.sample]});
  shifts[frame] = bestShift;
  return tracks;
}

/** Per-frame camera shift estimated by linkFrame, keyed by tracks array. */
const frameShifts = new WeakMap<object, [number, number][]>();
let shifts: [number, number][] = [];
export function beginTracking<T>(tracks: Track<T>[]) { shifts = []; frameShifts.set(tracks, shifts); return tracks; }

/** Join fragments of one person: B starts 1–3 frames after A ends, where the camera motion says A should be. */
export function stitchTracks<T>(tracks: Track<T>[]): Track<T>[] {
  const motion = frameShifts.get(tracks) ?? [];
  const ordered = [...tracks].sort((a, b) => (a.firstFrame ?? 0) - (b.firstFrame ?? 0));
  const merged: Track<T>[] = [];
  for (const t of ordered) {
    let target: Track<T> | undefined, bestD = Infinity;
    for (const m of merged) {
      const gap = (t.firstFrame ?? 0) - m.lastFrame;
      if (gap < 1 || gap > MAX_GAP + 1 || Math.max(m.size, t.size) / Math.min(m.size, t.size) > SIZE_RATIO || likeness(m.sig, t.sig) < MIN_LIKENESS) continue;
      let x = m.cx, y = m.cy;
      for (let f = m.lastFrame + 1; f <= (t.firstFrame ?? 0); f++) { const [dx, dy] = motion[f] ?? [0, 0]; x += dx; y += dy; }
      const d = Math.hypot((t.startX ?? t.cx) - x, (t.startY ?? t.cy) - y) / Math.min(m.size, t.size);
      if (d < 1 && d < bestD) { bestD = d; target = m; }
    }
    if (target) { target.samples.push(...t.samples); Object.assign(target, {cx: t.cx, cy: t.cy, size: t.size, sig: t.sig ?? target.sig, lastFrame: t.lastFrame}); }
    else merged.push(t);
  }
  return merged;
}
