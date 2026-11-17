import { useState } from 'react';
import { useStore } from '../core/store.js';
import { loginViaBridge } from '../core/bridge.js';

const ROLES = ['viewer', 'operator', 'admin'];

export default function Login({ onLogin }) {
  const { mode, bridgeUrl } = useStore();
  const live = mode === 'live';
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (!live) return onLogin({ name: name.trim() || 'Operator', role });
    setBusy(true);
    try { const r = await loginViaBridge(bridgeUrl, name.trim(), password); setPassword(''); onLogin({ name: r.user, role: r.role }); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <div className="logo" style={{ fontSize: 30, textAlign: 'center', marginBottom: 4 }}>AN<b>VA</b> BMS</div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>Advanced Building Management System</p>
        <label>{live ? 'Username' : 'Name'}<input value={name} autoComplete="username" onChange={(e) => setName(e.target.value)} placeholder={live ? 'Username' : 'Operator name'} /></label>
        {live
          ? <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          : <label>Role<select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: '100%', marginBottom: 12 }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></label>}
        {err && <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
        <button className="btn" style={{ width: '100%' }} disabled={busy}>{live ? 'Sign in' : 'Enter simulation'}</button>
        <p className="banner" style={{ marginTop: 14, marginBottom: 0 }}>{live
          ? 'Signed in against the bridge. Your role is assigned and enforced by the server.'
          : 'Simulation only: this local role picker is NOT authentication and is not secure. It has no effect on live hardware.'}</p>
      </form>
    </div>
  );
}
