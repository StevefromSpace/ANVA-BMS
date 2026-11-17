import { Panel, StatusText } from '../components/ui.jsx';
import { FUTURE_MODULES } from '../core/config.js';

export default function Modules({ kind }) {
  const mod = FUTURE_MODULES[kind];
  return (
    <div className="grid">
      <div className="banner">{mod.title}: no hardware connected. Expansion section is ready; nothing below is a live reading.</div>
      {mod.note && <Panel title="Safety note">{mod.note}</Panel>}
      <div className="grid fill">
        {mod.items.map((i) => <Panel key={i} title={i}><StatusText kind="off">Not connected</StatusText></Panel>)}
      </div>
    </div>
  );
}
