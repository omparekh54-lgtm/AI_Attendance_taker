import React, {useEffect, useState} from 'react';
import {LoaderCircle, ScanFace} from 'lucide-react';
import {api} from './api';
import {config} from './config';

/** Teacher access key form. "Keep signed in" lets a classroom smartboard stay ready for 30 days. */
export function SignInForm({onSignedIn, remember: rememberDefault = false, submitLabel = 'Open teacher workspace'}: {onSignedIn: () => void; remember?: boolean; submitLabel?: string}) {
  const [password, setPassword] = useState(''), [remember, setRemember] = useState(rememberDefault), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <form onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('auth', 'POST', {password, remember}); setPassword(''); onSignedIn(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }}>
    <label>Teacher access key<input type="password" autoComplete="current-password" autoFocus value={password} onChange={e => setPassword(e.target.value)} required/></label>
    <label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)}/>Keep this device signed in for 30 days</label>
    {error && <p className="alert error" role="alert">{error}</p>}
    <button className="primary full" disabled={busy}>{busy ? 'Signing in…' : submitLabel}</button>
  </form>;
}

/** The attendance board shows names, SAP IDs and face templates, so it needs the teacher key once per device. */
export function TeacherGate({children}: {children: React.ReactNode}) {
  const [state, setState] = useState<'checking' | 'in' | 'out'>(config.sharedStorage ? 'checking' : 'in');
  useEffect(() => {
    if (!config.sharedStorage) return;
    api<{teacher: boolean}>('auth').then(r => setState(r.teacher ? 'in' : 'out')).catch(() => setState('out'));
  }, []);
  if (state === 'checking') return <div className="loading"><LoaderCircle className="spin"/>Opening EigenRoll…</div>;
  if (state === 'in') return <>{children}</>;
  return <div className="entry">
    <header>
      <a className="brand" href="/"><span className="brand-icon"><ScanFace/></span>eigenroll<span className="brand-dot">.</span></a>
      <a className="button" href="/?page=register">Student registration</a>
    </header>
    <div className="entry-card panel">
      <div className="eyebrow">SMARTBOARD ATTENDANCE</div>
      <h1>Sign in to take attendance.</h1>
      <p>Enter the teacher access key once on this smartboard. Student names and face data stay private to signed-in teachers.</p>
      <SignInForm remember submitLabel="Start taking attendance" onSignedIn={() => setState('in')}/>
    </div>
    <footer>EigenRoll · Face features + PCA / LDA attendance</footer>
  </div>;
}

export async function signOut() {
  await api('auth', 'DELETE');
  location.href = '/';
}
