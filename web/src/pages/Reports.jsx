import { Panel } from '../components/ui.jsx';
import { useStore } from '../core/store.js';

export default function Reports() {
  const s = useStore();
  return (
    <div className="grid g2">
      <Panel title="Command history (this session)">
        {s.commands.length === 0 ? <span className="muted">No commands yet.</span> : (
          <table><thead><tr><th>Time</th><th>Command</th><th>By</th><th>Status</th></tr></thead><tbody>
            {s.commands.slice(0, 50).map((c) => <tr key={c.id}><td>{new Date(c.ts).toLocaleTimeString()}</td>
              <td>{c.type === 'ac' ? `AC ${c.on ? 'enable' : 'disable'}` : `Relay ${c.relay} ${c.on ? 'ON' : 'OFF'}`}</td><td>{c.who}</td><td>{c.status}{c.error ? `: ${c.error}` : ''}</td></tr>)}
          </tbody></table>)}
      </Panel>
      <Panel title="Audit log (this session)">
        {s.audit.length === 0 ? <span className="muted">Empty.</span> : <table><tbody>{s.audit.slice(0, 50).map((a, i) => <tr key={i}><td>{new Date(a.t).toLocaleTimeString()}</td><td>{a.msg}</td></tr>)}</tbody></table>}
        <p className="muted">History is kept in memory only. Persistent audit/energy reports require Firestore (docs/FIREBASE.md): not yet connected.</p>
      </Panel>
    </div>
  );
}
