import {isTightPortrait, tileGrid, groupTileSizes, dedupeBoxes, MIN_RECOGNISABLE_FACE_PX} from './face-geometry';
import {describeFaceWithPose, describeClassroomFaceWithPose} from './embeddings';
import {FaceDetector, FilesetResolver} from '@mediapipe/tasks-vision';
import type {Face} from './store';
import type {DetectedFace} from './attendance';

let detector: Promise<FaceDetector> | undefined;
export function ready() {
  return (detector ??= FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`)
    .then(files => FaceDetector.createFromOptions(files, {
      baseOptions: {modelAssetPath: `${import.meta.env.BASE_URL}models/face-detector.tflite`, delegate: 'CPU'},
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.6,
    }))
    .catch(e => { detector = undefined; throw e; }));
}

export type ScanProgress = (fraction: number, stage: string) => void;
type RawDetection = ReturnType<FaceDetector['detect']>['detections'][number];
export type Detection = Omit<RawDetection, 'boundingBox'> & {boundingBox: NonNullable<RawDetection['boundingBox']>};
type Source = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

/** Copy any image, video frame or canvas into a canvas of its natural size. */
export function toFrame(source: Source) {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source instanceof HTMLImageElement ? source.naturalWidth : source.width,
    h = source instanceof HTMLVideoElement ? source.videoHeight : source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!w || !h) throw Error('Image is not ready.');
  const frame = document.createElement('canvas');
  frame.width = w; frame.height = h;
  frame.getContext('2d')!.drawImage(source, 0, 0);
  return frame;
}

/** Step 1: find faces. `group` adds the classroom detector over the whole frame and overlapping tiles. */
export async function findFaces(frame: HTMLCanvasElement, options: {group?: boolean; lowRes?: boolean; onProgress?: ScanProgress; progressShare?: number} = {}): Promise<Detection[]> {
  const model = await ready();
  const w = frame.width, h = frame.height;
  const detections: Detection[] = model.detect(frame).detections.map(d => ({...d, boundingBox: {...d.boundingBox!}}));
  // A saved face crop can fill the frame too tightly for the detector. Add context,
  // keeping coordinates in original pixels; do not lower the detection threshold.
  if (!detections.length && Math.min(w, h) < 500 && w / h > 0.7 && w / h < 1.4) {
    const pad = Math.round(Math.max(w, h) * 0.25), context = document.createElement('canvas');
    context.width = w + pad * 2; context.height = h + pad * 2;
    const cc = context.getContext('2d')!;
    cc.fillStyle = '#999'; cc.fillRect(0, 0, context.width, context.height); cc.drawImage(frame, pad, pad);
    for (const d of model.detect(context).detections) {
      const b = d.boundingBox!, cx = b.originX + b.width / 2 - pad, cy = b.originY + b.height / 2 - pad;
      if (cx < 0 || cx > w || cy < 0 || cy > h) continue;
      detections.push({...d, boundingBox: {...b, originX: b.originX - pad, originY: b.originY - pad},
        keypoints: d.keypoints.map(p => ({...p, x: (p.x * context.width - pad) / w, y: (p.y * context.height - pad) / h}))});
    }
  }
  // Classroom photos: the selfie-range BlazeFace model above cannot see small, distant faces.
  // Dark or washed-out photos (smartboard webcams): look for faces in a levels-corrected copy; identity features still
  // come from the original photo. On a dim 720p class photo this found 15 of 18 mid-row faces instead of 4, 0 false.
  if (options.group) detections.push(...await groupDetections(normalisedForDetection(frame), options.onProgress, options.progressShare ?? 0.7, !!options.lowRes));
  return dedupeBoxes(detections.map(d => ({...d, score: d.categories[0]?.score ?? 0, box: d.boundingBox})));
}

/** A brightened copy of a dark photo (mean brightness below 100 of 255), otherwise the photo itself. */
export function brightened(frame: HTMLCanvasElement) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 64;
  const px = probe.getContext('2d', {willReadFrequently: true})!;
  px.drawImage(frame, 0, 0, 64, 64);
  const d = px.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  const mean = sum / (64 * 64);
  if (mean >= 100) return frame;
  const gamma = Math.log(125 / 255) / Math.log(Math.max(mean, 8) / 255);
  const lut = new Uint8ClampedArray(256).map((_, v) => 255 * (v / 255) ** gamma);
  const out = document.createElement('canvas');
  out.width = frame.width; out.height = frame.height;
  const ox = out.getContext('2d', {willReadFrequently: true})!;
  ox.drawImage(frame, 0, 0);
  const img = ox.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = lut[img.data[i]]; img.data[i + 1] = lut[img.data[i + 1]]; img.data[i + 2] = lut[img.data[i + 2]]; }
  ox.putImageData(img, 0, 0);
  return out;
}

/** Smartboard and webcam photos are often dim and washed out (low contrast). A copy with levels stretched from the
 *  1st to the 99th percentile of brightness and then brightened like `brightened`; the photo itself when it already uses
 *  most of the range. Only for finding faces: identity features still come from the original photo. */
export function normalisedForDetection(frame: HTMLCanvasElement) {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 128;
  const px = probe.getContext('2d', {willReadFrequently: true})!;
  px.drawImage(frame, 0, 0, 128, 128);
  const d = px.getImageData(0, 0, 128, 128).data, hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114)]++;
  const at = (q: number) => { let n = 0; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= q * 128 * 128) return v; } return 255; };
  const lo = at(LEVELS.low), hi = at(LEVELS.high);
  let mean = 0; for (let v = 0; v < 256; v++) mean += v * hist[v]; mean /= 128 * 128;
  if (hi - lo >= LEVELS.minRange && mean >= 100) return frame;
  const span = Math.max(hi - lo, 16), stretchedMean = Math.min(255, Math.max(1, (mean - lo) * 255 / span));
  const gamma = stretchedMean < 100 ? Math.log(125 / 255) / Math.log(Math.max(stretchedMean, 8) / 255) : 1;
  const lut = new Uint8ClampedArray(256).map((_, v) => 255 * Math.min(1, Math.max(0, (v - lo) / span)) ** gamma);
  const out = document.createElement('canvas');
  out.width = frame.width; out.height = frame.height;
  const ox = out.getContext('2d', {willReadFrequently: true})!;
  ox.drawImage(frame, 0, 0);
  const img = ox.getImageData(0, 0, out.width, out.height);
  for (let i = 0; i < img.data.length; i += 4) { img.data[i] = lut[img.data[i]]; img.data[i + 1] = lut[img.data[i + 1]]; img.data[i + 2] = lut[img.data[i + 2]]; }
  ox.putImageData(img, 0, 0);
  return out;
}
/** Levels stretch: percentiles used as black and white, and the brightness range below which a photo is stretched. */
export const LEVELS = {low: .01, high: .99, minRange: 200};

async function groupDetections(frame: HTMLCanvasElement, onProgress: ScanProgress | undefined, share: number, lowRes: boolean): Promise<Detection[]> {
  const {detectFaceBoxes} = await import('./embeddings');
  const w = frame.width, h = frame.height;
  const toDetection = (b: {x: number; y: number; width: number; height: number; score: number}): Detection => ({
    boundingBox: {originX: b.x, originY: b.y, width: b.width, height: b.height, angle: 0},
    categories: [{score: b.score, index: 0, categoryName: 'face', displayName: 'face'}],
    keypoints: [],
  });
  onProgress?.(0, 'Finding faces');
  const out = (await detectFaceBoxes(frame, 0.5)).map(toDetection);
  const tiles = groupTileSizes(w, h, lowRes).flatMap(size => tileGrid(w, h, size));
  let scanned = 0;
  for (const t of tiles) {
    onProgress?.(share * ++scanned / (tiles.length + 1), 'Finding faces');
    const tile = document.createElement('canvas');
    tile.width = t.w; tile.height = t.h;
    tile.getContext('2d')!.drawImage(frame, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
    for (const b of await detectFaceBoxes(tile, 0.5)) {
      // A face cut by a tile edge is found whole in a neighbouring tile or the full frame.
      const edge = 3,
        cut = (b.x < edge && t.x > 0) || (b.y < edge && t.y > 0) || (b.x + b.width > t.w - edge && t.x + t.w < w) || (b.y + b.height > t.h - edge && t.y + t.h < h);
      if (!cut) out.push(toDetection({...b, x: b.x + t.x, y: b.y + t.y}));
    }
  }
  return out;
}

/** Step 2: thumbnail, quality checks and identity features for one detected face. */
export async function describeDetection(frame: HTMLCanvasElement, d: Detection, options: {classroom?: boolean; tight?: boolean} = {}): Promise<DetectedFace> {
  const w = frame.width, h = frame.height, box = d.boundingBox, points = d.keypoints ?? [];
  const eye1 = points[0], eye2 = points[1];
  const cx = box.originX + box.width / 2, cy = box.originY + box.height * 0.48, size = Math.max(box.width, box.height) * 1.2;
  let angle = 0;
  if (eye1 && eye2) {
    let dx = (eye2.x - eye1.x) * w, dy = (eye2.y - eye1.y) * h;
    if (dx < 0) { dx = -dx; dy = -dy; }
    angle = Math.atan2(dy, dx);
  }
  const crop = document.createElement('canvas');
  crop.width = crop.height = 96;
  const ctx = crop.getContext('2d')!;
  if (options.tight) ctx.drawImage(frame, 0, 0, 96, 96);
  else { ctx.translate(48, 48); ctx.rotate(-angle); ctx.scale(96 / size, 96 / size); ctx.drawImage(frame, -cx, -cy); }
  const small = document.createElement('canvas');
  small.width = small.height = 24;
  const sc = small.getContext('2d', {willReadFrequently: true})!;
  sc.drawImage(crop, 0, 0, 24, 24);
  const pixels = sc.getImageData(0, 0, 24, 24).data,
    gray = Array.from({length: 576}, (_, i) => (pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114) / 255),
    mean = gray.reduce((a, v) => a + v, 0) / 576,
    std = Math.sqrt(gray.reduce((a, v) => a + (v - mean) ** 2, 0) / 576);
  let sharp = 0;
  for (let y = 1; y < 23; y++) for (let x = 1; x < 23; x++) {
    const i = y * 24 + x;
    sharp += (4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - 24] - gray[i + 24]) ** 2;
  }
  // Classroom scans recognise faces from 32 px (tested: as accurate as 45 px, never a wrong student); enrolment keeps 45 px.
  const minSide = options.classroom ? MIN_RECOGNISABLE_FACE_PX : 45;
  const usable = box.width >= minSide && box.height >= minSide && std > 0.045 && sharp / 484 > 0.0005;
  const face: Face = {image: crop.toDataURL('image/jpeg', 0.8), vector: gray.map(v => (v - mean) / Math.max(std, 0.05))};
  if (usable) {
    const sharpCrop = identityCrop(frame, cx, cy, size, angle, !!options.tight);
    const described = options.classroom ? await describeClassroomFaceWithPose(sharpCrop) : await describeFaceWithPose(sharpCrop);
    face.embedding = described.vector;
    face.yaw = Math.round(described.yaw * 1000) / 1000;
  }
  return {sourceWidth: w, sourceHeight: h, face, usable, box: {x: box.originX / w, y: box.originY / h, w: box.width / w, h: box.height / h}};
}

/** Find and describe every face in an image or video frame. */
export async function detect(source: Source, options: {group?: boolean; onProgress?: ScanProgress} = {}): Promise<DetectedFace[]> {
  const frame = toFrame(source);
  // Photos (not video frames) get the extra small-face scan when they are low resolution.
  const found = await findFaces(frame, {...options, lowRes: true});
  const faces: DetectedFace[] = [];
  for (const d of found) {
    faces.push(await describeDetection(frame, d, {classroom: options.group, tight: isTightPortrait(frame.width, frame.height, found.length, d.boundingBox)}));
    if (options.group) options.onProgress?.(0.7 + 0.3 * faces.length / found.length, 'Recognising students');
  }
  return faces;
}

/** Sharper crop for identity features: up to 224 px from the original pixels instead of the 96 px thumbnail. */
function identityCrop(frame: HTMLCanvasElement, cx: number, cy: number, size: number, angle: number, tight: boolean) {
  const side = Math.max(96, Math.min(224, Math.round(tight ? Math.min(frame.width, frame.height) : size)));
  const c = document.createElement('canvas');
  c.width = c.height = side;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  if (tight) ctx.drawImage(frame, 0, 0, side, side);
  else { ctx.translate(side / 2, side / 2); ctx.rotate(-angle); ctx.scale(side / size, side / size); ctx.drawImage(frame, -cx, -cy); }
  return c;
}

export async function imageFile(file: File, options: {group?: boolean; onProgress?: ScanProgress} = {}) {
  if (file.size > 30 * 1024 * 1024) throw Error('Choose an image smaller than 30 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await detect(img, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}
