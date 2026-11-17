import { Panel, StatusText } from '../components/ui.jsx';
import { ackAlarm, setState, useStore } from '../core/store.js';

export default function Alarms() {
  const alarms = useStore((s) => s.alarms);
  return (
    <Panel title="Alarm centre" right={<button className="btn sm sec" onClick={() => setState((s) => ({ alarms: s.alarms.map((a) => ({ ...a, ack: true })) }))}>Acknowledge all</button>}>
      <p className="muted">Acknowledging an alarm only silences it in the app. Protection trips (overload, phase failure) must be reset locally at the panel.</p>
      {alarms.length === 0 ? <p>No alarms.</p> : (
        <table><thead><tr><th>Time</th><th>Level</th><th>Source</th><th>Message</th><th /></tr></thead>
          <tbody>{alarms.map((a) => (
            <tr key={a.id} style={{ opacity: a.ack ? 0.55 : 1 }}>
              <td>{new Date(a.t).toLocaleString()}</td><td><StatusText kind={a.level === 'critical' ? 'fault' : 'warn'}>{a.level}</StatusText></td>
              <td>{a.source}</td><td>{a.text}</td>
              <td>{a.ack ? 'acknowledged' : <button className="btn sm" onClick={() => ackAlarm(a.id)}>Acknowledge</button>}</td></tr>))}</tbody></table>)}
    </Panel>
  );
}
