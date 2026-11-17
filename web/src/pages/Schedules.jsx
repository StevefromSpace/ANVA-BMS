import { useState } from 'react';
import { Panel } from '../components/ui.jsx';
import { setState, useStore } from '../core/store.js';
import { sendBridge } from '../core/bridge.js';
import { LIGHT_GROUPS } from '../core/config.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Live mode: schedules are owned by the bridge (docs/SCHEDULER.md). Only admins can edit; everyone else is read-only.
function ServerSchedules() {
  const { serverSchedules = [], scheduleResults = [], schedulerState = 'disabled', scheduleError, bridgeRole } = useStore();
  const admin = bridgeRole === 'admin';
  const [f, setF] = useState({ name: '', time: '08:00', days: [1, 2, 3, 4, 5], relays: '', on: true });
  const add = (e) => { e.preventDefault();
    const relays = f.relays.split(',').map((x) => Number(x.trim())).filter((x) => x);
    sendBridge({ type: 'schedule_create', schedule: { name: f.name, time: f.time, days: f.days, relays, on: f.on } }); };
  return (
    <div className="grid g2">
      <Panel title="Server schedules">
        <div className="banner">Scheduler: <b>{schedulerState}</b>{schedulerState === 'dry-run' && ' (decisions are logged, nothing is switched)'}{schedulerState === 'disabled' && ' (nothing will run)'}. Lighting relays 1-31 only. {admin ? '' : 'Read-only: admin role required to edit.'}</div>
        {scheduleError && <p role="alert" style={{ color: 'var(--bad)' }}>{scheduleError}</p>}
        <table><tbody>{serverSchedules.map((x) => (
          <tr key={x.id}><td><input type="checkbox" aria-label={`Enable ${x.name}`} disabled={!admin} checked={x.enabled} onChange={() => sendBridge({ type: 'schedule_update', id: x.id, schedule: { enabled: !x.enabled } })} /></td>
            <td>{x.name}</td><td>{x.time} {x.days.map((d) => DAYS[d]).join(' ')}</td><td>R{x.relays.join(',')} → {x.on ? 'ON' : 'OFF'}</td>
            <td>{admin && <button className="btn sm danger" onClick={() => sendBridge({ type: 'schedule_delete', id: x.id })}>Delete</button>}</td></tr>))}</tbody></table>
        {admin && <form className="row" onSubmit={add} style={{ marginTop: 12 }}>
          <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Schedule name" />
          <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} aria-label="Time" />
          <input placeholder="Relays e.g. 1,2,3" value={f.relays} onChange={(e) => setF({ ...f, relays: e.target.value })} aria-label="Relays" />
          {DAYS.map((d, i) => <label key={d}><input type="checkbox" checked={f.days.includes(i)} onChange={(e) => setF({ ...f, days: e.target.checked ? [...f.days, i] : f.days.filter((y) => y !== i) })} />{d}</label>)}
          <select value={f.on ? 'on' : 'off'} onChange={(e) => setF({ ...f, on: e.target.value === 'on' })} aria-label="Action"><option value="on">ON</option><option value="off">OFF</option></select>
          <button className="btn">Add</button></form>}
      </Panel>
      <Panel title="Recent results">
        <table><tbody>{[...scheduleResults].reverse().slice(0, 20).map((r) => (
          <tr key={r.id}><td>{new Date(r.at).toLocaleString()}</td><td>{r.name}</td><td>{r.skipped ? 'SKIPPED' : r.dryRun ? 'DRY-RUN' : r.ok ? 'OK' : 'FAILED'}</td><td className="muted">{r.error || ''}</td></tr>))}</tbody></table>
      </Panel>
    </div>
  );
}

export default function Schedules() {
  const mode = useStore((s) => s.mode);
  return mode === 'live' ? <ServerSchedules /> : <LocalSchedules />;
}

function LocalSchedules() {
  const { schedules, scenes } = useStore();
  const [f, setF] = useState({ name: '', time: '08:00', target: 'all', on: true });
  const [scene, setScene] = useState({ name: '', relays: [] });
  const add = (e) => { e.preventDefault(); if (!f.name.trim()) return;
    setState((s) => ({ schedules: [...s.schedules, { id: 'sc' + Date.now(), name: f.name, time: f.time, days: 'Daily', action: f.target === 'all' ? 'all' : 'scene', target: f.target, on: f.on, enabled: true }] })); setF({ ...f, name: '' }); };
  const addScene = () => { if (!scene.name.trim() || !scene.relays.length) return;
    setState((s) => ({ scenes: [...s.scenes, { id: 's' + Date.now(), name: scene.name, relays: scene.relays }] })); setScene({ name: '', relays: [] }); };
  return (
    <div className="grid g2">
      <Panel title="Schedules">
        <div className="banner">SIMULATION ONLY: these schedules run in this browser while the app is open and never touch hardware. Live mode uses the bridge scheduler (docs/SCHEDULER.md).</div>
        <table><tbody>{schedules.map((x) => (
          <tr key={x.id}><td><input type="checkbox" aria-label={`Enable ${x.name}`} checked={x.enabled} onChange={() => setState((s) => ({ schedules: s.schedules.map((y) => (y.id === x.id ? { ...y, enabled: !y.enabled } : y)) }))} /></td>
            <td>{x.name}</td><td>{x.time} {x.days}</td><td>{x.action === 'all' ? 'All lights' : scenes.find((c) => c.id === x.target)?.name} → {x.on ? 'ON' : 'OFF'}</td>
            <td><button className="btn sm danger" onClick={() => setState((s) => ({ schedules: s.schedules.filter((y) => y.id !== x.id) }))}>Delete</button></td></tr>))}</tbody></table>
        <form className="row" onSubmit={add} style={{ marginTop: 12 }}>
          <input placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Schedule name" />
          <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} aria-label="Time" />
          <select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} aria-label="Target"><option value="all">All lights</option>{scenes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.on ? 'on' : 'off'} onChange={(e) => setF({ ...f, on: e.target.value === 'on' })} aria-label="Action"><option value="on">ON</option><option value="off">OFF</option></select>
          <button className="btn">Add</button></form>
      </Panel>
      <Panel title="Custom scenes">
        <table><tbody>{scenes.map((c) => <tr key={c.id}><td>{c.name}</td><td className="muted">{c.relays.length} groups</td>
          <td><button className="btn sm danger" onClick={() => setState((s) => ({ scenes: s.scenes.filter((y) => y.id !== c.id) }))}>Delete</button></td></tr>)}</tbody></table>
        <h3 style={{ color: 'var(--cyan)', fontSize: 13 }}>NEW SCENE</h3>
        <input placeholder="Scene name" value={scene.name} onChange={(e) => setScene({ ...scene, name: e.target.value })} aria-label="Scene name" />
        <div style={{ maxHeight: 220, overflow: 'auto', margin: '8px 0' }}>{LIGHT_GROUPS.map((g) => (
          <label key={g.relay} style={{ display: 'block' }}><input type="checkbox" checked={scene.relays.includes(g.relay)}
            onChange={(e) => setScene({ ...scene, relays: e.target.checked ? [...scene.relays, g.relay] : scene.relays.filter((r) => r !== g.relay) })} /> {g.floor} · {g.room} (R{g.relay})</label>))}</div>
        <button className="btn" onClick={addScene}>Save scene</button>
      </Panel>
    </div>
  );
}
