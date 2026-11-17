# ANVA BMS Architecture

Reflects the code as written. Anything touching a real broker, ESP32 or meter is untested on hardware. See [README](../README.md) for status and [SECURITY.md](SECURITY.md) for the security model.

## Components

```
Browser (React+Vite, web/)  <--WebSocket-->  Node bridge (server/)  <--MQTT-->  Broker  <--MQTT/TLS-->  ESP32 x2
   store.js + sim.js | bridge.js              bridge.js + gate.js                                       firmware/anva_controller
```

| Component | Path | Role |
|---|---|---|
| Web app | `web/src` | UI, state store (`core/store.js`), transport adapters: `core/sim.js` (simulation) and `core/bridge.js` (WebSocket to the bridge). Pure logic (interlocks, intent parser) in `core/logic.js`. Static config (31 groups, controllers, topics) in `core/config.js`. |
| Bridge | `server/bridge.js`, `server/gate.js` | Owns MQTT credentials (env only). Subscribes `anva/<building>/+/+`, rebroadcasts to WebSocket clients, gates inbound commands, publishes to the right controller. Binds `127.0.0.1:8787` by default. |
| Firmware | `firmware/anva_controller/anva_controller.ino` | One sketch for both boards, configured via `secrets.h`. Drives relays through 2x MCP23017, reads AC feedback (esp32_02 only), publishes telemetry every 2 s, applies commands with a local interlock. |
| Broker | external | Any MQTT broker reachable by bridge and controllers. Not part of this repo. |

Controllers (from `core/config.js`):

| ID | Board | Relays |
|---|---|---|
| `esp32_01` | ESP32 DevKit V1 | 1-16 (lighting) |
| `esp32_02` | ESP32-S3 N16R8 | 17-31 lighting, **32 = AC contactor request** |

31 lighting groups, 78 lamps (16 groups x 3 lamps + 15 groups x 2 lamps). `LAMP_WATTS = 100` is an assumption in config, used only for the simulated/estimated load.

## MQTT contract

Topic: `anva/<building>/<controller>/<kind>`. Building defaults to `building001`; controller is `esp32_01` or `esp32_02`; kind is `telemetry | status | command | ack`.

| Kind | Direction | Payload |
|---|---|---|
| `telemetry` | controller -> | `{ts, relays:[16 bool], ac?:{contactor,overload,phaseFail,estop,fault}, meter?:{vr,vy,vb,ir,iy,ib,hz,pf,kw,kva,kvar,kwh}}`. `relays` covers the controller's own 16 channels (store maps esp32_01 -> relays 1-16, else 17-32). `ac` only from esp32_02. `meter` is **never sent by current firmware**. `ts` is firmware `millis()`, not wall-clock. |
| `status` | controller -> (retained, LWT) | `{online:bool}`. Firmware registers last-will `{"online":false}` and publishes `{"online":true}` retained on connect. |
| `command` | -> controller | `{id, type:'relay'\|'ac', relay?, on}` |
| `ack` | controller -> | `{id, ok, error?}` |

Bridge-to-browser WebSocket messages: `{type:'telemetry'\|'status'\|'ack', controller, ...}` down; `{type:'command', payload}` up. (Bridge auth/origin checks are being added; see [SECURITY.md](SECURITY.md).)

## Command / ack flow

1. UI calls `sendCommand` (`store.js`): validates (`validateCommand`), rejects if the target controller is offline, and for AC-ON runs `acInterlock`.
2. A command record (`status: 'sent'`) is stored, the relay is marked `pending`, an audit line is logged, the command goes to the transport.
3. Live mode: bridge checks the session role (operator+), then runs `gateCommand` in `runCommand` (shared with the server scheduler), writing an audit line with the username. On rejection it replies with `ack {ok:false,error}` itself; otherwise it publishes to `anva/<b>/<controller>/command`.
4. Firmware applies it (range check, AC interlock), publishes `ack`, then publishes telemetry.
5. Bridge broadcasts the ack; `applyAck` clears `pending` and sets the relay state from the ack.
6. No ack within 5 s: the UI synthesises `ok:false, 'No acknowledgement (timeout)'` and raises a warning alarm.
7. A controller is marked offline after 15 s without telemetry (`OFFLINE_AFTER_MS`) or on a `status` offline message.

Known limits: relay state is set from the ack, not from confirmed telemetry; the bridge broadcasts every ack to every WebSocket client; the bridge tracks one global AC state (single AC unit assumed); firmware min-OFF timer is RAM only.

## Interlock layers (AC enable request)

Relay 32 only *requests* AC by energising a 24 V DC contactor coil. It is not a safety function.

| Layer | Where | Checks |
|---|---|---|
| 1 UI | `core/logic.js acInterlock` | controller online, fault, overload, phase fail, E-stop, unknown telemetry, 300 s minimum OFF-time |
| 2 Bridge | `server/gate.js gateCommand` | well-formed command; lighting relay 1-31; AC-ON blocked if no AC telemetry, any protection flag, or min OFF-time. Turning AC off is always allowed. UI checks are not trusted. |
| 3 Firmware | `anva_controller.ino onMsg` | rejects AC-ON on overload/phase-fail/E-stop/fault inputs or min OFF-time. All outputs OFF at boot. Input pins are **PLACEHOLDER-UNVERIFIED**. |
| 4 Hardware | outside this repo | Overload relay, phase-failure relay, E-stop, contactor wiring must be independent of software and cannot be reset from the app. Software layers 1-3 do not replace this. |

## Simulation vs live

| | Simulation (default) | Live |
|---|---|---|
| Selected by | `localStorage anva.mode = 'sim'` (default) | Settings (admin) -> Live hardware; `anva.mode='live'`, `anva.bridge` = bridge URL (default `ws://localhost:8787`) |
| Transport | `core/sim.js`, in-browser, generates relay state, meter and AC data with noise | `core/bridge.js`, WebSocket with exponential reconnect backoff (1 s to 30 s) |
| Meter | Fabricated values, `simulated: true`, labelled SIMULATED | `null` -> UI shows "Not connected" until a controller sends `meter` |
| Hardware needed | none | broker, bridge, flashed controllers |

`sim.js` exposes `window.__animSim.drop(id, true)` to simulate a controller going offline.

## Other behaviour

- Simulation schedules (`core/scheduler.js`) are evaluated in the browser every 20 s and only in sim mode. In live mode the bridge scheduler owns schedules (disabled/dry-run by default; see SCHEDULER.md).
- Live login is per-user against the bridge (scrypt, signed session token in sessionStorage). In simulation, `pages/Login.jsx` is a local role picker: not authentication and not secure.
- History (300 samples) and `energyToday` (integrates `kw` in the browser) are in memory and lost on reload; not billing grade.
- Water, fire, security, lift pages are placeholders (`FUTURE_MODULES` in `core/config.js`).
