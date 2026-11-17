import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useStore } from './core/store.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Lighting from './pages/Lighting.jsx';
import Hvac from './pages/Hvac.jsx';
import Meter from './pages/Meter.jsx';
import Energy from './pages/Energy.jsx';
import Modules from './pages/Modules.jsx';
import Alarms from './pages/Alarms.jsx';
import Assistant from './pages/Assistant.jsx';
import Schedules from './pages/Schedules.jsx';
import Controllers from './pages/Controllers.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  ['Monitor', [['/', 'Dashboard', '▦'], ['/lighting', 'Lighting (32 ch)', '💡'], ['/hvac', 'HVAC / AC', '❄'], ['/meter', 'Electrical Meter', '⚡'], ['/energy', 'Energy Analytics', '📈']]],
  ['Modules', [['/water', 'Water', '💧'], ['/fire', 'Fire & Emergency', '🔥'], ['/security', 'Security', '🛡'], ['/lift', 'Lift', '⇕']]],
  ['Operations', [['/alarms', 'Alarm Centre', '🔔'], ['/schedules', 'Schedules & Scenes', '⏱'], ['/ai', 'ANVA AI', '✦'], ['/controllers', 'Controllers', '▣'], ['/reports', 'Reports & History', '☰'], ['/settings', 'Settings & Users', '⚙']]],
];

export default function App() {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem('anva.user') || 'null'));
  const [open, setOpen] = useState(false);
  const mode = useStore((s) => s.mode);
  const bridge = useStore((s) => s.bridge);
  const alarms = useStore((s) => s.alarms.filter((a) => !a.ack).length);
  const loc = useLocation();
  if (!user) return <Login onLogin={(u) => { sessionStorage.setItem('anva.user', JSON.stringify(u)); setUser(u); }} />;
  const title = NAV.flatMap(([, items]) => items).find(([p]) => p === loc.pathname)?.[1] ?? 'ANVA BMS';
  return (
    <div className="app">
      <header className="top">
        <button className="menu-btn" aria-label="Menu" onClick={() => setOpen(!open)}>☰</button>
        <div className="logo">AN<b>VA</b> BMS</div>
        <h1>{title}</h1>
        <div className="spacer" />
        <span className={`chip ${mode === 'sim' ? 'sim' : bridge === 'connected' ? 'ok' : 'bad'}`}>
          {mode === 'sim' ? 'SIMULATION MODE' : `LIVE · bridge ${bridge}`}
        </span>
        <NavLink to="/alarms" className="chip" style={{ color: alarms ? 'var(--bad)' : undefined }}>🔔 {alarms}</NavLink>
        <span className="muted">{user.name} [{user.role}]</span>
        <button className="btn sm sec" onClick={() => { sessionStorage.removeItem('anva.user'); setUser(null); }}>Sign out</button>
      </header>
      <nav className={`side ${open ? 'open' : ''}`} onClick={() => setOpen(false)} aria-label="Main">
        {NAV.map(([g, items]) => (
          <div key={g}><div className="grp">{g}</div>
            {items.map(([to, label, ic]) => <NavLink key={to} to={to} end={to === '/'}><span aria-hidden>{ic}</span>{label}</NavLink>)}
          </div>
        ))}
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/lighting" element={<Lighting user={user} />} />
          <Route path="/hvac" element={<Hvac user={user} />} />
          <Route path="/meter" element={<Meter />} />
          <Route path="/energy" element={<Energy />} />
          {['water', 'fire', 'security', 'lift'].map((m) => <Route key={m} path={`/${m}`} element={<Modules kind={m} />} />)}
          <Route path="/alarms" element={<Alarms />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/ai" element={<Assistant user={user} />} />
          <Route path="/controllers" element={<Controllers />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings user={user} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
