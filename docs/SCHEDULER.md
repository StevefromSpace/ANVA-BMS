# Server scheduler

The bridge owns schedules in live mode. The browser scheduler (`web/src/core/scheduler.js`) runs in simulation mode only.

## State
| Env | Effect |
|---|---|
| `SCHEDULER_ENABLED=1` | Off by default (`disabled`). |
| `SCHEDULER_TZ` | IANA zone (e.g. `Asia/Kolkata`). Required when enabled; invalid value stops startup. |
| `SCHEDULER_DRY_RUN` | Default dry-run: decisions are logged and recorded, nothing published. Real switching needs `SCHEDULER_DRY_RUN=0` explicitly. |
| `MISSED_GRACE_MS` | Default `0`. See restart recovery. |

The bridge broadcasts `{type:'bridge',mqtt,scheduler:'disabled'|'dry-run'|'active'}` and `{type:'schedules',scheduler,schedules,results}`; the Schedules page shows this state.

## Schedules
`server/data/schedules.json` (git-ignored, written atomically via temp file + rename): `{id,name,time:'HH:MM',days:[0-6 (0=Sunday)],relays:[1-31],on,enabled,lastRun}`. Lighting relays 1-31 only; the scheduler never sends AC commands (validation rejects other relays). Admin-only WebSocket messages: `schedule_create {schedule}`, `schedule_update {id,schedule}`, `schedule_delete {id}`; `schedule_list` is allowed for all roles. Replies: `schedule_ack {ok,error,schedule}`.

## Semantics
- Matching uses wall-clock fields in `SCHEDULER_TZ` via `Intl.DateTimeFormat`. A skipped DST local time never matches; a repeated one shares one date-minute key, so it runs once.
- Dedupe: `lastRun` (`YYYY-MM-DDTHH:MM` local) is persisted before executing; a restart cannot double-run the same minute.
- Restart recovery: minutes since the last evaluated one are checked (max 7 days). A match older than `MISSED_GRACE_MS` is not replayed: it is logged and recorded as `skipped`. With grace > 0, misses within the window run late.
- Execution goes through the same gate and command path as manual commands (`runCommand`: gate, MQTT up, controller online, ack timeout) and is audit-logged as `scheduler:<name>`.
- Failure (controller offline, gate refusal, no ack) is recorded `ok:false` with the failed relays and broadcast as `{type:'schedule_result',payload}`; it is never retried. The last 100 results persist in the same file.
- The clock is injectable (`createScheduler({now})`) for tests.

## Limits
Single bridge process only (no leader election). The scheduler tick is 10 s. Relays are commanded one by one, so a group is not atomic. Not exercised against real controllers.
