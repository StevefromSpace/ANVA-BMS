// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAck, applyStatus, applyTelemetry, getState, sendCommand } from '../src/core/store.js';
import { relayStatus, lightingLoad } from '../src/core/logic.js';
import { CONFIRM_WINDOW_MS, LIGHT_GROUPS } from '../src/core/config.js';

const C = 'esp32_01';
const st = (n = 1) => relayStatus(getState().relays[n - 1], getState().controllers[C]);
const tele = (relays) => applyTelemetry(C, { ts: Date.now(), relays: relays ?? Array(16).fill(false) });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); applyStatus(C, true); tele(); });
afterEach(() => vi.useRealTimers());

describe('relay state machine', () => {
  it('starts CONFIRMED OFF from telemetry', () => { expect(st()).toBe('CONFIRMED'); expect(getState().relays[0].state).toBe(false); });

  it('ack without telemetry is PENDING and never changes physical state', () => {
    const { id } = sendCommand({ type: 'relay', relay: 1, on: true });
    applyAck({ id, ok: true });
    expect(getState().relays[0].state).toBe(false);
    expect(getState().relays[0].cmdStatus).toBe('accepted');
    expect(st()).toBe('PENDING');
  });

  it('telemetry matching the request confirms it', () => {
    const { id } = sendCommand({ type: 'relay', relay: 1, on: true });
    applyAck({ id, ok: true });
    tele([true, ...Array(15).fill(false)]);
    expect(st()).toBe('CONFIRMED'); expect(getState().relays[0].state).toBe(true);
  });

  it('acked but telemetry never matches => UNCONFIRMED after the window (stuck relay)', () => {
    const { id } = sendCommand({ type: 'relay', relay: 1, on: true });
    applyAck({ id, ok: true });
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS + 1); tele();
    expect(st()).toBe('UNCONFIRMED'); expect(getState().relays[0].state).toBe(false);
  });

  it('no ack at all => timeout => UNCONFIRMED', () => {
    sendCommand({ type: 'relay', relay: 1, on: true });
    vi.advanceTimersByTime(CONFIRM_WINDOW_MS + 1);
    expect(getState().relays[0].cmdStatus).toBe('timeout'); expect(st()).toBe('UNCONFIRMED');
  });

  it('rejected command leaves physical state and drops the request', () => {
    const { id } = sendCommand({ type: 'relay', relay: 1, on: true });
    applyAck({ id, ok: false, error: 'busy' });
    expect(getState().relays[0].cmdStatus).toBe('rejected'); expect(st()).toBe('CONFIRMED'); expect(getState().relays[0].state).toBe(false);
  });

  it('null reading => UNKNOWN and not counted as on or off', () => {
    tele([null, true, ...Array(14).fill(false)]);
    expect(st(1)).toBe('UNKNOWN');
    const l = lightingLoad(getState().relays, getState().controllers);
    expect(l.unknown).toBeGreaterThanOrEqual(1); expect(l.onCount).toBe(1);
  });

  it('controller offline => UNKNOWN', () => { applyStatus(C, false); expect(st()).toBe('UNKNOWN'); });

  it('stale telemetry (>15s) => UNKNOWN', () => {
    expect(relayStatus(getState().relays[0], getState().controllers[C], Date.now() + 16000)).toBe('UNKNOWN');
  });

  it('never-received relay is UNKNOWN', () => { expect(relayStatus({ state: null, updated: null }, { online: true })).toBe('UNKNOWN'); });

  it('missing health/inputsValid are tolerated', () => { expect(() => tele()).not.toThrow(); expect(LIGHT_GROUPS.length).toBe(31); });
});
