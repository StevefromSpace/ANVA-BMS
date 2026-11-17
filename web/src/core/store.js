// Central immutable store + transport adapters (simulation | websocket bridge).
import { useSyncExternalStore } from 'react';
import { LIGHT_GROUPS, controllerOfRelay, TARIFF_PER_KWH, CONFIRM_WINDOW_MS, TELEMETRY_STALE_MS as OFFLINE_AFTER_MS } from './config.js';
import { acInterlock, hardwareFault, makeCommandId, validateCommand } from './logic.js';

const initial = () => ({
  mode: localStorage.getItem('anva.mode') || 'sim', // 'sim' | 'live'
  bridgeUrl: localStorage.getItem('anva.bridge') || 'ws://localhost:8787',
  bridge: 'idle', // idle | connecting | connected | error
  controllers: {
    esp32_01: { online: false, lastSeen: null, rssi: null },
    esp32_02: { online: false, lastSeen: null, rssi: null },
  },
  // state = PHYSICAL (telemetry only; null = unknown). desired/cmdStatus/cmdAt/cmdId = last request and its ack, never physical.
  relays: Array.from({ length: 32 }, (_, i) => ({ relay: i + 1, state: null, updated: null, desired: null, cmdStatus: null, cmdAt: null, cmdId: null })),
  meter: null, // null => "Not connected"
  meterTs: null,
  ac: { mode: 'unknown', contactor: null, fault: false, overload: false, phaseFail: false, estop: false, compressor: null, enabled: false, offSince: null, auto: false },
  alarms: [],
  commands: [],
  history: [], // {t, kw, v}
  energyToday: 0,
  tariff: TARIFF_PER_KWH,
  scenes: [
    { id: 's1', name: 'Working hours', relays: LIGHT_GROUPS.filter((g) => ['First', 'Second', 'Ground'].includes(g.floor) && g.room !== 'Parking').map((g) => g.relay) },
    { id: 's2', name: 'Night security', relays: LIGHT_GROUPS.filter((g) => g.floor === 'Exterior').map((g) => g.relay) },
  ],
  schedules: [
    { id: 'sc1', name: 'Exterior lights ON', time: '18:30', days: 'Daily', action: 'scene', target: 's2', on: true, enabled: true },
    { id: 'sc2', name: 'All lighting OFF', time: '22:30', days: 'Daily', action: 'all', on: false, enabled: true },
  ],
  audit: [],
});

let state = initial();
const listeners = new Set();
export const getState = () => state;
export function setState(fn) {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
}
export const subscribe = (l) => (listeners.add(l), () => listeners.delete(l));
export const useStore = (sel = (s) => s) => useSyncExternalStore(subscribe, () => sel(state));

const log = (msg) => setState((s) => ({ audit: [{ t: Date.now(), msg }, ...s.audit].slice(0, 200) }));
export function raiseAlarm(level, source, text) {
  setState((s) => {
    if (s.alarms.some((a) => !a.ack && a.source === source && a.text === text)) return {};
    return { alarms: [{ id: makeCommandId(), t: Date.now(), level, source, text, ack: false }, ...s.alarms].slice(0, 200) };
  });
}
export const ackAlarm = (id) => setState((s) => ({ alarms: s.alarms.map((a) => (a.id === id ? { ...a, ack: true } : a)) }));

// ---- Inbound data (shared by simulation and the real bridge) ----
export function applyStatus(controller, online, extra = {}) {
  setState((s) => ({ controllers: { ...s.controllers, [controller]: { ...s.controllers[controller], online, lastSeen: Date.now(), ...extra } } }));
  if (!online) raiseAlarm('warning', controller, `Controller ${controller} went offline`);
}

/** telemetry: { ts, relays: [bool] (controller's own range), meter?, ac? } */
export function applyTelemetry(controller, p) {
  setState((s) => {
    const base = controller === 'esp32_01' ? 0 : 16;
    const relays = s.relays.map((r) => {
      const i = r.relay - 1 - base;
      const v = p.relays?.[i];
      if (i < 0 || i >= 16 || (v !== null && typeof v !== 'boolean')) return r;
      const confirmed = r.desired != null && v === r.desired;
      return { ...r, state: v, updated: Date.now(), ...(confirmed ? { desired: null, cmdStatus: null } : {}) };
    });
    const next = { relays, controllers: { ...s.controllers, [controller]: { ...s.controllers[controller], online: true, lastSeen: Date.now() } } };
    if (p.health) {
      next.controllers[controller] = { ...next.controllers[controller], health: p.health };
      if (hardwareFault(p.health)) queueMicrotask(() => raiseAlarm('critical', controller, `Controller ${controller} hardware fault (I2C / MCP23017)`));
    }
    if (p.meter) next.meter = p.meter, next.meterTs = p.ts || Date.now();
    if (p.ac) {
      const wasOn = s.ac.contactor === true;
      const ac = { ...s.ac, ...p.ac, mode: s.ac.auto ? 'auto' : 'manual' };
      if (wasOn && ac.contactor === false) ac.offSince = Date.now();
      next.ac = ac;
      if (ac.inputsValid === false && s.ac.inputsValid !== false) queueMicrotask(() => raiseAlarm('critical', 'AC', 'AC feedback inputs fault (open circuit), AC state unknown'));
      if (ac.overload && !s.ac.overload) raiseAlarm('critical', 'AC', 'Overload trip, local reset required');
      if (ac.phaseFail && !s.ac.phaseFail) raiseAlarm('critical', 'AC', 'Phase failure detected');
      if (ac.fault && !s.ac.fault) raiseAlarm('critical', 'AC', 'AC fault active');
    }
    return next;
  });
}

