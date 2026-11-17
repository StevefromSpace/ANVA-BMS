import { getState, setRelays } from './store.js';
import { LIGHT_GROUPS } from './config.js';

const lastRun = new Map();

// Runs enabled schedules once per matching minute while the app is open.
export function tickSchedules(now = new Date()) {
  if (getState().mode !== 'sim') return; // live mode: the bridge owns schedules (docs/SCHEDULER.md)
  const hhmm = now.toTimeString().slice(0, 5);
  const key = now.toDateString() + hhmm;
  const { schedules, scenes } = getState();
  for (const s of schedules) {
    if (!s.enabled || s.time !== hhmm || lastRun.get(s.id) === key) continue;
    lastRun.set(s.id, key);
    const relays = s.action === 'all' ? LIGHT_GROUPS.map((g) => g.relay) : scenes.find((c) => c.id === s.target)?.relays ?? [];
    setRelays(relays, s.on, `Schedule "${s.name}"`);
  }
}

export const startScheduler = () => setInterval(() => tickSchedules(), 20000);
