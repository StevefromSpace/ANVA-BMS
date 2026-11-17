import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel, Stat } from '../components/ui.jsx';
import { useStore } from '../core/store.js';
import { LIGHT_GROUPS } from '../core/config.js';
import { lightingLoad, relayStatus } from '../core/logic.js';

export default function Energy() {
  const s = useStore();
  const m = s.meter;
  const groups = LIGHT_GROUPS.map((g) => ({ name: g.room + ' ' + g.floor[0], watts: relayStatus(s.relays[g.relay - 1], s.controllers[g.controller]) === 'CONFIRMED' && s.relays[g.relay - 1].state ? g.ratedWatts : 0 })).filter((g) => g.watts).sort((a, b) => b.watts - a.watts);
  const { unknown } = lightingLoad(s.relays, s.controllers);
  return (
    <div className="grid">
      {s.mode === 'sim' && <div className="banner">Simulated data. Daily/weekly/monthly history needs a real meter plus Firestore aggregation (docs/FIREBASE.md); only the current session is available.</div>}
      <div className="grid g4">
        <Panel><Stat label="Today (session)" value={m ? s.energyToday.toFixed(3) : null} unit="kWh" /></Panel>
        <Panel><Stat label="Est. cost today" value={m ? (s.energyToday * s.tariff).toFixed(2) : null} /></Panel>
        <Panel><Stat label="Peak demand (session)" value={s.history.length ? Math.max(...s.history.map((h) => h.kw)).toFixed(2) : null} unit="kW" /></Panel>
        <Panel><Stat label="Tariff / kWh" value={s.tariff} /></Panel>
      </div>
      <Panel title="Lighting load by group, confirmed ON (rated W)">
        {unknown > 0 && <p className="muted" data-testid="energy-unknown">{unknown} group(s) have unknown state and are not included.</p>}
        {groups.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={groups}><CartesianGrid stroke="#0f5a74" strokeOpacity={0.4} vertical={false} />
              <XAxis dataKey="name" stroke="#6fb3bf" fontSize={10} interval={0} angle={-35} textAnchor="end" height={70} /><YAxis stroke="#6fb3bf" fontSize={11} />
              <Tooltip contentStyle={{ background: '#06223a', border: '1px solid #0f5a74' }} /><Bar dataKey="watts" fill="#2fa8ff" isAnimationActive={false} /></BarChart>
          </ResponsiveContainer>) : <span className="muted">No lighting groups are confirmed ON.</span>}
        <p className="muted">Rated wattage (lamps × 100 W), not measured. Per-group metering is not connected.</p>
      </Panel>
    </div>
  );
}
