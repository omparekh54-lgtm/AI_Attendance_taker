/**
 * Modern face engine: SCRFD-10G face detector + ArcFace (ResNet-50, WebFace600K) identity features, both from
 * InsightFace (buffalo_l), run in the browser with onnxruntime-web. Photos never leave the device.
 *
 *  1. detectArcFaces: finds faces over the whole photo and overlapping tiles (small, back-row faces), each with
 *     5 landmarks (eyes, nose, mouth corners).
 *  2. alignFace: rotates and scales each face onto ArcFace's standard 112×112 template using those 5 points.
 *  3. arcEmbed: 512 identity numbers per face (unit length; cosine similarity compares two faces).
 *
 * InsightFace's pretrained models are licensed for non-commercial research use (see THIRD_PARTY_NOTICES.md).
 */
import type * as Ort from 'onnxruntime-web/wasm';

export const ARC_EXTRACTOR = 'arcface-r50-webface600k-v1';
export const ARC_DIMENSIONS = 512;
/** The model files (61 MB) are kept in the repository under models/arc but outside the web build, which would otherwise
 *  exceed Vercel's 250 MB limit. Browsers load them from GitHub at the commit that added them (CORS allowed, cached by
 *  the browser). To change the models, commit the new files, then point this at that commit. */
export const ARC_MODELS_COMMIT = '59fc335b9ce9562b76a2935a724fb95049aaaec6';
const base = () => (import.meta.env.VITE_ARC_MODELS as string | undefined) ?? `https://raw.githubusercontent.com/omparekh54-lgtm/AI_Attendance_taker/${ARC_MODELS_COMMIT}/models/arc/`;

let runtime: Promise<typeof Ort> | undefined;
let detector: Promise<Ort.InferenceSession> | undefined;
let recognizer: Promise<Ort.InferenceSession> | undefined;
let queue: Promise<unknown> = Promise.resolve();
/** One model run at a time: onnxruntime-web sessions are not re-entrant. */
function serial<T>(fn: () => Promise<T>): Promise<T> { const work = queue.then(fn); queue = work.catch(() => {}); return work; }

function ort() {
  return (runtime ??= import('onnxruntime-web/wasm').then(m => {
    // The JavaScript loader is bundled with the app; only the WebAssembly binary is fetched (served from /static/ort).
    m.env.wasm.wasmPaths = {wasm: `${import.meta.env.BASE_URL}ort/ort-wasm-simd-threaded.wasm`};
    m.env.wasm.numThreads = Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 2));
    return m;
  }).catch(e => { runtime = undefined; throw e; }));
}
async function session(file: string) {
  const m = await ort();
  return m.InferenceSession.create(base() + file, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
}
const fail = (what: string) => (e: unknown) => { throw Error(`${what} could not load. Check your connection and retry. ${(e as Error).message}`); };
export function detectorReady() { return (detector ??= session('det_10g.onnx').catch(e => { detector = undefined; return fail('Face detector')(e); })); }
export function recognizerReady() { return (recognizer ??= session('arcface_r50.onnx').catch(e => { recognizer = undefined; return fail('Recognition model')(e); })); }

export type ArcBox = {x: number; y: number; w: number; h: number; score: number; kps: [number, number][]};

// ---------------------------------------------------------------- detection
const DET = {input: 640, threshold: 0.4, nms: 0.4, strides: [8, 16, 32], anchors: 2};

/** SCRFD on one square input: the canvas is fitted into 640×640 (top-left, padded). Boxes in canvas pixels. */
async function detectOnce(source: HTMLCanvasElement, threshold: number): Promise<ArcBox[]> {
  const S = DET.input, scale = Math.min(S / source.width, S / source.height);
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d', {willReadFrequently: true})!;
  x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, Math.round(source.width * scale), Math.round(source.height * scale));
  const px = x.getImageData(0, 0, S, S).data, input = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) { input[i] = (px[i * 4] - 127.5) / 128; input[S * S + i] = (px[i * 4 + 1] - 127.5) / 128; input[2 * S * S + i] = (px[i * 4 + 2] - 127.5) / 128; }
  const m = await ort(), net = await detectorReady();
  const out = await serial(() => net.run({[net.inputNames[0]]: new m.Tensor('float32', input, [1, 3, S, S])}));
  const o = net.outputNames.map(n => out[n].data as Float32Array);
  const found: ArcBox[] = [];
  DET.strides.forEach((stride, si) => {
    const scores = o[si], boxes = o[si + 3], kps = o[si + 6], cols = Math.ceil(S / stride);
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] < threshold) continue;
      const cell = Math.floor(i / DET.anchors), ax = (cell % cols) * stride, ay = Math.floor(cell / cols) * stride;
      const x1 = ax - boxes[i * 4] * stride, y1 = ay - boxes[i * 4 + 1] * stride, x2 = ax + boxes[i * 4 + 2] * stride, y2 = ay + boxes[i * 4 + 3] * stride;
      const points: [number, number][] = [];
      for (let k = 0; k < 5; k++) points.push([(ax + kps[i * 10 + k * 2] * stride) / scale, (ay + kps[i * 10 + k * 2 + 1] * stride) / scale]);
      found.push({x: x1 / scale, y: y1 / scale, w: (x2 - x1) / scale, h: (y2 - y1) / scale, score: scores[i], kps: points});
    }
  });
  return nms(found, DET.nms);
}

