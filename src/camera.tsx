import {fullResolutionStill} from './still-photo';
import {zoomSteps} from './camera-zoom';
import {useEffect, useRef, useState} from 'react';
import {Camera, RefreshCw, Square, Upload, Video, X, ZoomIn} from 'lucide-react';
import type {DetectedFace} from './attendance';

type FacingMode = 'user' | 'environment';
/** Phones open the back camera first: the teacher points it at the class. Smartboards and laptops use their own camera. */
export const onPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px) and (pointer: coarse)').matches;
export const MAX_RECORDING_SECONDS = 20;

function inferFacing(label: string, fallback: FacingMode): FacingMode {
  const value = label.toLowerCase();
  if (/back|rear|environment|world/.test(value)) return 'environment';
  if (/front|user|face/.test(value)) return 'user';
  return fallback;
}
function recorderType() {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t)) ?? '';
}

export function CameraCapture({onCapture, disabled = false, phone = false}: {
  onCapture: (faces: DetectedFace[], kind: 'photo' | 'video') => Promise<void> | void;
  disabled?: boolean;
  phone?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), opening = useRef(false), mounted = useRef(true);
  const recorder = useRef<MediaRecorder | null>(null), recordTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const [active, setActive] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState(''),
    [facing, setFacing] = useState<FacingMode>(phone || onPhone() ? 'environment' : 'user'),
    [progress, setProgress] = useState<{fraction: number; stage: string} | null>(null),
    [recording, setRecording] = useState<number | null>(null),
    [zooms, setZooms] = useState<number[]>([]),
    [zoom, setZoom] = useState(1);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stopRecording(true); releaseStream(); };
  }, []);

  function releaseStream() {
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  function stop() { stopRecording(true); releaseStream(); setActive(false); setBusy(false); }

  async function attach(media: MediaStream, nextFacing: FacingMode) {
    if (!mounted.current) { media.getTracks().forEach(t => t.stop()); return; }
    stream.current = media;
    const track = media.getVideoTracks()[0], settings = track.getSettings();
    // Optical/digital zoom (Chrome on most Android phones): offered for a closer photo of the back rows.
    const range = (track.getCapabilities?.() as MediaTrackCapabilities & {zoom?: {min: number; max: number}} | undefined)?.zoom;
    setZooms(zoomSteps(range)); setZoom((settings as MediaTrackSettings & {zoom?: number}).zoom ?? 1);
    const available = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const currentId = settings.deviceId ?? '', currentInfo = available.find(d => d.deviceId === currentId);
    setDevices(available); setDevice(currentId);
    setFacing((settings.facingMode as FacingMode | undefined) ?? inferFacing(currentInfo?.label ?? '', nextFacing));
    setActive(true);
    requestAnimationFrame(async () => {
      if (!video.current || stream.current !== media) return;
      video.current.srcObject = media;
      try { await video.current.play(); } catch { setError('Tap the camera preview once to start it.'); }
    });
  }

  async function open(id?: string, nextFacing: FacingMode = facing) {
    if (opening.current) return;
    opening.current = true; setError(''); setBusy(true); releaseStream();
    const size = {width: {ideal: 3840}, height: {ideal: 2160}};
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera is not available in this browser.');
      const start = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({video, audio: false});
      let media: MediaStream;
      if (id) media = await start({deviceId: {exact: id}, ...size});
      else {
        try { media = await start({facingMode: {exact: nextFacing}, ...size}); }
        catch { media = await start({facingMode: {ideal: nextFacing}, ...size}); }
      }
      await attach(media, nextFacing);
    } catch (e) {
      setActive(false);
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError') setError('Camera permission is blocked. Allow camera access in your browser settings and try again.');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('That camera could not be opened. Try the other camera or upload a photo.');
      else setError((e as Error).message || 'Could not open the camera. Try again or upload a photo.');
    } finally {
      opening.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function rotateCamera() {
    if (opening.current || busy) return;
    const next: FacingMode = facing === 'environment' ? 'user' : 'environment';
    setBusy(true); setError('');
    try {
      const available = devices.length ? devices : (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
      const other = available.find(d => d.deviceId !== device && inferFacing(d.label, next) === next) ?? available.find(d => d.deviceId !== device);
      releaseStream();
      await new Promise(resolve => setTimeout(resolve, 120));
      await open(other?.deviceId || undefined, next);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function applyZoom(z: number) {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({advanced: [{zoom: z} as MediaTrackConstraintSet]}); setZoom(z); }
    catch { setError('This camera cannot zoom from the browser. Walk closer to the back rows and take a second photo instead.'); }
  }

  const onProgress = (fraction: number, stage: string) => { if (mounted.current) setProgress({fraction, stage}); };
  async function process(kind: 'photo' | 'video', fn: () => Promise<DetectedFace[]>) {
    if (disabled) return;
    setBusy(true); setError(''); setProgress({fraction: 0, stage: kind === 'video' ? 'Opening video' : 'Preparing photo'});
    try {
      const faces = await fn();
      if (!faces.length) throw Error(`No faces found in this ${kind}. Attendance has not changed. Try a clearer ${kind} or move closer to the class.`);
      await onCapture(faces, kind);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (mounted.current) { setBusy(false); setProgress(null); }
    }
  }

  function startRecording() {
    const type = recorderType();
    if (type === undefined || !stream.current) { setError('Video recording is not supported in this browser. Upload a video or take photos instead.'); return; }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream.current, {...(type ? {mimeType: type} : {}), videoBitsPerSecond: 8_000_000});
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(recordTimer.current);
      setRecording(null);
      if (!mounted.current || (rec as MediaRecorder & {discard?: boolean}).discard) return;
      const blob = new Blob(chunks, {type: rec.mimeType || type || 'video/webm'});
      void process('video', async () => (await import('./classroom-video')).scanVideo(blob, onProgress));
    };
    recorder.current = rec;
    rec.start(500);
    const started = Date.now();
    setRecording(0);
    recordTimer.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setRecording(seconds);
      if (seconds >= MAX_RECORDING_SECONDS) stopRecording();
    }, 250);
  }
  function stopRecording(discard = false) {
    const rec = recorder.current;
    if (!rec || rec.state === 'inactive') return;
    (rec as MediaRecorder & {discard?: boolean}).discard = discard;
    rec.stop();
    recorder.current = null;
  }

  const isRecording = recording !== null;
  return (
    <div className="camera-capture">
      {error && <div className="alert error" role="alert">{error}</div>}
      {progress && (
        <div className="scan-progress" role="status" aria-live="polite">
          <div><strong>{progress.stage}…</strong><span>{Math.round(progress.fraction * 100)}%</span></div>
          <progress max={1} value={progress.fraction}/>
          <small>Keep this page open. A full class photo takes a few seconds; a video takes longer.</small>
        </div>
      )}
      {active ? (
        <>
          <div className="board-preview camera-live">
            <video ref={video} muted playsInline autoPlay onClick={() => video.current?.play()}/>
            {(phone || onPhone() || devices.length > 1) && !isRecording && (
              <button type="button" className="camera-flip" aria-label="Switch front and back camera" title="Switch camera" disabled={busy || disabled} onClick={rotateCamera}><RefreshCw size={24}/></button>
            )}
            {isRecording && <span className="recording-badge" role="status">● Recording {recording}s / {MAX_RECORDING_SECONDS}s · move slowly across the class</span>}
            {zooms.length > 0 && !isRecording && (
              <div className="camera-zoom" role="group" aria-label="Zoom for back rows">
                <ZoomIn size={16} aria-hidden="true"/>
                {zooms.map(z => <button type="button" key={z} aria-pressed={Math.abs(zoom - z) < .05} disabled={busy || disabled} onClick={() => applyZoom(z)}>{z}×</button>)}
              </div>
            )}
            <span className="camera-label"><strong>{facing === 'environment' ? 'Back camera' : 'Front camera'}</strong> · Point the camera towards the students</span>
          </div>
          <div className="actions camera-actions">
            {isRecording ? (
              <button className="primary camera-shutter recording" onClick={() => stopRecording()}><Square size={20}/>Stop and check attendance</button>
            ) : (
              <>
                <button className="primary camera-shutter" disabled={busy || disabled} onClick={() => process('photo', async () => {
                  if (!video.current?.videoWidth) throw Error('Camera is still starting. Try again in a moment.');
                  const {detect} = await import('./vision');
                  // A real still photo (often 12 MP on a phone) when the browser supports it: faces come out 2–3×
                  // bigger than in a frame of the live video. Falls back to the video frame otherwise.
                  const still = await fullResolutionStill(stream.current, video.current.videoWidth, video.current.videoHeight);
                  return detect(still ?? video.current, {group: true, onProgress});
                })}><Camera size={21}/>{progress ? 'Scanning…' : 'Take attendance photo'}</button>
                <button disabled={busy || disabled} onClick={startRecording}><Video size={19}/>Record video</button>
              </>
            )}
            <button disabled={busy && !isRecording} onClick={stop}><X size={18}/>Close</button>
          </div>
          {devices.length > 1 && !isRecording && (
            <details className="camera-options">
              <summary>Camera options</summary>
              <label>Choose camera
                <select aria-label="Choose camera" value={device} disabled={busy} onChange={e => { const info = devices.find(d => d.deviceId === e.target.value); void open(e.target.value, inferFacing(info?.label ?? '', facing)); }}>
                  {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                </select>
              </label>
            </details>
          )}
        </>
      ) : (
        <div className="board-camera-empty">
          <div className="camera-symbol"><Camera size={48}/></div>
          <h2>{phone || onPhone() ? 'Take attendance with your phone' : 'Your classroom. One capture.'}</h2>
          <p>{phone || onPhone() ? 'The back camera opens first. Take a photo or record a slow video across the class.' : 'Open the camera, then take a photo or record a short video of the class.'}</p>
          <button className="primary" disabled={busy} onClick={() => open(undefined, phone || onPhone() ? 'environment' : facing)}><Camera size={22}/>{busy && !progress ? 'Opening camera…' : 'Open camera'}</button>
        </div>
      )}
      <label className={`button upload-photo ${busy || disabled ? 'disabled' : ''}`}>
        <Upload size={17}/>Upload photos or video
        <input type="file" accept="image/*,video/*" multiple disabled={busy || disabled} onChange={async e => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          for (const f of files) {
            if (f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) await process('video', async () => (await import('./classroom-video')).scanVideo(f, onProgress));
            else await process('photo', async () => (await import('./vision')).imageFile(f, {group: true, onProgress}));
          }
        }}/>
      </label>
      <p className="muted">Big class? Take one photo of the whole class, then {zooms.length ? <>zoom to <strong>{zooms[zooms.length - 1]}×</strong> and</> : <>walk closer and</>} take a second photo of the back rows. Back-row faces need to be bigger to be marked. Every photo and video is combined, and nobody is counted twice; a back-row face seen in two photos can be marked even when it is small.</p>
    </div>
  );
}

