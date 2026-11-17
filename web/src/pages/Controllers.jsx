import { Dot, Panel } from '../components/ui.jsx';
import { CONTROLLERS, LIGHT_GROUPS } from '../core/config.js';
import { useStore } from '../core/store.js';
import { hardwareFault } from '../core/logic.js';

export default function Controllers() {
  const s = useStore();
  return (
    <div className="grid g2">
      {CONTROLLERS.map((c) => {
        const st = s.controllers[c.id];
        return (
          <Panel key={c.id} title={`${c.name} (${c.id})`} right={<span><Dot kind={st.online ? 'on' : 'off'} /> {st.online ? 'Online' : 'Offline'}</span>}>
            <table><tbody>
              <tr><td>Board</td><td>{c.board}</td></tr>
              <tr><td>Relays</td><td>{c.relays[0]}–{c.relays[1]}</td></tr>
              <tr><td>I/O</td><td>{c.expanders}</td></tr>
              <tr><td>Hardware health</td><td data-testid={`health-${c.id}`}>{!st.health ? <span className="muted">Not reported</span>
                : hardwareFault(st.health) ? <span className="fault-text">Hardware fault{st.health.i2c === 'fail' ? ': I2C bus' : ''}{(st.health.mcp || []).filter((m) => !m.ok).map((m) => `: MCP23017 0x${m.addr.toString(16)} not responding`).join('')}</span> : 'OK (I2C, MCP23017)'}</td></tr>
              <tr><td>Last seen</td><td>{st.lastSeen ? new Date(st.lastSeen).toLocaleTimeString() : 'never'}</td></tr>
              <tr><td>Lighting groups</td><td>{LIGHT_GROUPS.filter((g) => g.controller === c.id).length}</td></tr>
              <tr><td>Topics</td><td className="muted">anva/building001/{c.id}/telemetry · status · command · ack</td></tr>
            </tbody></table>
            {!st.online && <p className="muted">Offline: relays on this controller cannot be commanded.</p>}
          </Panel>
        );
      })}
    </div>
  );
}