function iou(a: ArcBox, b: ArcBox) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return w * h / (a.w * a.h + b.w * b.h - w * h);
}
export function nms(boxes: ArcBox[], limit: number) {
  const kept: ArcBox[] = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) if (kept.every(k => iou(k, b) < limit)) kept.push(b);
  return kept;
}

/** Tiles over a large photo. Small photos (≤ 2000 px) are also scanned at 2× so 15–25 px faces are found. */
export function arcTiles(w: number, h: number) {
  const zoom = Math.max(w, h) <= 2000 ? 2 : 1, side = Math.round(DET.input / zoom), step = Math.round(side * 0.7);
  if (w <= side && h <= side && zoom === 1) return [];
  const xs: number[] = [], ys: number[] = [];
  for (let x = 0; ; x += step) { xs.push(Math.min(x, Math.max(0, w - side))); if (x + side >= w) break; }
  for (let y = 0; ; y += step) { ys.push(Math.min(y, Math.max(0, h - side))); if (y + side >= h) break; }
  return [...new Set(ys)].flatMap(y => [...new Set(xs)].map(x => ({x, y, w: Math.min(side, w), h: Math.min(side, h), zoom})));
}

/** Every face in a photo: the whole frame plus overlapping tiles, merged. */
export async function detectArcFaces(frame: HTMLCanvasElement, onProgress?: (fraction: number) => void, threshold = DET.threshold): Promise<ArcBox[]> {
  const all = await detectOnce(frame, threshold);
  const tiles = arcTiles(frame.width, frame.height);
  for (const [n, t] of tiles.entries()) {
    onProgress?.((n + 1) / (tiles.length + 1));
    const tile = document.createElement('canvas');
    tile.width = Math.round(t.w * t.zoom); tile.height = Math.round(t.h * t.zoom);
    const tx = tile.getContext('2d')!; tx.imageSmoothingQuality = 'high';
    tx.drawImage(frame, t.x, t.y, t.w, t.h, 0, 0, tile.width, tile.height);
    for (const b of await detectOnce(tile, threshold)) {
      const edge = 2 * t.zoom, cut = (b.x < edge && t.x > 0) || (b.y < edge && t.y > 0) || (b.x + b.w > tile.width - edge && t.x + t.w < frame.width) || (b.y + b.h > tile.height - edge && t.y + t.h < frame.height);
      if (cut) continue;
      all.push({x: b.x / t.zoom + t.x, y: b.y / t.zoom + t.y, w: b.w / t.zoom, h: b.h / t.zoom, score: b.score, kps: b.kps.map(([px, py]) => [px / t.zoom + t.x, py / t.zoom + t.y] as [number, number])});
    }
  }
  return nms(all, DET.nms);
}

// ---------------------------------------------------------------- alignment
/** ArcFace's 112×112 reference positions for the 5 landmarks. */
export const ARC_TEMPLATE: [number, number][] = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];

/** Least-squares similarity transform (rotation, uniform scale, shift) taking `from` onto `to` (Umeyama).
 *  Returns [a, b, tx, ty]: x' = a·x − b·y + tx, y' = b·x + a·y + ty. */
export function similarity(from: [number, number][], to: [number, number][]): [number, number, number, number] {
  const n = from.length, mean = (p: [number, number][], k: 0 | 1) => p.reduce((s, q) => s + q[k], 0) / n;
  const fx = mean(from, 0), fy = mean(from, 1), tx = mean(to, 0), ty = mean(to, 1);
  let sxx = 0, sxy = 0, var_ = 0;
  for (let i = 0; i < n; i++) {
    const ax = from[i][0] - fx, ay = from[i][1] - fy, bx = to[i][0] - tx, by = to[i][1] - ty;
    sxx += ax * bx + ay * by; sxy += ax * by - ay * bx; var_ += ax * ax + ay * ay;
  }
  const a = sxx / var_, b = sxy / var_;
  return [a, b, tx - (a * fx - b * fy), ty - (b * fx + a * fy)];
}

/** The face as ArcFace expects it: 112×112, eyes, nose and mouth on the template. */
export function alignFace(frame: HTMLCanvasElement | HTMLImageElement, kps: [number, number][]) {
  const [a, b, tx, ty] = similarity(kps, ARC_TEMPLATE);
  const c = document.createElement('canvas'); c.width = c.height = 112;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000'; x.fillRect(0, 0, 112, 112); x.imageSmoothingQuality = 'high';
  x.setTransform(a, b, -b, a, tx, ty); x.drawImage(frame, 0, 0);
  return c;
}