/** An ack only records the command outcome. It never touches r.state: physical state comes from telemetry. */
export function applyAck(ack) {
  const cmdStatus = ack.ok ? 'accepted' : ack.timeout ? 'timeout' : 'rejected';
  setState((s) => ({
    commands: s.commands.map((c) => (c.id === ack.id ? { ...c, status: ack.ok ? 'acked' : 'failed', error: ack.error, ackAt: Date.now() } : c)),
    // rejected: the request never took effect, so drop desired and let telemetry speak. timeout: keep desired => UNCONFIRMED.
    relays: s.relays.map((r) => (r.cmdId === ack.id ? { ...r, cmdStatus, ...(cmdStatus === 'rejected' ? { desired: null } : {}) } : r)),
  }));
  if (!ack.ok) raiseAlarm('warning', 'Command', `Command rejected: ${ack.error || 'unknown'}`);
}

// ---- Outbound commands ----
let transport = null;
export function sendCommand(partial, who = 'operator') {
  const s = state;
  const err = validateCommand(partial);
  if (err) return { ok: false, error: err };
  const target = partial.type === 'ac' ? 32 : partial.relay;
  const controller = controllerOfRelay(target);
  if (!s.controllers[controller].online) return { ok: false, error: `Controller ${controller} is offline` };
  if (partial.type === 'ac' && partial.on) {
    const il = acInterlock(s);
    if (!il.allowed) return { ok: false, error: il.reasons.join('; ') };
  }
  const cmd = { id: makeCommandId(), ts: Date.now(), controller, ...partial, status: 'sent' };
  setState((st) => ({
    commands: [cmd, ...st.commands].slice(0, 100),
    relays: partial.type === 'relay' ? st.relays.map((r) => (r.relay === partial.relay ? { ...r, desired: partial.on, cmdStatus: 'sent', cmdAt: cmd.ts, cmdId: cmd.id } : r)) : st.relays,
  }));
  log(`${who}: ${partial.type === 'ac' ? 'AC enable request ' : `relay ${partial.relay} `}${partial.on ? 'ON' : 'OFF'} (${cmd.id})`);
  transport?.send(cmd);
  setTimeout(() => {
    const c = state.commands.find((x) => x.id === cmd.id);
    if (c && c.status === 'sent') {
      applyAck({ id: cmd.id, ok: false, timeout: true, error: 'No acknowledgement (timeout)' });
    }
  }, CONFIRM_WINDOW_MS);
  return { ok: true, id: cmd.id };
}

export function setRelays(relays, on, who) {
  return relays.map((r) => sendCommand({ type: 'relay', relay: r, on }, who));
}

// ---- Mode / transports ----
export function setMode(mode, bridgeUrl) {
  localStorage.setItem('anva.mode', mode);
  if (bridgeUrl) localStorage.setItem('anva.bridge', bridgeUrl);
  transport?.stop();
  state = { ...initial(), mode, bridgeUrl: bridgeUrl || state.bridgeUrl, schedules: state.schedules, scenes: state.scenes, audit: state.audit };
  listeners.forEach((l) => l());
  startTransport();
}

export async function startTransport() {
  transport?.stop();
  const mod = state.mode === 'sim' ? await import('./sim.js') : await import('./bridge.js');
  transport = mod.create({ getState, applyStatus, applyTelemetry, applyAck, setState, raiseAlarm });
  transport.start();
}

// Offline detection + rolling history, both modes.
setInterval(() => {
  const now = Date.now();
  setState((s) => {
    const controllers = { ...s.controllers };
    let changed = false;
    for (const [id, c] of Object.entries(controllers)) {
      if (c.online && c.lastSeen && now - c.lastSeen > OFFLINE_AFTER_MS) {
        controllers[id] = { ...c, online: false };
        changed = true;
        queueMicrotask(() => raiseAlarm('warning', id, `Controller ${id} went offline (no telemetry for 15 s)`));
      }
    }
    const m = s.meter;
    const history = m ? [...s.history, { t: now, kw: m.kw, vr: m.vr, vy: m.vy, vb: m.vb, ir: m.ir, iy: m.iy, ib: m.ib }].slice(-300) : s.history;
    const energyToday = m ? s.energyToday + (m.kw / 3600) : s.energyToday;
    return { ...(changed ? { controllers } : {}), history, energyToday };
  });
}, 1000);
