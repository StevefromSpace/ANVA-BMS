// Persistent server-side scheduler for LIGHTING relays 1-31 only (never AC).
// Commands go through the same gate/command path as manual ones via the injected execute().
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_RESULTS = 100, MAX_SCHEDULES = 200, MAX_CATCHUP_MIN = 7 * 24 * 60, MIN = 60_000;
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function validTz(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch { return false; } }

// Wall-clock fields of an instant in an IANA zone. Matching on wall-clock (not elapsed time) is DST-safe:
// a skipped local time never matches; a repeated one shares the same date-minute key so it runs once.
export function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`, time = `${p.hour}:${p.minute}`;
  return { date, time, day: WD[p.weekday], key: `${date}T${time}` };
}

export function validateSchedule(s) {
  if (!s || typeof s !== 'object') return 'Malformed schedule';
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 60) return 'name required (max 60)';
  if (typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)) return 'time must be HH:MM';
  if (!Array.isArray(s.days) || !s.days.length || !s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return 'days must be weekday numbers 0-6 (0=Sunday)';
  if (!Array.isArray(s.relays) || !s.relays.length || s.relays.length > 31 || !s.relays.every((r) => Number.isInteger(r) && r >= 1 && r <= 31)) return 'relays must be 1-31 (lighting only)';
  if (typeof s.on !== 'boolean') return 'on must be boolean';
  return null;
}
const clean = (s, id) => ({ id, name: s.name.trim(), time: s.time, days: [...new Set(s.days)].sort(), relays: [...new Set(s.relays)].sort((a, b) => a - b), on: s.on, enabled: s.enabled !== false, lastRun: s.lastRun ?? null });

export function createScheduler({ file, tz, enabled = false, dryRun = true, graceMs = 0, now = Date.now, execute, onResult = () => {}, onChange = () => {}, log = console.log, tickMs = 10_000 }) {
  if (enabled && !validTz(tz)) throw new Error('SCHEDULER_TZ must be a valid IANA timezone when the scheduler is enabled');
  let db = { schedules: [], results: [], lastTickAt: null };
  try { db = { ...db, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') throw new Error(`Cannot read ${file}: ${e.message}`); }
  const save = () => { mkdirSync(dirname(file), { recursive: true }); const t = `${file}.tmp`; writeFileSync(t, JSON.stringify(db, null, 2)); renameSync(t, file); };
  let timer = null, running = false;

  const state = () => (!enabled ? 'disabled' : dryRun ? 'dry-run' : 'active');
  const record = (r) => { db.results = [...db.results, r].slice(-MAX_RESULTS); save(); onResult(r); };

  async function fire(s, key, late) {
    const base = { id: randomUUID(), scheduleId: s.id, name: s.name, minute: key, at: now(), on: s.on, relays: s.relays };
    if (dryRun) { log(`SCHEDULE dry-run "${s.name}" ${key} relays=${s.relays} on=${s.on}`); return record({ ...base, ok: true, dryRun: true }); }
    const failed = [];
    for (const relay of s.relays) {
      let ack; try { ack = await execute({ type: 'relay', relay, on: s.on }, `scheduler:${s.name}`); } catch (e) { ack = { ok: false, error: e.message }; }
      if (!ack?.ok) failed.push({ relay, error: ack?.error ?? 'no result' });
    }
    log(`SCHEDULE ${failed.length ? 'FAILED' : 'ok'} "${s.name}" ${key}${late ? ' (late)' : ''}`);
    record({ ...base, ok: !failed.length, dryRun: false, ...(failed.length ? { error: `${failed.length} relay(s) failed`, failed } : {}) });   // never retried
  }

  // Evaluate whole minutes after the last evaluated one up to `t`. Missed minutes older than graceMs are skipped (logged).
  async function tick(t = now()) {
    if (!enabled || running) return; running = true;
    try {
      const cur = Math.floor(t / MIN) * MIN;
      let from = db.lastTickAt == null ? cur : Math.floor(db.lastTickAt / MIN) * MIN + MIN;
      if (cur - from > MAX_CATCHUP_MIN * MIN) from = cur - MAX_CATCHUP_MIN * MIN;
      for (let m = from; m <= cur; m += MIN) {
        const lp = localParts(m, tz);
        for (const s of db.schedules) {
          if (!s.enabled || s.time !== lp.time || !s.days.includes(lp.day) || s.lastRun === lp.key) continue;
          const age = t - m;
          s.lastRun = lp.key; db.lastTickAt = m; save();           // persist the dedupe key BEFORE executing
          if (m < cur && age > graceMs) { log(`SCHEDULE skipped missed "${s.name}" ${lp.key} (age ${Math.round(age / 1000)}s > grace ${graceMs}ms)`); record({ id: randomUUID(), scheduleId: s.id, name: s.name, minute: lp.key, at: t, ok: false, skipped: true, error: 'missed while bridge was down; not replayed' }); continue; }
          await fire(s, lp.key, m < cur);
        }
      }
      db.lastTickAt = cur; save();
    } finally { running = false; }
  }

  const api = {
    state, tick, localParts: (ms) => localParts(ms, tz),
    list: () => db.schedules.map((s) => ({ ...s })),
    results: () => db.results.slice(),
    create(s) { const e = validateSchedule(s); if (e) throw new Error(e); if (db.schedules.length >= MAX_SCHEDULES) throw new Error('Too many schedules');
      const x = clean(s, randomUUID().slice(0, 8)); db.schedules = [...db.schedules, x]; save(); onChange(); return { ...x }; },
    update(id, s) { const old = db.schedules.find((x) => x.id === id); if (!old) throw new Error('Unknown schedule');
      const m = { ...old, ...s }; const e = validateSchedule(m); if (e) throw new Error(e);
      const x = clean(m, id); x.lastRun = old.time === x.time && old.days.join() === x.days.join() ? old.lastRun : null;
      db.schedules = db.schedules.map((y) => (y.id === id ? x : y)); save(); onChange(); return { ...x }; },
    remove(id) { if (!db.schedules.some((x) => x.id === id)) throw new Error('Unknown schedule'); db.schedules = db.schedules.filter((x) => x.id !== id); save(); onChange(); },
    start() { if (!enabled) return; log(`Scheduler ${state()} tz=${tz} grace=${graceMs}ms`); tick().catch((e) => log('scheduler error', e.message)); timer = setInterval(() => tick().catch((e) => log('scheduler error', e.message)), tickMs); },
    stop() { clearInterval(timer); },
  };
  return api;
}