/** A face as it would look in a class photo with a face `px` wide: shrunk, JPEG-compressed, then enlarged again. */
export async function degradeAligned(face: HTMLCanvasElement, px: number) {
  const side = Math.max(6, Math.round(112 * px / 62));
  const small = document.createElement('canvas'); small.width = small.height = side;
  const sx = small.getContext('2d')!; sx.imageSmoothingQuality = 'high'; sx.drawImage(face, 0, 0, side, side);
  const img = new Image(); img.src = small.toDataURL('image/jpeg', 0.75); await img.decode();
  const up = document.createElement('canvas'); up.width = up.height = 112;
  up.getContext('2d')!.drawImage(img, 0, 0, 112, 112);
  return up;
}

/** Head turn from the 5 landmarks: nose offset from the eye midpoint, in eye distances (0 = facing the camera). */
export function yawFromKeypoints(kps: [number, number][]) {
  const [l, r, nose] = kps, eye = Math.hypot(r[0] - l[0], r[1] - l[1]) || 1;
  return ((nose[0] - (l[0] + r[0]) / 2) / eye) * 2;
}

// ---------------------------------------------------------------- recognition
function tensorOf(faces: HTMLCanvasElement[], mirror: boolean) {
  const n = faces.length, data = new Float32Array(n * 3 * 112 * 112), plane = 112 * 112;
  faces.forEach((f, k) => {
    const c = document.createElement('canvas'); c.width = c.height = 112;
    const x = c.getContext('2d', {willReadFrequently: true})!;
    if (mirror) { x.translate(112, 0); x.scale(-1, 1); }
    x.drawImage(f, 0, 0);
    const px = x.getImageData(0, 0, 112, 112).data, o = k * 3 * plane;
    for (let i = 0; i < plane; i++) { data[o + i] = (px[i * 4] - 127.5) / 127.5; data[o + plane + i] = (px[i * 4 + 1] - 127.5) / 127.5; data[o + 2 * plane + i] = (px[i * 4 + 2] - 127.5) / 127.5; }
  });
  return data;
}

/** 512 identity numbers per aligned face, unit length. `mirror`: also read the mirror image and average (steadier for
 *  class-photo faces; registration crops skip it, being many and clear). */
export async function arcEmbed(faces: HTMLCanvasElement[], mirror = true): Promise<number[][]> {
  if (!faces.length) return [];
  const m = await ort(), net = await recognizerReady(), out: number[][] = [];
  for (let i = 0; i < faces.length; i += 8) {
    const batch = faces.slice(i, i + 8), sums = batch.map(() => new Float32Array(ARC_DIMENSIONS));
    for (const flip of mirror ? [false, true] : [false]) {
      const r = await serial(() => net.run({[net.inputNames[0]]: new m.Tensor('float32', tensorOf(batch, flip), [batch.length, 3, 112, 112])}));
      const d = r[net.outputNames[0]].data as Float32Array;
      batch.forEach((_, k) => { for (let j = 0; j < ARC_DIMENSIONS; j++) sums[k][j] += d[k * ARC_DIMENSIONS + j]; });
    }
    for (const s of sums) { const n = Math.hypot(...s) || 1; out.push(Array.from(s, v => v / n)); }
  }
  return out;
}

/** Find a face in a stored registration crop (a tight 96 px thumbnail): padded and enlarged so the detector sees it whole. */
export async function landmarksInCrop(image: HTMLImageElement | HTMLCanvasElement) {
  const w = image.width, pad = Math.round(w / 2), c = document.createElement('canvas');
  c.width = c.height = (w + pad * 2) * 2;
  const x = c.getContext('2d')!;
  x.fillStyle = '#808080'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high';
  x.drawImage(image, pad * 2, pad * 2, w * 2, image.height * 2);
  const found = await detectOnce(c, 0.3);
  if (!found.length) return undefined;
  const best = found.reduce((p, q) => (q.w * q.h * q.score > p.w * p.h * p.score ? q : p));
  return {canvas: c, kps: best.kps};
}

// ---------------------------------------------------------------- compact storage
/** A 512-number feature stored as text: "scale:base64(int8)". About 690 characters instead of ~4 KB of JSON. */
export function packFeature(v: number[]) {
  const max = Math.max(...v.map(Math.abs)) || 1, scale = max / 127, bytes = new Int8Array(v.length);
  v.forEach((x, i) => { bytes[i] = Math.round(x / scale); });
  let bin = ''; new Uint8Array(bytes.buffer).forEach(b => { bin += String.fromCharCode(b); });
  return `${scale.toPrecision(6)}:${btoa(bin)}`;
}
export function unpackFeature(s: string): number[] {
  const [scale, data] = s.split(':'), bin = atob(data), bytes = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = (bin.charCodeAt(i) << 24) >> 24;
  const v = Array.from(bytes, b => b * Number(scale)), n = Math.hypot(...v) || 1;
  return v.map(x => x / n);
}
export const isPackedFeature = (s: unknown): s is string => typeof s === 'string' && /^[0-9.e+-]+:[A-Za-z0-9+/]{683}=$/.test(s);
