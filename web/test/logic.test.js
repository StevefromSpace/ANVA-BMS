import { describe, expect, it } from 'vitest';
import { acInterlock, findGroups, lightingLoad, parseIntent, validateCommand } from '../src/core/logic.js';
import { LIGHT_GROUPS, totalLamps } from '../src/core/config.js';

const okState = () => ({ controllers: { esp32_02: { online: true } }, ac: { fault: false, overload: false, phaseFail: false, estop: false, mode: 'manual', offSince: null } });

describe('config', () => {
  it('has 31 groups covering 78 lamps', () => { expect(LIGHT_GROUPS).toHaveLength(31); expect(totalLamps()).toBe(78); });
});
describe('acInterlock', () => {
  it('allows when all clear', () => expect(acInterlock(okState()).allowed).toBe(true));
  it.each(['fault', 'overload', 'phaseFail', 'estop'])('blocks on %s', (k) => { const s = okState(); s.ac[k] = true; expect(acInterlock(s).allowed).toBe(false); });
  it('blocks when controller offline', () => { const s = okState(); s.controllers.esp32_02.online = false; expect(acInterlock(s).allowed).toBe(false); });
  it('enforces min off-time', () => { const s = okState(); s.ac.offSince = 1000; expect(acInterlock(s, 1000 + 60000).allowed).toBe(false); expect(acInterlock(s, 1000 + 301000).allowed).toBe(true); });
});
describe('validateCommand', () => {
  it('accepts relays 1-31', () => expect(validateCommand({ type: 'relay', relay: 5, on: true })).toBeFalsy());
  it('rejects relay 32 as lighting and out of range', () => { expect(validateCommand({ type: 'relay', relay: 32, on: true })).toBeTruthy(); expect(validateCommand({ type: 'relay', relay: 0, on: true })).toBeTruthy(); });
  it('rejects non-boolean', () => expect(validateCommand({ type: 'ac', on: 'yes' })).toBeTruthy());
  it('rejects unknown type', () => expect(validateCommand({ type: 'x' })).toBeTruthy());
});
describe('lightingLoad', () => {
  const now = 100000, ctrls = { esp32_01: { online: true }, esp32_02: { online: true } };
  const rel = (f) => LIGHT_GROUPS.map((g) => ({ relay: g.relay, ...f(g.relay) }));
  it('sums rated watts of CONFIRMED ON groups', () => { const r = rel((n) => ({ state: n === 1, updated: now })); expect(lightingLoad(r, ctrls, now).watts).toBe(LIGHT_GROUPS[0].ratedWatts); });
  it('never counts unknown relays as on', () => { const r = rel((n) => ({ state: n === 1 ? true : null, updated: n === 1 ? now : null })); const l = lightingLoad(r, ctrls, now); expect(l.onCount).toBe(1); expect(l.unknown).toBe(30); });
});
describe('parseIntent', () => {
  it('bulk on/off', () => { expect(parseIntent('turn on all lights')).toMatchObject({ intent: 'bulk', on: true }); expect(parseIntent('switch off all lights')).toMatchObject({ intent: 'bulk', on: false }); });
  it('room', () => expect(parseIntent('ANVA, turn on the conference room lights')).toMatchObject({ intent: 'room', on: true, query: 'conference room' }));
  it('queries', () => { expect(parseIntent('show active alarms').intent).toBe('alarms'); expect(parseIntent('what is the three-phase voltage?').intent).toBe('voltage'); expect(parseIntent('show the AC running status').intent).toBe('ac'); expect(parseIntent('gibberish').intent).toBe('unknown'); });
  it('findGroups matches by room', () => expect(Array.isArray(findGroups('conference room'))).toBe(true));
});
describe('hardware fault interlock', () => {
  it('blocks AC on I2C/MCP fault and on invalid AC inputs', () => {
    expect(acInterlock({ ...okState(), controllers: { esp32_02: { online: true, health: { i2c: 'ok', mcp: [{ addr: 32, ok: false }] } } } }).allowed).toBe(false);
    expect(acInterlock({ ...okState(), ac: { ...okState().ac, inputsValid: false } }).allowed).toBe(false);
  });
});
