import {findFaces, describeDetection, type Detection, type ScanProgress} from './vision';
import {linkFrame, beginTracking, stitchTracks, type Track} from './tracking';
import type {DetectedFace} from './attendance';

/** FRAMES_PER_TRACK: a person's sharpest frames are each recognised separately and must agree (see FRAME_AGREEMENT). */
export const MAX_VIDEO_SECONDS = 60, MAX_VIDEO_FRAMES = 40, FRAMES_PER_TRACK = 4;
const MAX_FRAME_SIDE = 3840;

type Sample = {frame: number; cx: number; cy: number; area: number; usable: boolean; crop: HTMLCanvasElement; detection: Detection; sourceWidth: number; sourceHeight: number};

/** Classroom video → one face per person. Faces are followed across frames by position (with pan compensation).
 *  Each person's features are averaged over their sharpest frames, and the frames are also passed on one by one
 *  so recognition can check that they keep pointing at the same student. */
export async function scanVideo(file: Blob, onProgress?: ScanProgress): Promise<DetectedFace[]> {
  if (file.size > 300 * 1024 * 1024) throw Error('Choose a video smaller than 300 MB, or record a shorter one.');
  const url = URL.createObjectURL(file), video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(Error('This video format cannot be read here. Record the video on this page, or upload an MP4 or WebM.'));
    });
    const duration = await readDuration(video);
    const times = sampleTimes(duration);
    let tracks: Track<Sample>[] = beginTracking<Sample>([]);
    for (let i = 0; i < times.length; i++) {
      onProgress?.(0.75 * i / times.length, `Reading video · frame ${i + 1} of ${times.length}`);
      await seek(video, times[i]);
      const frame = scaledFrame(video);
      const found = await findFaces(frame, {group: true});
      linkFrame(tracks, i, found.map(d => {
        const b = d.boundingBox, minSide = Math.min(b.width, b.height);
        return {cx: b.originX + b.width / 2, cy: b.originY + b.height / 2, size: Math.max(b.width, b.height), sig: signature(frame, d),
          sample: {frame: i, cx: b.originX + b.width / 2, cy: b.originY + b.height / 2, area: b.width * b.height, usable: minSide >= 32, ...miniFrame(frame, d)}};
      }));
    }
    // Tiny faces seen in only one or two frames are flicker or too far away to recognise; drop them.
    tracks = stitchTracks(tracks).filter(t => t.samples.some(s => s.usable) || t.samples.length >= 3);
    if (import.meta.env.DEV) (globalThis as {__videoTracks?: unknown}).__videoTracks = tracks.map(t => t.samples.map(s => ({frame: s.frame, cx: s.cx, cy: s.cy, usable: s.usable, area: s.area})));
    if (!tracks.length) return [];
    // Describe each person from their largest views and average the identity features.
    const faces: DetectedFace[] = [];
    for (const [n, track] of tracks.entries()) {
      onProgress?.(0.75 + 0.25 * n / tracks.length, 'Recognising students');
      const best = [...track.samples].sort((a, b) => Number(b.usable) - Number(a.usable) || b.area - a.area).slice(0, FRAMES_PER_TRACK);
      const described: DetectedFace[] = [];
      for (const s of best) described.push({...await describeDetection(s.crop, s.detection, {classroom: true}), sourceWidth: s.sourceWidth, sourceHeight: s.sourceHeight});
      const withFeatures = described.filter(f => f.usable && f.face.embedding);
      const lead = withFeatures[0] ?? described[0];
      faces.push({...lead, usable: withFeatures.length > 0, face: {...lead.face, embedding: withFeatures.length ? meanEmbedding(withFeatures.map(f => f.face.embedding!)) : undefined},
        frameEmbeddings: withFeatures.map(f => f.face.embedding!), frames: [track.samples[0].frame, track.samples[track.samples.length - 1].frame]});
    }
    return faces;
  } finally {
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
  }
}

/** Evenly spaced sample times: about one per second, at most MAX_VIDEO_FRAMES, within the first minute. */
export function sampleTimes(duration: number) {
  const usable = Math.min(duration, MAX_VIDEO_SECONDS);
  const count = Math.max(1, Math.min(MAX_VIDEO_FRAMES, Math.round(usable)));
  return Array.from({length: count}, (_, i) => Math.min(usable - 0.05, (i + 0.5) * usable / count));
}

export function meanEmbedding(vectors: number[][]) {
  const sum = vectors[0].map((_, i) => vectors.reduce((n, v) => n + v[i], 0) / vectors.length);
  const target = vectors.reduce((n, v) => n + Math.hypot(...v), 0) / vectors.length, length = Math.hypot(...sum);
  return sum.map(v => v * target / Math.max(length, 1e-9));
}

async function readDuration(video: HTMLVideoElement) {
  // Recordings made with MediaRecorder often report Infinity until the end is sought once.
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('The video length could not be read. Try recording again or upload an MP4.')), 8000);
      video.ondurationchange = () => { if (Number.isFinite(video.duration)) { clearTimeout(timer); resolve(); } };
      video.onseeked = () => { if (Number.isFinite(video.duration)) { clearTimeout(timer); resolve(); } };
      video.currentTime = 1e9;
    });
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('The video is empty.');
  return video.duration;
}

function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('The video could not be read. Try a shorter video or take photos.')), 15000);
    video.onseeked = () => { clearTimeout(timer); resolve(); };
    video.onerror = () => { clearTimeout(timer); reject(Error('The video could not be decoded.')); };
    video.currentTime = t;
  });
}

function scaledFrame(video: HTMLVideoElement) {
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c;
}

/** 12×12 normalised grey thumbnail, used only to tell neighbouring faces apart while tracking. */
function signature(frame: HTMLCanvasElement, d: Detection) {
  const b = d.boundingBox, c = document.createElement('canvas');
  c.width = c.height = 12;
  const x = c.getContext('2d', {willReadFrequently: true})!;
  x.drawImage(frame, b.originX, b.originY, b.width, b.height, 0, 0, 12, 12);
  const px = x.getImageData(0, 0, 12, 12).data, g = Array.from({length: 144}, (_, i) => px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114);
  const mean = g.reduce((a, v) => a + v, 0) / 144, sd = Math.sqrt(g.reduce((a, v) => a + (v - mean) ** 2, 0) / 144) || 1;
  return g.map(v => (v - mean) / sd);
}

/** Keep just the area around a face so whole frames are not held in memory. */
function miniFrame(frame: HTMLCanvasElement, d: Detection) {
  const b = d.boundingBox, side = Math.round(Math.max(b.width, b.height) * 2), cx = b.originX + b.width / 2, cy = b.originY + b.height / 2;
  const x0 = Math.round(cx - side / 2), y0 = Math.round(cy - side / 2);
  const crop = document.createElement('canvas');
  crop.width = crop.height = side;
  crop.getContext('2d')!.drawImage(frame, x0, y0, side, side, 0, 0, side, side);
  const detection: Detection = {...d, boundingBox: {...b, originX: b.originX - x0, originY: b.originY - y0},
    keypoints: (d.keypoints ?? []).map(p => ({...p, x: (p.x * frame.width - x0) / side, y: (p.y * frame.height - y0) / side}))};
  return {crop, detection, sourceWidth: frame.width, sourceHeight: frame.height};
}
