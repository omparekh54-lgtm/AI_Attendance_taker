import {IDENTITY_EXTRACTOR} from './identity';
import {describeFaceDataUrl} from './embeddings';
import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Camera, Check, ChevronLeft, ClipboardCopy, Download, LoaderCircle, LogOut, RefreshCw, RotateCcw, ScanFace, Settings, Smartphone, Users} from 'lucide-react';
import {TeacherGate, signOut} from './signin';
import {CameraCapture} from './camera';
import {config} from './config';
import {load, loadAttendance, save, initial, csv, download, type State, type Student} from './store';
import {recognizeCapture, rosterSignature, type DetectedFace, type Observation} from './attendance';
import {loadSavedAttendance, saveAttendance, clearSavedAttendance, type SavedAttendance} from './saved-attendance';
import type {Model} from './model';
import './style.css';
import './board.css';

const Entry = lazy(() => import('./enrollment').then(m => ({default: m.Entry})));
const Registrations = lazy(() => import('./registrations').then(m => ({default: m.Registrations})));
const PhoneCapture = lazy(() => import('./phone').then(m => ({default: m.PhoneCapture})));
const PhonePair = lazy(() => import('./phone').then(m => ({default: m.PhonePair})));

const management = new URLSearchParams(location.search).get('page') === 'manage';
const readState = () => (management ? load() : loadAttendance());
const BATCH_ID = 'classroom', BATCH_NAME = 'BTI DS 2022 - 28';
const validSapId = (roll: string) => /^\d{11}$/.test(roll);

function trainModel(students: Student[]): Promise<Model> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./train.worker.ts', import.meta.url), {type: 'module'});
    worker.onmessage = e => {
      worker.terminate();
      if (e.data.error) reject(Error(e.data.error));
      else resolve({...e.data.model, rosterSignature: rosterSignature(students)});
    };
    worker.onerror = e => { worker.terminate(); reject(Error(e.message)); };
    worker.postMessage(students.flatMap(s => s.faces.map(f => ({label: s.id, vector: f.vector}))));
  });
}

