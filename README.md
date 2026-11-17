# ANVA BMS

Building management app: 31 lighting groups (78 lamps) on relays 1-31, an AC contactor *request* on relay 32, electrical metering views, alarms, schedules and a rule-based assistant.

Three parts: `web/` (React + Vite UI), `server/` (Node MQTT-to-WebSocket bridge), `firmware/anva_controller` (ESP32 sketch for two controllers).

**Stack note:** the brief named Flutter, but no Flutter SDK was available, so the UI is a responsive web app. A Flutter port could reuse the contract in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

> **Safety:** the app only *requests* AC (relay 32 drives a 24 V DC contactor coil). Overload, phase-failure and E-stop protection must be independent hardware, not resettable from the app. Mains (400/415 V) work is for qualified electricians only. Bench test with outputs disconnected. See [docs/HARDWARE_INTEGRATION.md](docs/HARDWARE_INTEGRATION.md).

## Quick start (for anyone cloning this repo)

Needs Node.js 20+ (developed on 24) and npm. No hardware required: the app starts in **SIMULATION** mode.

```
git clone https://github.com/StevefromSpace/ANVA-BMS.git
cd ANVA-BMS/web
npm install
npm run dev        # open http://localhost:5173
```
Sign in with the local role picker (simulation only, **not authentication**). Everything shown is generated in the browser and labelled SIMULATED. Useful commands in `web/`: `npm test` (vitest), `npm run build`, `npx playwright install chromium && npx playwright test` (browser suite).

### What to do next, by goal
- **Just explore the UI:** the quick start above is enough.
- **Run the live bridge** (MQTT to WebSocket, needs an MQTT broker):
  ```
  cd server && npm install && npm test
  cp .env.example .env       # set MQTT_URL, SESSION_SECRET (32+ random bytes)
  node users-cli.js add <name> <viewer|operator|admin>   # prompts for the password
  node --env-file=.env bridge.js
  ```
  Then in the app: Settings (admin) -> Live hardware, bridge URL `ws://localhost:8787`, and sign in with your bridge user. Non-loopback binds require TLS (`TLS_CERT_FILE`/`TLS_KEY_FILE`); remote brokers require `mqtts://`. The server scheduler is off and dry-run by default ([docs/SCHEDULER.md](docs/SCHEDULER.md)). See [docs/SECURITY.md](docs/SECURITY.md).
- **Build/flash the firmware:** install arduino-cli, then
  ```
  arduino-cli core install esp32:esp32 --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
  arduino-cli lib install "Adafruit MCP23017 Arduino Library" PubSubClient ArduinoJson
  cd firmware && cp anva_controller/secrets.h.example anva_controller/secrets.h   # edit (git-ignored)
  arduino-cli compile --fqbn esp32:esp32:esp32 anva_controller      # DevKit V1
  arduino-cli compile --fqbn esp32:esp32:esp32s3 anva_controller    # ESP32-S3 (set BOARD in secrets.h)
  ```
  **Do not connect any load or flash a controller wired to a building** until you have completed [docs/COMMISSIONING.md](docs/COMMISSIONING.md). Pins, I2C addresses and polarity are unverified placeholders; compiling proves syntax only.
- **Commission hardware:** follow [docs/COMMISSIONING.md](docs/COMMISSIONING.md) (bench, outputs disconnected, first).

Release label: **ANVA BMS Hardware Commissioning Candidate**. It is not a production release and has not been verified on physical hardware.

## Status

| Area | Status |
|---|---|
| Dashboard, lighting, HVAC, meter/energy, alarms, scenes, assistant, controllers, settings | **Implemented**, driven by **simulation** by default |
| Relay state from telemetry only (confirmed/pending/unconfirmed/unknown); ack never = physical state | **Implemented**, unit + browser tested (simulated) |
| Bridge: per-user login, server-enforced roles, TLS fail-closed, command gate | **Implemented**, tested against a local aedes broker; **no real TLS/broker test yet** |
| Server scheduler (timezone, dedupe, restart recovery, dry-run) | **Implemented**, unit tested with a fake clock; off by default; not tested on hardware |
| ESP32 firmware (fail-safe inputs, MCP23017 checks, local AC trip, comms-loss AC off) | **Written**; compile status in [docs/FIRMWARE_COMPILATION_REPORT.md](docs/FIRMWARE_COMPILATION_REPORT.md); **untested on hardware** |
| Three-phase Modbus meter | **Awaiting hardware** (meter model/register map unknown) |
| Water, fire, security, lift | Placeholders, "Not connected" |
| Firebase Auth / Firestore / FCM, persistent history, INVT HMI | **Not implemented** ([docs/FIREBASE.md](docs/FIREBASE.md), [docs/ROADMAP.md](docs/ROADMAP.md)) |

## Docs
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, MQTT contract, command/ack flow, interlock layers, sim vs live
- [docs/HARDWARE_INTEGRATION.md](docs/HARDWARE_INTEGRATION.md): wiring guidance, placeholder pin table, bring-up, Modbus method, broker
- [docs/SECURITY.md](docs/SECURITY.md): security model
- [docs/COMMISSIONING.md](docs/COMMISSIONING.md): hardware commissioning checklist
- [docs/SCHEDULER.md](docs/SCHEDULER.md): server scheduler
- [docs/FIRMWARE_COMPILATION_REPORT.md](docs/FIRMWARE_COMPILATION_REPORT.md)
- [docs/FIREBASE.md](docs/FIREBASE.md): planned, not implemented
- [docs/ROADMAP.md](docs/ROADMAP.md): next phases
