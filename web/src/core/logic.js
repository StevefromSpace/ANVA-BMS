// Pure logic: safety interlocks, power math, AI intent parsing. No React, no I/O.
import { LIGHT_GROUPS, AC_MIN_OFF_SECONDS, CONFIRM_WINDOW_MS, TELEMETRY_STALE_MS } from './config.js';

export const fmt = (v, d = 1, unit = '') => (v == null || Number.isNaN(v) ? 'Not connected' : `${Number(v).toFixed(d)}${unit ? ' ' + unit : ''}`);

/** Controller self-test fault: I2C bus failed or any MCP23017 expander not responding. Absent health => no fault known. */
export const hardwareFault = (health) => !!health && (health.i2c === 'fail' || (health.mcp || []).some((m) => m.ok === false));

/**
 * Display status of one relay. Physical state (r.state) comes ONLY from telemetry; r.desired is the last request.
 * CONFIRMED: telemetry known and matches (or nothing requested). PENDING: waiting for telemetry inside the window.
 * UNCONFIRMED: requested but telemetry did not match in time (or no ack). UNKNOWN: offline, stale, null or never read.
 */
export function relayStatus(r, ctrl, now = Date.now()) {
  if (!ctrl?.online || r.state == null || r.updated == null || now - r.updated > TELEMETRY_STALE_MS) return 'UNKNOWN';
  if (r.desired == null || r.desired === r.state) return 'CONFIRMED';
  if (r.cmdStatus === 'timeout') return 'UNCONFIRMED';
  return now - r.cmdAt <= CONFIRM_WINDOW_MS ? 'PENDING' : 'UNCONFIRMED';
}

/** Returns { allowed, reasons[] }. The app only *requests*; hardware interlocks have the final say. */
export function acInterlock(state, now = Date.now()) {
  const reasons = [];
  const c = state.controllers.esp32_02;
  if (!c.online) reasons.push('Controller ESP32-S3 is offline');
  const ac = state.ac;
  if (ac.fault) reasons.push('AC fault active');
  if (ac.overload) reasons.push('Overload trip active (reset locally at the panel)');
  if (ac.phaseFail) reasons.push('Phase failure / protection relay active');
  if (ac.estop) reasons.push('Emergency stop engaged');
  if (ac.inputsValid === false) reasons.push('AC feedback inputs fault (open circuit), AC state unknown');
  if (hardwareFault(c.health)) reasons.push('Controller hardware fault (I2C / MCP23017)');
  if (ac.mode === 'unknown') reasons.push('Interlock status unknown, no telemetry');
  if (ac.offSince && now - ac.offSince < AC_MIN_OFF_SECONDS * 1000) {
    reasons.push(`Compressor minimum OFF-time: ${Math.ceil((AC_MIN_OFF_SECONDS * 1000 - (now - ac.offSince)) / 1000)} s remaining`);
  }
  return { allowed: reasons.length === 0, reasons };
}

/** Only CONFIRMED-ON relays count as on. Unknown / pending / unconfirmed are reported separately, never as on or off. */
export function lightingLoad(relays, controllers, now = Date.now()) {
  const st = relays.filter((r) => r.relay <= 31).map((r) => [r, relayStatus(r, controllers[LIGHT_GROUPS[r.relay - 1].controller], now)]);
  const on = st.filter(([r, s]) => s === 'CONFIRMED' && r.state === true).map(([r]) => r);
  const count = (s) => st.filter(([, x]) => x === s).length;
  return {
    onCount: on.length, lamps: on.reduce((a, r) => a + LIGHT_GROUPS[r.relay - 1].lamps, 0),
    watts: on.reduce((a, r) => a + LIGHT_GROUPS[r.relay - 1].ratedWatts, 0),
    unknown: count('UNKNOWN'), unconfirmed: count('UNCONFIRMED'), pending: count('PENDING'), known: st.length - count('UNKNOWN'),
    onRelays: on.map((r) => r.relay),
  };
}

export const makeCommandId = () => `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function validateCommand(cmd) {
  if (!cmd || typeof cmd !== 'object') return 'Invalid command';
  if (cmd.type === 'relay') {
    if (!Number.isInteger(cmd.relay) || cmd.relay < 1 || cmd.relay > 31) return 'Relay must be 1-31 (32 is reserved for the AC request)';
    if (typeof cmd.on !== 'boolean') return 'on must be boolean';
    return null;
  }
  if (cmd.type === 'ac') return typeof cmd.on === 'boolean' ? null : 'on must be boolean';
  return 'Unknown command type';
}

/** ANVA AI: rule-based intent parser. Answers only from supplied state; never invents readings. */
export function parseIntent(text) {
  const t = text.toLowerCase().replace(/^anva[, ]*/, '').trim();
  if (/(turn|switch) (on|off) all|all (lights|lighting).*(on|off)|switch off all|turn on all/.test(t)) {
    return { intent: 'bulk', on: /\bon\b/.test(t.replace(/switch off|turn off/g, '')) && !/(off)/.test(t) };
  }
  const sw = t.match(/(turn|switch)\s+(on|off)\s+(the\s+)?(.+?)(\s+lights?|\s+lighting)?$/);
  if (sw) return { intent: 'room', on: sw[2] === 'on', query: sw[4].trim() };
  if (/(how many|which|status of).*(light|lamp)|lighting status/.test(t) && !/(most|highest)/.test(t)) return { intent: 'lights' };
  if (/alarm/.test(t)) return { intent: 'alarms' };
  if (/(most|highest).*(power|consum)/.test(t)) return { intent: 'topGroup' };
  if (/(three.?phase|phase)?.*voltage/.test(t)) return { intent: 'voltage' };
  if (/\bac\b|air.?con|hvac/.test(t)) return { intent: 'ac' };
  if (/report/.test(t)) return { intent: 'report' };
  if (/(energy|consumption|kwh)/.test(t)) return { intent: 'energy' };
  if (/(controller|offline|connect)/.test(t)) return { intent: 'controllers' };
  if (/saving|recommend/.test(t)) return { intent: 'tips' };
  return { intent: 'unknown' };
}

export function findGroups(query) {
  const q = query.toLowerCase();
  return LIGHT_GROUPS.filter((g) => g.room.toLowerCase().includes(q) || q.includes(g.room.toLowerCase()) || `${g.floor} floor`.toLowerCase() === q || g.floor.toLowerCase() === q.replace(' floor', ''));
}
