import { useState } from 'react';
import { Panel } from '../components/ui.jsx';
import { setMode, setState, useStore } from '../core/store.js';
import { isAdmin } from '../core/roles.js';
import { LIGHT_GROUPS, totalLamps } from '../core/config.js';

export default function Settings({ user }) {
  const s = useStore();
  const [url, setUrl] = useState(s.bridgeUrl);
  const admin = isAdmin(user);
  return (
    <div className="grid g2">
      <Panel title="Data source">
        <p>Current: <b>{s.mode === 'sim' ? 'SIMULATION' : 'LIVE (Node bridge)'}</b></p>
        <div className="row">
          <button className={`btn ${s.mode === 'sim' ? '' : 'sec'}`} disabled={!admin} onClick={() => setMode('sim')}>Simulation</button>
          <button className={`btn ${s.mode === 'live' ? '' : 'sec'}`} disabled={!admin} onClick={() => setMode('live', url)}>Live hardware</button>
        </div>
        <label className="muted" style={{ display: 'block', marginTop: 10 }}>Bridge WebSocket URL
          <input style={{ width: '100%' }} value={url} onChange={(e) => setUrl(e.target.value)} disabled={!admin} /></label>
        <p className="muted">Live mode signs in with an individual account on the bridge (session token kept in this tab only). Accounts are managed on the server with <code>node server/users-cli.js</code>; roles are assigned and enforced server-side. In simulation the role picker is local and NOT secure. MQTT credentials live only in server/.env. Switching mode resets live readings. {!admin && 'Admin role required.'}</p>
      </Panel>
      <Panel title="Energy tariff">
        <label>Price per kWh <input type="number" min="0" step="0.1" style={{ width: 100 }} value={s.tariff} disabled={!admin}
          onChange={(e) => setState({ tariff: Math.max(0, Number(e.target.value) || 0) })} /></label>
      </Panel>
      <Panel title="Device configuration (read-only)">
        <p>{LIGHT_GROUPS.length} lighting groups · {totalLamps()} lamps · 32 relay channels (31 lighting + relay 32 AC request).</p>
        <p className="muted">Groups are defined in web/src/core/config.js; edit it to match your wiring.</p>
      </Panel>
      <Panel title="Users & access">
        <p>Signed in: <b>{user.name}</b> ({user.role})</p>
        <p className="muted">Roles are local placeholders: viewer (read-only), operator, admin. Real accounts require Firebase Authentication (docs/FIREBASE.md), not configured.</p>
      </Panel>
    </div>
  );
}
