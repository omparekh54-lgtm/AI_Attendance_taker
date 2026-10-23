import {useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, Camera, Check, LoaderCircle, ScanFace} from 'lucide-react';
import {detect} from './vision';
import {api} from './api';
import {config} from './config';
import {poseCounts} from './pose';
import {turnedClassroomFeatures} from './classroom-features';
import type {Face} from './store';

const STRAIGHT = 3, PER_SIDE = 3, MAX = 20;

/** For students who registered before side views were checked: adds a few side views to their existing record.
 *  The server only accepts them if the new straight-on samples match the face already registered for that SAP ID. */
export function SideViews({onBack}: {onBack: () => void}) {
  const invite = new URLSearchParams(location.search).get('invite') ?? config.defaultInvite ?? '';
  const [roll, setRoll] = useState(''), [faces, setFaces] = useState<Face[]>([]), [camera, setCamera] = useState(false),
    [running, setRunning] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState(''), [done, setDone] = useState('');
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), facesRef = useRef<Face[]>([]), sampling = useRef(false);
  const pose = poseCounts(faces);
  const complete = pose.straight >= STRAIGHT && pose.left >= PER_SIDE && pose.right >= PER_SIDE;
  const step = pose.straight < STRAIGHT ? 0 : Math.max(pose.left, pose.right) < PER_SIDE ? 1 : !complete ? 2 : 3;
  const prompt = ['Look straight at the camera', 'Slowly turn your head to one side', 'Now slowly turn to the other side', 'All done — submit below'][step];

  useEffect(() => () => stream.current?.getTracks().forEach(t => t.stop()), []);
  useEffect(() => { if (camera && video.current) { video.current.srcObject = stream.current; video.current.play().catch(() => setError('Tap the preview to start your camera.')); } }, [camera]);
  useEffect(() => { if (complete) setRunning(false); }, [complete]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void capture(), 900);
    return () => clearInterval(timer);
  }, [running]);

  async function open() {
    setError(''); setBusy('Opening camera');
    try { stream.current = await navigator.mediaDevices.getUserMedia({video: {facingMode: 'user', width: {ideal: 1280}}, audio: false}); setCamera(true); setRunning(true); }
    catch { setError('Allow camera access to add side views.'); }
    finally { setBusy(''); }
  }
  function close() { setRunning(false); stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setCamera(false); }

  async function capture() {
    if (sampling.current || !video.current || facesRef.current.length >= MAX) return;
    sampling.current = true;
    try {
      const found = await detect(video.current);
      if (found.length !== 1 || !found[0].usable || !found[0].face.embedding) return;
      const f = found[0].face, c = poseCounts(facesRef.current), yaw = f.yaw ?? 0;
      // Only keep what is still needed, so a few seconds of turning is enough.
      const wanted = Math.abs(yaw) < 0.3 ? c.straight < STRAIGHT : yaw > 0 ? c.left < PER_SIDE : c.right < PER_SIDE;
      if (!wanted || facesRef.current.some(o => o.vector.reduce((n, v, i) => n + (v - f.vector[i]) ** 2, 0) / 576 < .0015)) return;
      facesRef.current = [...facesRef.current, f];
      setFaces(facesRef.current);
    } catch { /* try the next frame */ } finally { sampling.current = false; }
  }

  async function submit() {
    setError('');
    try {
      setBusy('Preparing your side views for class photos');
      const classroom = await turnedClassroomFeatures(faces, (n, t) => setBusy(`Preparing your side views ${n + 1} / ${t}`));
      setBusy('Saving');
      const r = await api('side-views?invite=' + encodeURIComponent(invite), 'POST', {roll: roll.trim(), faces, classroom});
      close(); setDone(r.name ? `${r.name.split(' ')[0]}, your side views are saved.` : 'Your side views are saved.');
    } catch (e) {
      setError((e as Error).message);
      facesRef.current = []; setFaces([]);
    } finally { setBusy(''); }
  }

  if (done) return <div className="entry-card panel complete"><span className="brand-icon"><Check/></span><h1>{done}</h1><p>You can now be recognised in class photos even when your head is turned to the side.</p><a className="button" href="/">Back to home</a></div>;
  return <div className="entry-card panel side-views">
    <div className="eyebrow">ALREADY REGISTERED</div>
    <h1>Add side views</h1>
    <p>Takes about 15 seconds. Then you are recognised even when you are looking to the side in a class photo.</p>
    {error && <div role="alert" className="alert error">{error}</div>}
    {busy && <div className="alert"><LoaderCircle className="spin" size={16}/>{busy}…</div>}
    <label>SAP ID<input maxLength={40} value={roll} onChange={e => setRoll(e.target.value)} placeholder="Your SAP ID" disabled={camera}/></label>
    {camera ? <>
      <div className="pose-guide"><strong>{prompt}</strong>
        <span className={`side-check ${complete ? 'done' : ''}`}>Straight {Math.min(pose.straight, STRAIGHT)}/{STRAIGHT} · one side {Math.min(pose.left, PER_SIDE)}/{PER_SIDE} · other side {Math.min(pose.right, PER_SIDE)}/{PER_SIDE}</span>
        <progress value={Math.min(pose.straight, STRAIGHT) + Math.min(pose.left, PER_SIDE) + Math.min(pose.right, PER_SIDE)} max={STRAIGHT + 2 * PER_SIDE}/></div>
      <div className="camera-box"><video ref={video} muted autoPlay playsInline/>
        <div className="side-prompt" aria-live="polite">{step === 1 ? <ArrowLeft size={18}/> : step === 2 ? <ArrowRight size={18}/> : step === 0 ? <ScanFace size={18}/> : <Check size={18}/>}{prompt}</div></div>
      <div className="actions">
        <button className="primary" disabled={!complete || !!busy} onClick={submit}><Check size={17}/>Save side views</button>
        <button disabled={!!busy} onClick={() => { facesRef.current = []; setFaces([]); setRunning(true); }}>Start again</button>
      </div>
    </> : <button className="primary full" disabled={!roll.trim() || !!busy || !invite} onClick={open}><Camera size={18}/>Open camera</button>}
    <button className="text-button" disabled={!!busy} onClick={() => { close(); onBack(); }}>Back to registration</button>
  </div>;
}
