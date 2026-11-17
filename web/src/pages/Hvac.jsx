import { useEffect, useState } from 'react';
import { Panel, Stat, StatusText, useConfirm } from '../components/ui.jsx';
import { sendCommand, setState, useStore } from '../core/store.js';
import { acInterlock } from '../core/logic.js';
import { AC_MIN_OFF_SECONDS } from '../core/config.js';
import { canOperate } from '../core/roles.js';

const flag = (v, bad, invalid) => (invalid ? ['warn', 'Input fault'] : v === null || v === undefined ? ['off', 'Not connected'] : v ? [bad ? 'fault' : 'on', bad ? 'ACTIVE' : 'Yes'] : ['ok', bad ? 'Clear' : 'No']);

export default function Hvac({ user }) {
  const s = useStore();
  const [, tick] = useState(0);
  const [msg, setMsg] = useState('');
  const [ask, dialog] = useConfirm();
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(i); }, []);
  const { ac, meter: m } = s;
  const il = acInterlock(s);
  const can = canOperate(user);
  const bad = ac.inputsValid === false; // AC feedback inputs open-circuit: every feedback value is untrustworthy
  const send = (on) => { const r = sendCommand({ type: 'ac', on }, user.name); setMsg(r.ok ? `AC ${on ? 'enable' : 'disable'} request sent` : `Blocked: ${r.error}`); };
  return (
    <div className="grid">
      <div className="banner">The app only <b>requests</b> AC operation via relay 32 → 24 V DC contactor coil. Overload, phase-failure, E-stop and manufacturer protections are independent hardware and can never be bypassed or reset from here.</div>
      <div className="grid g3">
        <Panel title="Command">
          <p>Request: <b>{bad ? 'UNKNOWN' : ac.contactor ? 'ENABLED' : 'DISABLED'}</b> · Contactor feedback: <StatusText kind={bad ? 'warn' : flag(ac.contactor)[0]}>{bad ? 'UNKNOWN (input fault)' : ac.contactor === null ? 'Not connected' : ac.contactor ? 'Closed' : 'Open'}</StatusText></p>
          <div className="row">
            <button className="btn" disabled={!can || !il.allowed} onClick={() => ask('Request AC enable?', 'Interlocks are clear. The contactor will close if the panel protections also permit it.', () => send(true))}>Enable request</button>
            <button className="btn danger" disabled={!can} onClick={() => ask('Disable AC?', 'The contactor will open.', () => send(false), true)}>Disable request</button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted">Mode</span>
            <button className={`btn sm ${ac.auto ? '' : 'sec'}`} onClick={() => setState((x) => ({ ac: { ...x.ac, auto: false } }))}>Manual</button>
            <button className={`btn sm ${ac.auto ? 'sec' : ''}`} onClick={() => setState((x) => ({ ac: { ...x.ac, auto: true } }))}>Auto (schedule)</button>
          </div>
          {msg && <p role="status" className={msg.startsWith('Blocked') ? 'fault-text' : 'muted'}>{msg}</p>}
          {!il.allowed && <ul style={{ color: 'var(--warn)', paddingLeft: 18 }}>{il.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <p className="muted">Minimum compressor OFF-time: {AC_MIN_OFF_SECONDS}s</p>
        </Panel>
        <Panel title="Protection status">
          <table><tbody>
            {[['AC fault', flag(ac.fault, true, bad)], ['Overload trip', flag(ac.overload, true, bad)], ['Phase failure', flag(ac.phaseFail, true, bad)], ['Emergency stop', flag(ac.estop, true, bad)], ['Compressor running', flag(ac.compressor, false, bad)]]
              .map(([l, [k, t]]) => <tr key={l}><td>{l}</td><td><StatusText kind={k}>{t}</StatusText></td></tr>)}
          </tbody></table>
          <p className="muted">Trip resets are done locally at the panel by a qualified person.</p>
        </Panel>
        <Panel title="Electrical" right={m?.simulated && <span className="chip sim">SIM</span>}>
          <div className="grid g2">
            <Stat label="V R" value={m?.vr.toFixed(1)} unit="V" /><Stat label="I R" value={m?.ir.toFixed(2)} unit="A" />
            <Stat label="V Y" value={m?.vy.toFixed(1)} unit="V" /><Stat label="I Y" value={m?.iy.toFixed(2)} unit="A" />
            <Stat label="V B" value={m?.vb.toFixed(1)} unit="V" /><Stat label="I B" value={m?.ib.toFixed(2)} unit="A" />
            <Stat label="Frequency" value={m?.hz.toFixed(2)} unit="Hz" /><Stat label="PF" value={m?.pf?.toFixed(2)} />
            <Stat label="Active power" value={m?.kw.toFixed(2)} unit="kW" /><Stat label="Energy" value={m?.kwh.toFixed(1)} unit="kWh" />
          </div>
          <p className="muted">Note: the meter reads whole-building values; a dedicated AC feeder meter is awaiting hardware.</p>
        </Panel>
      </div>
      <Panel title="Runtime history">
        {s.commands.filter((c) => c.type === 'ac').length === 0 ? <span className="muted">No AC commands this session. Persistent runtime history needs Firestore (see docs).</span>
          : <table><thead><tr><th>Time</th><th>Request</th><th>Status</th></tr></thead><tbody>{s.commands.filter((c) => c.type === 'ac').map((c) => <tr key={c.id}><td>{new Date(c.ts).toLocaleTimeString()}</td><td>{c.on ? 'Enable' : 'Disable'}</td><td>{c.status}</td></tr>)}</tbody></table>}
      </Panel>
      {dialog}
    </div>
  );
}
