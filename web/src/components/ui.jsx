import { useState } from 'react';

export const Panel = ({ title, right, children, className = '', ...rest }) => (
  <section className={`panel ${className}`} {...rest}>
    {title && <h3><span>◢ {title}</span>{right}</h3>}
    {children}
  </section>
);

export const Stat = ({ label, value, unit, sim }) => (
  <div className="stat">
    <div className="l">{label}{sim && <span className="chip sim" style={{ marginLeft: 6 }}>SIM</span>}</div>
    {value == null || Number.isNaN(value)
      ? <div className="v na">Not connected</div>
      : <div className="v">{value}{unit && <small>{unit}</small>}</div>}
  </div>
);

export const Dot = ({ kind }) => <span className={`dot ${kind}`} aria-hidden="true" />;
export const StatusText = ({ kind, children }) => <span><Dot kind={kind} />{children}</span>;

export const Switch = ({ on, pending, disabled, onChange, label }) => (
  <div role="switch" aria-checked={!!on} aria-label={label} aria-disabled={disabled} tabIndex={0}
    className={`switch ${on ? 'on' : ''} ${pending ? 'pending' : ''}`}
    onClick={() => !disabled && !pending && onChange(!on)}
    onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !disabled && !pending && onChange(!on)} />
);

/** Radial gauge, SVG. value null => empty gauge + "n/c". */
export function Gauge({ value, min = 0, max = 100, unit, label, warnAbove }) {
  const r = 52, c = Math.PI * r;
  const f = value == null ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
  const bad = warnAbove != null && value > warnAbove;
  return (
    <div style={{ textAlign: 'center' }}>
      <svg viewBox="0 0 130 80" width="100%" style={{ maxWidth: 170 }}>
        <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke="#0a3550" strokeWidth="10" strokeLinecap="round" />
        <path d="M13 70 A52 52 0 0 1 117 70" fill="none" stroke={bad ? 'var(--bad)' : 'var(--cyan)'} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${f * c} ${c}`} style={{ transition: 'stroke-dasharray .6s' }} />
        <text x="65" y="60" textAnchor="middle" fill="#fff" fontSize={value == null ? 11 : 18} fontWeight="700">{value == null ? 'Not connected' : value.toFixed(value < 10 ? 2 : 1)}</text>
        <text x="65" y="76" textAnchor="middle" fill="var(--dim)" fontSize="9">{unit}</text>
      </svg>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

/** Confirmation dialog for bulk / critical operations. */
export function Confirm({ title, body, onYes, onNo, danger }) {
  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <h3 style={{ marginTop: 0, color: 'var(--cyan)' }}>{title}</h3>
        <div style={{ marginBottom: 18 }}>{body}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn sec" onClick={onNo}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={onYes} autoFocus>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/** Hook: returns [ask(opts), <ConfirmElement/>] */
export function useConfirm() {
  const [req, setReq] = useState(null);
  const el = req && <Confirm {...req} onNo={() => setReq(null)} onYes={() => { req.run(); setReq(null); }} />;
  return [(title, body, run, danger) => setReq({ title, body, run, danger }), el];
}

export const SimChip = ({ sim }) => (sim ? <span className="chip sim">SIMULATED DATA</span> : null);
