import { Chart } from './Dashboard.jsx';
import { Gauge, Panel, SimChip, Stat } from '../components/ui.jsx';
import { useStore } from '../core/store.js';

export default function Meter() {
  const { meter: m, meterTs, history, energyToday } = useStore();
  const L = (a, b) => (m ? Math.sqrt(a * a + b * b + a * b) : null); // approx. line-line for 120° balanced
  return (
    <div className="grid">
      {!m && <div className="banner bad">No meter connected. Supports Modbus RTU (RS485) and Modbus TCP meters through the ESP32 gateway. Nothing is shown until real telemetry arrives.</div>}
      <div className="muted row">Last reading: {meterTs ? new Date(meterTs).toLocaleTimeString() : 'never'} <SimChip sim={m?.simulated} /></div>
      <div className="grid g3">
        {[['R', 'vr', 'ir'], ['Y', 'vy', 'iy'], ['B', 'vb', 'ib']].map(([p, v, i]) => (
          <Panel key={p} title={`Phase ${p}`}>
            <div className="grid g2"><Gauge value={m?.[v] ?? null} min={180} max={260} unit="V" label="Voltage L-N" /><Gauge value={m?.[i] ?? null} max={30} unit="A" label="Current" warnAbove={25} /></div>
          </Panel>))}
      </div>
      <div className="grid g4">
        <Panel><Stat label="V L-L (R-Y, computed)" value={m ? L(m.vr, m.vy).toFixed(0) : null} unit="V" /></Panel>
        <Panel><Stat label="Frequency" value={m?.hz.toFixed(2)} unit="Hz" /></Panel>
        <Panel><Stat label="Power factor" value={m?.pf?.toFixed(3)} /></Panel>
        <Panel><Stat label="Max demand" value={history.length ? Math.max(...history.map((h) => h.kw)).toFixed(2) : null} unit="kW (session)" /></Panel>
        <Panel><Stat label="Active power" value={m?.kw.toFixed(2)} unit="kW" /></Panel>
        <Panel><Stat label="Reactive power" value={m?.kvar.toFixed(2)} unit="kVAr" /></Panel>
        <Panel><Stat label="Apparent power" value={m?.kva.toFixed(2)} unit="kVA" /></Panel>
        <Panel><Stat label="Import energy" value={m?.kwh.toFixed(1)} unit="kWh" /></Panel>
        <Panel><Stat label="Export energy" value={null} /><span className="muted">No export register configured</span></Panel>
        <Panel><Stat label="Today (session)" value={m ? energyToday.toFixed(3) : null} unit="kWh" /></Panel>
      </div>
      <div className="grid g3">
        <Panel title="Voltage (V)"><Chart data={history} keys={[['vr', '#2fa8ff'], ['vy', '#ffc13b'], ['vb', '#3be39a']]} /></Panel>
        <Panel title="Current (A)"><Chart data={history} keys={[['ir', '#2fa8ff'], ['iy', '#ffc13b'], ['ib', '#3be39a']]} /></Panel>
        <Panel title="Active power (kW)"><Chart data={history} keys={[['kw', '#22e6e6']]} /></Panel>
      </div>
    </div>
  );
}
