import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScheduler, localParts, validateSchedule } from './scheduler.js';

const MIN = 60000, TZ = 'Asia/Kolkata';
const T0 = Date.parse('2026-03-02T00:30:00Z');   // Monday 06:00 IST
const mk = (o = {}) => {
  const file = o.file ?? join(mkdtempSync(join(tmpdir(), 'sch-')), 's.json'); const calls = [], results = [];
  const s = createScheduler({ file, tz: TZ, enabled: true, dryRun: false, log: () => {}, onResult: (r) => results.push(r),
    execute: async (c) => { calls.push(c); return o.ack ?? { ok: true }; }, ...o });
  return { s, calls, results, file };
};
const sch = { name: 'a', time: '06:00', days: [1], relays: [1, 2], on: true };

test('localParts DST-safe (America/New_York spring forward)', () => {
  assert.equal(localParts(Date.parse('2026-03-08T06:59:00Z'), 'America/New_York').time, '01:59');
  assert.equal(localParts(Date.parse('2026-03-08T07:00:00Z'), 'America/New_York').time, '03:00');   // 02:xx never occurs
  const a = localParts(Date.parse('2026-11-01T05:30:00Z'), 'America/New_York'), b = localParts(Date.parse('2026-11-01T06:30:00Z'), 'America/New_York');
  assert.equal(a.key, b.key);                                                                         // repeated 01:30 -> same dedupe key
});
test('validation: lighting relays 1-31 only', () => {
  assert.ok(validateSchedule({ ...sch, relays: [32] })); assert.ok(validateSchedule({ ...sch, relays: [0] }));
  assert.ok(validateSchedule({ ...sch, time: '25:00' })); assert.equal(validateSchedule(sch), null);
});
test('requires valid tz when enabled', () => assert.throws(() => createScheduler({ file: 'x', enabled: true, tz: 'Nope/Zone' }), /IANA/));
test('fires on matching minute once (dedupe), skips other days', async () => {
  const { s, calls } = mk(); s.create(sch);
  await s.tick(T0); await s.tick(T0 + 20000); assert.equal(calls.length, 2);        // 2 relays, once
  const m = mk(); m.s.create({ ...sch, days: [2] }); await m.s.tick(T0); assert.equal(m.calls.length, 0);
});
test('dry-run publishes nothing but records result', async () => {
  const { s, calls, results } = mk({ dryRun: true }); s.create(sch); await s.tick(T0);
  assert.equal(calls.length, 0); assert.equal(results[0].dryRun, true);
});
test('disabled does nothing', async () => { const { s, calls } = mk({ enabled: false }); s.create(sch); await s.tick(T0); assert.equal(calls.length, 0); });
test('offline controller => failed result, no retry', async () => {
  const { s, calls, results } = mk({ ack: { ok: false, error: 'Controller esp32_01 offline' } }); s.create(sch);
  await s.tick(T0); await s.tick(T0 + 5000);
  assert.equal(results.length, 1); assert.equal(results[0].ok, false); assert.equal(calls.length, 2);
});
test('restart recovery: dedupe persisted; missed runs skipped by default, replayed within grace', async () => {
  const a = mk(); a.s.create(sch); await a.s.tick(T0);
  const r = mk({ file: a.file }); await r.s.tick(T0 + 10000); assert.equal(r.calls.length, 0);       // persisted lastRun
  const b = mk(); b.s.create(sch); await b.s.tick(T0 - MIN);                                         // last seen 05:59
  const down = mk({ file: b.file }); await down.s.tick(T0 + 5 * MIN);
  assert.equal(down.calls.length, 0); assert.equal(down.results[0].skipped, true);
  const c = mk(); c.s.create(sch); await c.s.tick(T0 - MIN);
  const g = mk({ file: c.file, graceMs: 10 * MIN }); await g.s.tick(T0 + 5 * MIN); assert.equal(g.calls.length, 2);
});
test('results capped at 100', async () => {
  const { s, results } = mk({ dryRun: true }); s.create({ ...sch, days: [0, 1, 2, 3, 4, 5, 6] });
  for (let d = 0; d < 120; d++) await s.tick(T0 + d * 86400000);
  assert.equal(s.results().length, 100);
});