function App() {
  const [state, setState] = useState<State>(initial),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [phone, setPhone] = useState(false),
    [search, setSearch] = useState(''),
    // Attendance for the current class, kept on this device so a refresh does not lose it.
    [captures, setCaptures] = useState(0),
    [observations, setObservations] = useState<Observation[]>([]),
    [manual, setManual] = useState<Record<string, boolean>>({}),
    [startedAt, setStartedAt] = useState('');
  const results = useRef<HTMLElement>(null), lock = useRef(false), currentModel = useRef<Model | undefined>(undefined), restored = useRef(false);

  const students = useMemo(() => state.students.filter(s => s.classId === BATCH_ID).sort((a, b) => a.name.localeCompare(b.name)), [state.students]);
  const byId = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const model = state.models[BATCH_ID],
    validModel = model?.rosterSignature === rosterSignature(students) && model.identity?.extractor === IDENTITY_EXTRACTOR ? model : undefined;
  currentModel.current = validModel;

  useEffect(() => {
    readState().then(s => { setState(s); setLoaded(true); }).catch(e => setError(e.message));
  }, []);

  // Restore today's attendance once the roster is known; drop anything for students no longer registered.
  useEffect(() => {
    if (!loaded || management || restored.current) return;
    restored.current = true;
    const saved = loadSavedAttendance();
    if (!saved) return;
    const known = new Set(students.map(s => s.id));
    setCaptures(saved.captures);
    setStartedAt(saved.startedAt);
    setObservations(saved.observations.filter(o => !o.studentId || known.has(o.studentId)));
    setManual(Object.fromEntries(Object.entries(saved.manual).filter(([id]) => known.has(id))));
    if (saved.captures) setNotice(`Restored today's attendance from ${new Date(saved.startedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}. Use “Start new attendance” for a new class.`);
  }, [loaded, students]);

  useEffect(() => {
    if (!restored.current || management) return;
    const record: SavedAttendance = {startedAt, captures, observations, manual};
    if (captures || Object.keys(manual).length) saveAttendance(record);
  }, [captures, observations, manual, startedAt]);

  useEffect(() => {
    if (captures > 0) results.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, [captures]);

  async function commit(next: State) {
    if (management) await save(next);
    setState(next);
  }
  async function task(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError('');
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); lock.current = false; }
  }
  async function refresh() {
    setPhone(false);
    await task('Refreshing class', async () => { setState(await readState()); });
  }
  async function train() {
    await task('Preparing recognition for your batch', async () => {
      if (students.some(s => s.faces.length < 5)) throw Error('Every registered student needs at least 5 face samples.');
      const enriched = structuredClone(students);
      let prepared = 0;
      const total = enriched.reduce((n, s) => n + s.faces.length, 0);
      for (const s of enriched) for (const f of s.faces) {
        if (f.embedding) continue;
        if (!f.image) throw Error('Recognition needs rebuilding from Manage batch. Existing attendance results are unchanged.');
        setBusy(`Preparing face features ${++prepared} / ${total}`);
        f.embedding = await describeFaceDataUrl(f.image);
      }
      const trained = await trainModel(enriched);
      const updated = new Map(enriched.map(s => [s.id, s]));
      await commit({...state, students: state.students.map(s => updated.get(s.id) ?? s), models: {...state.models, [BATCH_ID]: trained}});
      setNotice('Recognition is ready. Open the camera to begin.');
    });
  }
  // Prepare once for an untrained roster; the worker keeps the smartboard responsive.
  const attempted = useRef('');
  useEffect(() => {
    const signature = rosterSignature(students);
    if (!loaded || students.length < 2 || validModel || attempted.current === signature) return;
    attempted.current = signature;
    void train();
  }, [loaded, students, validModel]);

  function receive(faces: DetectedFace[]) {
    const active = currentModel.current;
    if (!active) throw Error('Recognition is not ready. Prepare the model first.');
    const batch = recognizeCapture(active, faces);
    setObservations(prev => [...prev, ...batch].slice(-1000));
    setCaptures(n => n + 1);
    if (!startedAt) setStartedAt(new Date().toISOString());
    const matched = new Set(batch.flatMap(o => (o.studentId ? [o.studentId] : []))).size,
      confirm = batch.filter(o => !o.studentId && o.suggestion).length,
      review = batch.filter(o => !o.studentId && !o.suggestion).length;
    setNotice([
      `${faces.length} face${faces.length === 1 ? '' : 's'} found`,
      `${matched} recognised`,
      confirm ? `${confirm} to confirm with one tap` : '',
      review ? `${review} not recognised` : '',
    ].filter(Boolean).join(' · ') + '.');
  }
  function startNew() {
    if ((captures || Object.keys(manual).length) && !confirm('Start new attendance? The current results on this screen will be cleared.')) return;
    setPhone(false); setObservations([]); setManual({}); setCaptures(0); setStartedAt(''); setNotice(''); setError('');
    clearSavedAttendance();
  }
  /** Teacher says which student a face belongs to. */
  function assign(observationId: string, studentId: string) {
    setObservations(prev => prev.map(o => (o.id === observationId ? {...o, studentId, confirmed: true} : o)));
    setManual(m => { const {[studentId]: _, ...rest} = m; return rest; });
  }

  const recognized = new Set(observations.flatMap(o => (o.studentId ? [o.studentId] : [])));
  const isPresent = (s: Student) => manual[s.id] ?? recognized.has(s.id);
  const present = students.filter(isPresent), absent = students.filter(s => !isPresent(s));
  // A face that most likely belongs to someone already present (e.g. caught again in a second photo) needs no review.
  const alreadyCounted = (o: Observation) => !!o.suggestion && !!byId.get(o.suggestion) && isPresent(byId.get(o.suggestion)!);
  const unresolved = observations.filter(o => !o.studentId && !alreadyCounted(o)).sort((a, b) => Number(!!b.suggestion) - Number(!!a.suggestion));
  const hiddenRepeats = observations.filter(o => !o.studentId && alreadyCounted(o)).length;
  const howMarked = (s: Student) => (manual[s.id] === true ? 'Marked by teacher' : observations.some(o => o.studentId === s.id && o.confirmed) ? 'Confirmed by teacher' : 'Recognised from photo');
  const searchMatch = (s: Student) => (s.name + ' ' + s.roll).toLowerCase().includes(search.toLowerCase());

  function exportCsv() {
    const when = startedAt ? new Date(startedAt) : new Date();
    const date = when.toLocaleDateString('en-CA'), time = when.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const rows = [['Name', 'SAP ID', 'Status', 'How', 'Date', 'Time'], ...students.map(s => [s.name, s.roll, isPresent(s) ? 'Present' : 'Absent', isPresent(s) ? howMarked(s) : '', date, time])];
    download(`attendance-${BATCH_NAME.replace(/\W+/g, '-')}-${date}.csv`, '﻿' + csv(rows), 'text/csv;charset=utf-8');
  }
  async function copyAbsent() {
    const text = `${BATCH_NAME} · ${new Date(startedAt || Date.now()).toLocaleDateString()}\nPresent ${present.length} / ${students.length}\nAbsent (${absent.length}):\n` + absent.map(s => `${s.name} (${s.roll})`).join('\n');
    try { await navigator.clipboard.writeText(text); setNotice(`Absent list copied (${absent.length} student${absent.length === 1 ? '' : 's'}). Paste it anywhere.`); }
    catch { setError('Could not copy. Use Download CSV instead.'); }
  }

  return (
    <div className="board-app">
      <header className="board-header">
        <a className="brand" href="/"><span className="brand-icon"><ScanFace/></span>eigenroll<span className="brand-dot">.</span></a>
        <div className="board-header-actions">
          <button onClick={() => { location.href = management ? '/' : '/?page=manage'; }} disabled={!!busy}>
            {management ? <ChevronLeft size={18}/> : <Settings size={18}/>}<span className="label">{management ? 'Take attendance' : 'Manage batch'}</span>
          </button>
          <button onClick={refresh} disabled={!!busy} aria-label="Refresh batch" title="Reload students"><RefreshCw size={18}/></button>
          {config.sharedStorage && !management && <button onClick={signOut} aria-label="Sign out" title="Sign out of this device"><LogOut size={18}/></button>}
        </div>
      </header>
      <main className="board-main">
        <div className="board-title">
          <div>
            <span className="eyebrow">{management ? 'YOUR BATCH' : 'SMARTBOARD ATTENDANCE'}</span>
            <h1>{BATCH_NAME}</h1>
            <p>{management ? 'Registered students and incoming submissions.' : `Take a photo of the class and see who is here · ${loaded ? students.length : '…'} registered students`}</p>
          </div>
          <span className={`status ${validModel ? 'green' : 'amber'}`}>{!loaded ? 'Loading batch…' : validModel ? 'Recognition ready' : 'Preparing recognition'}</span>
        </div>
        {!loaded && !error && <div className="alert" role="status"><LoaderCircle size={18} className="spin"/>Loading registered students and recognition…</div>}
        {error && <div className="alert error" role="alert">{error}{!loaded && <button onClick={() => location.reload()}>Retry</button>}</div>}
        {busy && <div className="alert" role="status"><LoaderCircle size={18} className="spin"/>{busy}…</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}

        {management && loaded ? (
          <>
            <div inert={!!busy}><Registrations state={state} commit={commit} classId={BATCH_ID} onNotice={setNotice} onError={setError}/></div>
            <section className="panel">
              <div className="section-heading">
                <h2><Users size={22}/>All registered students <span className="badge">{students.length}</span></h2>
                <button disabled={!!busy || students.length < 2} onClick={train}><RefreshCw size={17}/>Rebuild recognition</button>
              </div>
              <p className="muted">All entries belong to {BATCH_NAME}. Correct any entered SAP ID with the student; original submission details are preserved.</p>
              <input className="full" aria-label="Search registered students" placeholder="Search name or SAP ID" value={search} onChange={e => setSearch(e.target.value)}/>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>SAP ID as submitted</th><th>Samples</th><th/></tr></thead>
                  <tbody>
                    {students.filter(searchMatch).map(s => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.roll}{!validSapId(s.roll) && <small className="id-warning">Verify SAP ID</small>}</td>
                        <td>{s.faces.length}</td>
                        <td>
                          <button disabled={!!busy} onClick={() => {
                            const roll = prompt(`Correct SAP ID for ${s.name}`, s.roll)?.trim();
                            if (!roll || roll === s.roll) return;
                            if (!validSapId(roll)) { setError('Enter the 11-digit SAP ID.'); return; }
                            if (students.some(x => x.id !== s.id && x.roll === roll)) { setError('That SAP ID is already registered.'); return; }
                            void task('Updating SAP ID', async () => commit({...state, students: state.students.map(x => (x.id === s.id ? {...x, roll} : x))}));
                          }}>Edit SAP ID</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="panel board-capture">
              <div className="section-heading"><h2><Camera size={22}/>Classroom camera</h2></div>
              <CameraCapture disabled={!!busy || !validModel} onCapture={receive}/>
              <div className="phone-choice">
                <div><strong>Prefer to capture with your phone?</strong><p className="muted">Scan a QR code and photos appear on this board.</p></div>
                <button disabled={!!busy || !validModel} onClick={() => setPhone(true)}><Smartphone size={19}/>Use phone camera</button>
              </div>
              {!validModel && !busy && loaded && <button className="primary" disabled={students.length < 2} onClick={train}>Prepare recognition</button>}
            </section>
            {phone && <Suspense fallback={<div className="alert">Opening phone connection…</div>}><PhonePair onCapture={receive} onClose={() => setPhone(false)}/></Suspense>}

            <section ref={results} className="attendance-results" aria-live="polite">
              <div className="section-heading">
                <div>
                  <h2>Class attendance</h2>
                  <p className="muted">{captures ? `${captures} photo${captures === 1 ? '' : 's'} combined · saved on this device until you start new attendance` : 'Take a photo to start. Several photos can be combined.'}</p>
                </div>
                <div className="result-actions">
                  <button disabled={!captures} onClick={exportCsv}><Download size={17}/>Download CSV</button>
                  <button disabled={!captures} onClick={copyAbsent}><ClipboardCopy size={17}/>Copy absent list</button>
                  <button disabled={!captures && !Object.keys(manual).length} onClick={startNew}><RotateCcw size={17}/>Start new attendance</button>
                </div>
              </div>
              <div className="board-counts">
                <div className="count-present"><strong>{present.length}<small> / {students.length}</small></strong><span>Present</span></div>
                <div className="count-absent"><strong>{absent.length}</strong><span>{captures ? 'Absent' : 'Not checked yet'}</span></div>
                <div className={unresolved.length ? 'count-review' : ''}><strong>{unresolved.length}</strong><span>Faces to check</span></div>
              </div>

              {unresolved.length > 0 && (
                <section className="panel review-panel">
                  <h3>Check these faces <span className="badge">{unresolved.length}</span></h3>
                  <p className="muted">Tap <b>Yes</b> if the name is right, or pick the student. Use <b>Not a student</b> for visitors or background faces.{hiddenRepeats ? ` ${hiddenRepeats} face${hiddenRepeats === 1 ? '' : 's'} that looked like students already present ${hiddenRepeats === 1 ? 'is' : 'are'} hidden.` : ''}</p>
                  <div className="review-faces">
                    {unresolved.map(o => (
                      <ReviewFace key={o.id} observation={o} students={students} byId={byId} isPresent={isPresent}
                        onAssign={id => assign(o.id, id)} onDismiss={() => setObservations(prev => prev.filter(x => x.id !== o.id))}/>
                    ))}
                  </div>
                </section>
              )}

              <input className="full" placeholder="Find a student by name or SAP ID" aria-label="Find a student by name or SAP ID" value={search} onChange={e => setSearch(e.target.value)}/>
              <div className="result-columns">
                <section className="panel">
                  <h3><Users size={21}/>{captures ? 'Absent' : 'Not checked yet'} <span className="badge">{absent.length}</span></h3>
                  <p className="muted">{captures ? 'Not found in the photos. If someone is here but was missed, tap “Mark present” or take another photo of their row.' : 'Take a photo to check attendance.'}</p>
                  {absent.filter(searchMatch).map(s => <StudentRow key={s.id} student={s} action="Mark present" onClick={() => setManual(m => ({...m, [s.id]: true}))}/>)}
                </section>
                <section className="panel">
                  <h3><Check size={21}/>Present <span className="badge">{present.length}</span></h3>
                  {!present.length && <p className="muted">No students confirmed yet.</p>}
                  {present.filter(searchMatch).map(s => <StudentRow key={s.id} student={s} detail={howMarked(s)} action="Undo" onClick={() => setManual(m => ({...m, [s.id]: false}))}/>)}
                </section>
              </div>
            </section>
          </>
        )}
        <footer>
          <span>EigenRoll · Face features + PCA / LDA</span>
          <span>Photos are processed on this device · Teacher review recommended</span>
        </footer>
      </main>
    </div>
  );
}

