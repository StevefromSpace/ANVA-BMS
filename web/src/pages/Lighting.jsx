import { useState } from 'react';
import { Panel, StatusText, Switch, useConfirm } from '../components/ui.jsx';
import { getState, sendCommand, setRelays, useStore } from '../core/store.js';
import { FLOORS, LIGHT_GROUPS } from '../core/config.js';
import { canOperate } from '../core/roles.js';
import { relayStatus } from '../core/logic.js';

// [StatusText kind, label] per display status. Physical ON/OFF is only ever shown when CONFIRMED.
const statusView = (st, r, online) => (!online ? ['fault', 'OFFLINE']
  : st === 'UNKNOWN' ? ['warn', 'UNKNOWN']
  : st === 'PENDING' ? ['warn', 'Pending confirmation…']
  : st === 'UNCONFIRMED' ? ['fault', `UNCONFIRMED: requested ${r.desired ? 'ON' : 'OFF'}, controller reports ${r.state ? 'ON' : 'OFF'}`]
  : r.state ? ['on', 'ON'] : ['off', 'OFF']);

export default function Lighting({ user }) {
  const s = useStore();
  const [floor, setFloor] = useState('All');
  const [toast, setToast] = useState('');
  const [ask, dialog] = useConfirm();
  const can = canOperate(user);
  const shown = LIGHT_GROUPS.filter((g) => floor === 'All' || g.floor === floor);

  const run = (relays, on, who = user.name) => {
    const res = setRelays(relays, on, who).filter((r) => !r.ok);
    setToast(res.length ? `${res.length} command(s) rejected: ${res[0].error}` : `${relays.length} command(s) sent`);
  };
  const bulk = (relays, on, label) => ask(`${label}?`, `This will switch ${relays.length} lighting group(s) ${on ? 'ON' : 'OFF'}.`, () => run(relays, on), !on);
  const all = LIGHT_GROUPS.map((g) => g.relay);
  const rooms = [...new Set(LIGHT_GROUPS.filter((g) => floor !== 'All' && g.floor === floor).map((g) => g.room))];

  return (
    <div className="grid">
      {!can && <div className="banner">Viewer role: controls are read-only.</div>}
      <Panel title="Bulk & scenes">
        <div className="row">
          <button className="btn" disabled={!can} onClick={() => bulk(shown.map((g) => g.relay), true, `All ${floor === 'All' ? '' : floor + ' '}lights ON`)}>All ON{floor !== 'All' && ` (${floor})`}</button>
          <button className="btn danger" disabled={!can} onClick={() => bulk(shown.map((g) => g.relay), false, `All ${floor === 'All' ? '' : floor + ' '}lights OFF`)}>All OFF{floor !== 'All' && ` (${floor})`}</button>
          <span className="muted">Scenes:</span>
          {s.scenes.map((sc) => <button key={sc.id} className="btn sec" disabled={!can} onClick={() => ask(`Apply scene "${sc.name}"?`, `Switches ${sc.relays.length} groups ON and all others OFF.`, () => { run(all.filter((r) => !sc.relays.includes(r)), false); run(sc.relays, true); })}>{sc.name}</button>)}
          <span className="spacer" />
          <select aria-label="Floor filter" value={floor} onChange={(e) => setFloor(e.target.value)}>
            <option>All</option>{FLOORS.map((f) => <option key={f}>{f}</option>)}</select>
        </div>
        {rooms.length > 0 && <div className="row" style={{ marginTop: 10 }}><span className="muted">Rooms in {floor}:</span>
          {rooms.map((r) => { const rel = LIGHT_GROUPS.filter((g) => g.room === r && g.floor === floor).map((g) => g.relay);
            return <span key={r} className="row" style={{ gap: 4 }}><b>{r}</b>
              <button className="btn sm" disabled={!can} onClick={() => run(rel, true)}>ON</button><button className="btn sm sec" disabled={!can} onClick={() => run(rel, false)}>OFF</button></span>; })}
        </div>}
        {toast && <p className="muted" role="status">{toast}</p>}
      </Panel>
      <div className="grid fill">
        {shown.map((g) => {
          const r = s.relays[g.relay - 1];
          const ctrl = s.controllers[g.controller];
          const st = relayStatus(r, ctrl);
          const [kind, label] = statusView(st, r, ctrl.online);
          const measured = s.meter && g.relay === 0 ? null : null; // per-group metering: not connected
          return (
            <Panel key={g.relay} className={`relay ${st === 'CONFIRMED' && r.state ? 'on' : ''}`} data-status={st}>
              <div className="row between"><span className="name">{g.floor} · {g.room}</span>
                <Switch on={st !== 'UNKNOWN' && r.state === true} pending={st === 'PENDING'} disabled={!can || !ctrl.online} label={`${g.room} relay ${g.relay}`}
                  onChange={(on) => { const x = sendCommand({ type: 'relay', relay: g.relay, on }, user.name); if (!x.ok) setToast(x.error); }} /></div>
              <div className="meta">Relay {g.relay} · {g.controller}</div>
              <div><StatusText kind={kind}>{label}</StatusText></div>
              {r.cmdStatus === 'timeout' && <div className="meta">No acknowledgement from controller</div>}
              <div className="meta">{g.lamps} lamps · ≈{g.ratedWatts} W rated · Measured: {measured ?? 'Not connected'}</div>
              <div className="meta">Telemetry {r.updated ? new Date(r.updated).toLocaleTimeString() : '—'}</div>
            </Panel>
          );
        })}
      </div>
      <Panel title="Relay 32">Reserved for the AC contactor request. Controlled only from the <a href="#/hvac">HVAC page</a> with interlock checks.</Panel>
      {dialog}
    </div>
  );
}
