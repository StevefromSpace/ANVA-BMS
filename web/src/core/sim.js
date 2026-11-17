// SIMULATION transport. Every reading it produces is labelled SIMULATED in the UI.
import { LIGHT_GROUPS } from './config.js';

export function create(api) {
  const hw = { relays: Array(32).fill(false), acOn: false, up: { esp32_01: true, esp32_02: true }, acFlags: { fault: false, overload: false, phaseFail: false, estop: false }, stuck: new Set(), unreadable: new Set() };
  let timer;
  // Test hooks (simulation only): drop a controller, inject AC protection flags,
  // stick(relay, true): controller acks commands for that relay but the relay does not move;
  // unreadable(relay, true): telemetry reports that relay as null (controller cannot read it).
  const flip = (set, n, v) => (v ? set.add(n) : set.delete(n));
  window.__animSim = {
    drop: (id, v) => (hw.up[id] = !v), setAcFlags: (f) => { Object.assign(hw.acFlags, f); tick(); },
    stick: (n, v) => flip(hw.stuck, n, v), unreadable: (n, v) => flip(hw.unreadable, n, v),
  };
  const noise = (a) => (Math.random() - 0.5) * 2 * a;

  const tick = () => {
    const now = Date.now();
    const lightW = hw.relays.slice(0, 31).reduce((s, on, i) => s + (on ? LIGHT_GROUPS[i].ratedWatts : 0), 0);
    const acW = hw.acOn ? 4200 : 0;
    const kw = (lightW + acW) / 1000;
    const v = (b) => 230 + noise(2.5) + b;
    const iPh = (hw.acOn ? 6.1 : 0) + lightW / 3 / 230;
    const meter = {
      vr: v(0), vy: v(0.6), vb: v(-0.5), ir: iPh + noise(0.1), iy: iPh + noise(0.1), ib: iPh + noise(0.1),
      hz: 50 + noise(0.05), pf: kw > 0 ? 0.9 + noise(0.02) : null, kw, kvar: kw * 0.45, kva: kw / 0.9, kwh: api.getState().energyToday + 1250,
      simulated: true,
    };
    for (const [id, [a, b]] of [['esp32_01', [0, 16]], ['esp32_02', [16, 32]]]) {
      if (!hw.up[id]) continue;
      api.applyTelemetry(id, {
        ts: now, relays: hw.relays.slice(a, b).map((on, k) => (hw.unreadable.has(a + k + 1) ? null : on)),
        health: { i2c: 'ok', mcp: [{ addr: 0x20, ok: true }, { addr: 0x21, ok: true }] },
        ...(id === 'esp32_02' ? { meter, ac: { contactor: hw.acOn, compressor: hw.acOn, inputsValid: true, ...hw.acFlags } } : {}),
      });
    }
    for (const id of ['esp32_01', 'esp32_02']) if (!hw.up[id] && api.getState().controllers[id].online) api.applyStatus(id, false);
  };

  return {
    start() { tick(); timer = setInterval(tick, 1000); },
    stop() { clearInterval(timer); delete window.__animSim; },
    send(cmd) {
      setTimeout(() => {
        if (!hw.up[cmd.controller]) return; // no ack -> UI timeout path
        // Real hardware: the ack only means 'command accepted'. Relay moves now; telemetry reports it on the next 1 s tick.
        if (cmd.type === 'relay') { if (!hw.stuck.has(cmd.relay)) hw.relays[cmd.relay - 1] = cmd.on; }
        else hw.acOn = cmd.on;
        api.applyAck({ id: cmd.id, ok: true });
        if (cmd.type === 'ac') api.setState((s) => ({ ac: { ...s.ac, enabled: cmd.on } }));
      }, 250 + Math.random() * 250);
    },
  };
}