function ReviewFace({observation: o, students, byId, isPresent, onAssign, onDismiss}: {
  observation: Observation; students: Student[]; byId: Map<string, Student>; isPresent: (s: Student) => boolean;
  onAssign: (studentId: string) => void; onDismiss: () => void;
}) {
  const suggested = o.suggestion ? byId.get(o.suggestion) : undefined;
  // Closest matches first, then everyone else alphabetically; students already present go last.
  const ranked = [...(o.candidates ?? []).flatMap(id => byId.get(id) ?? []), ...students.filter(s => !o.candidates?.includes(s.id))];
  const options = [...ranked.filter(s => !isPresent(s)), ...ranked.filter(isPresent)];
  return (
    <div className="review-face">
      <img src={o.image} alt="Face from the classroom photo"/>
      {suggested && !isPresent(suggested) ? (
        <>
          <p className="suggestion">Is this <strong>{suggested.name}</strong>?</p>
          <button className="primary" onClick={() => onAssign(suggested.id)}><Check size={16}/>Yes</button>
        </>
      ) : (
        <p className="muted">{suggested ? `Looks like ${suggested.name} (already present)` : o.reason ?? 'Not recognised'}</p>
      )}
      <select aria-label="Who is this?" value="" onChange={e => e.target.value && onAssign(e.target.value)}>
        <option value="">{suggested ? 'Other…' : 'Who is this?'}</option>
        {options.map(s => <option key={s.id} value={s.id}>{s.name}{isPresent(s) ? ' (present)' : ''}</option>)}
      </select>
      <button className="link" onClick={onDismiss}>Not a student</button>
    </div>
  );
}

function StudentRow({student, detail, action, onClick}: {student: Student; detail?: string; action: string; onClick: () => void}) {
  return (
    <div className="board-student">
      <div>
        <strong>{student.name}</strong>
        <small>SAP ID: {student.roll}{!validSapId(student.roll) ? ' · verify ID' : ''}</small>
        {detail && <small className="muted">{detail}</small>}
      </div>
      <button onClick={onClick} aria-label={`${action}: ${student.name}`}>{action}</button>
    </div>
  );
}

const params = new URLSearchParams(location.search);
const phoneToken = params.get('phone');
const registration = params.has('invite') || ['manage', 'register'].includes(params.get('page') ?? '');
createRoot(document.getElementById('root')!).render(
  <Suspense fallback={<div className="loading">Opening EigenRoll…</div>}>
    {phoneToken ? <PhoneCapture token={phoneToken}/> : registration ? <Entry><App/></Entry> : <TeacherGate><App/></TeacherGate>}
  </Suspense>,
);
