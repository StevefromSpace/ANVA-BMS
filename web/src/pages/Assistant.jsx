import { useState } from 'react';
import { Panel, useConfirm } from '../components/ui.jsx';
import { getState, setRelays, useStore } from '../core/store.js';
import { findGroups, lightingLoad, parseIntent, relayStatus } from '../core/logic.js';
import { LIGHT_GROUPS } from '../core/config.js';
import { canOperate } from '../core/roles.js';

const NC = 'That reading is Not connected, so I cannot report it.';

const unk = (s) => { const n = lightingLoad(s.relays, s.controllers).unknown; return n ? ` (${n} group(s) UNKNOWN, not counted as on or off)` : ''; };

export function answer(intent, s) {
  const m = s.meter;
  switch (intent.intent) {
    case 'voltage': return m ? `R ${m.vr.toFixed(1)} V · Y ${m.vy.toFixed(1)} V · B ${m.vb.toFixed(1)} V${m.simulated ? ' (SIMULATED)' : ''}` : NC;
    case 'energy': return m ? `Today: ${s.energyToday.toFixed(3)} kWh this session, est. cost ${(s.energyToday * s.tariff).toFixed(2)}${m.simulated ? ' (SIMULATED)' : ''}` : NC;
    case 'ac': return s.ac.inputsValid === false ? 'AC state is UNKNOWN: the feedback inputs report a fault (open circuit). AC enable is blocked until the inputs are repaired.' : s.ac.contactor === null ? NC : `AC contactor is ${s.ac.contactor ? 'closed (running)' : 'open (stopped)'}. Fault: ${s.ac.fault ? 'YES' : 'no'}, overload: ${s.ac.overload ? 'YES' : 'no'}, phase failure: ${s.ac.phaseFail ? 'YES' : 'no'}.`;
    case 'alarms': { const a = s.alarms.filter((x) => !x.ack); return a.length ? a.map((x) => `• [${x.level}] ${x.text}`).join('\n') : 'No active alarms.'; }
    case 'topGroup': { const on = LIGHT_GROUPS.filter((g) => relayStatus(s.relays[g.relay - 1], s.controllers[g.controller]) === 'CONFIRMED' && s.relays[g.relay - 1].state); if (!on.length) return `No groups are confirmed ON${unk(s)}. Note: per-group metering is not connected, so I rank by rated wattage only.`;
      const top = on.sort((a, b) => b.ratedWatts - a.ratedWatts)[0]; return `By rated wattage: ${top.floor} ${top.room} (${top.ratedWatts} W). Per-group metering is not connected, so this is not a measurement.${unk(s)}`; }
    case 'controllers': return Object.entries(s.controllers).map(([id, c]) => `${id}: ${c.online ? 'online' : 'OFFLINE. Check power, Wi-Fi, MQTT broker reachability and credentials.'}`).join('\n');
    case 'report': { const l = lightingLoad(s.relays, s.controllers); return `Daily report\n• Lighting groups confirmed ON: ${l.onCount}/31 (${l.lamps} lamps), ${l.unknown} unknown, ${l.unconfirmed} unconfirmed\n• Energy this session: ${m ? s.energyToday.toFixed(3) + ' kWh' : 'Not connected'}\n• Active alarms: ${s.alarms.filter((a) => !a.ack).length}\n• Controllers online: ${Object.values(s.controllers).filter((c) => c.online).length}/2`; }
    case 'lights': { const l = lightingLoad(s.relays, s.controllers); return `${l.onCount} of 31 groups confirmed ON (${l.lamps} lamps). ${l.unknown} UNKNOWN (state not readable, not counted as on or off), ${l.unconfirmed} unconfirmed, ${l.pending} pending.`; }
    case 'tips': return 'Suggestions (from configuration, not measurements): schedule exterior lights by time, switch off unoccupied floors after hours, and avoid AC restarts inside the 5-minute compressor protection window.';
    default: return 'I can control lights by room/floor, and report voltage, energy, AC status, alarms, controllers and the daily report.';
  }
}

export default function Assistant({ user }) {
  const s = useStore();
  const [log, setLog] = useState([{ who: 'ai', text: 'ANVA AI ready. I only report real readings and never override safety interlocks. Try "turn on the conference room lights".' }]);
  const [text, setText] = useState('');
  const [ask, dialog] = useConfirm();
  const add = (who, t) => setLog((l) => [...l, { who, text: t }]);

  const submit = (e) => {
    e.preventDefault();
    const q = text.trim(); if (!q) return;
    setText(''); add('me', q);
    const it = parseIntent(q);
    if (it.intent === 'bulk' || it.intent === 'room') {
      if (!canOperate(user)) return add('ai', 'Your role is read-only.');
      const relays = it.intent === 'bulk' ? LIGHT_GROUPS.map((g) => g.relay) : findGroups(it.query).map((g) => g.relay);
      if (!relays.length) return add('ai', `I could not find a room or floor matching "${it.query}".`);
      return ask(`${it.on ? 'Switch ON' : 'Switch OFF'} ${relays.length} group(s)?`, 'ANVA AI requests confirmation before any switching.', () => {
        const res = setRelays(relays, it.on, `ANVA AI (${user.name})`); const bad = res.filter((r) => !r.ok);
        add('ai', bad.length ? `${bad.length} rejected: ${bad[0].error}` : `Sent ${relays.length} command(s). Waiting for controller telemetry to confirm; check the Lighting page for confirmed state.`);
      }, !it.on);
    }
    add('ai', answer(it, getState()));
  };
  return (
    <Panel title="ANVA AI assistant" right={<span className="chip">rule-based · no cloud LLM</span>}>
      <div className="chat" aria-live="polite">{log.map((m, i) => <div key={i} className={`msg ${m.who}`}>{m.text}</div>)}</div>
      <div className="row" style={{ margin: '8px 0' }}>{['Show active alarms', 'What is the three-phase voltage?', 'Show the AC running status', "Show today's energy consumption", 'Prepare the daily energy report', 'Which lighting group is consuming the most power?'].map((q) =>
        <button key={q} className="btn sm sec" onClick={() => setText(q)}>{q}</button>)}</div>
      <form className="row" onSubmit={submit}><input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="ANVA, turn on the conference room lights" aria-label="Message" /><button className="btn">Send</button></form>
      {dialog}
    </Panel>
  );
}
