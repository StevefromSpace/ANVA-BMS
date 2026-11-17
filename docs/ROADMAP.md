# Roadmap

Proposed and unscheduled; none of it is implemented. Order reflects dependency and safety, not dates. Current status is in the [README](../README.md).

## Phase 0: Bench validation of what is already written
- Run the bridge and a broker locally; confirm the topic/JSON contract end to end with a real ESP32.
- Verify I2C pins, MCP23017 addresses, relay polarity (`RELAY_ACTIVE_LOW`) and 74HCT244 wiring on the bench with **outputs disconnected** (see [HARDWARE_INTEGRATION](HARDWARE_INTEGRATION.md)).
- Replace `net.setInsecure()` with CA-cert TLS (being done separately; see [SECURITY.md](SECURITY.md)).
- Confirm all outputs stay OFF through boot, reset and brown-out.

## Phase 1: Real meter
- Identify the three-phase meter model and its Modbus settings and register map.
- Add an RS-485 transceiver to the controller hosting the meter, implement polling in firmware, send the existing `meter` telemetry object only with real values.
- Handle stale/failed reads (timeout, exception, CRC) as "Not connected", never zero.
- Move energy accounting off the browser (read the meter's energy register or integrate server-side).

## Phase 2: AC feedback and interlock verification
- Wire and verify contactor auxiliary contact, overload, phase-fail and E-stop feedback inputs (signal levels, isolation).
- Persist the min-OFF timer across reboot (currently RAM only in firmware).

## Phase 3: Unattended schedules
Today schedules run only while a browser tab is open.
- Option A: run them in the bridge (server clock, persisted store, same `gateCommand`).
- Option B: store them on the ESP32 (needs NTP, local persistence, defined offline behaviour).
- Define conflicts with manual overrides; audit every automated action.

## Phase 4: Firebase
Auth, Firestore persistence, FCM alarms. See [FIREBASE.md](FIREBASE.md).

## Phase 5: INVT VS-070QE HMI
Local panel for operators without the web app. Not designed. Open items: confirm the HMI's supported protocols from its manual, decide whether it talks to the ESP32 or the bridge, and ensure it cannot override hardware protections.

## Phase 6: Optional modules
Water, fire (monitoring only via a certified panel interface), security, lift (read-only). Currently "Not connected" placeholders.

## Option: Flutter port
The original brief named Flutter; a web app was built because no Flutter SDK was available. A Flutter client can reuse the contract in [ARCHITECTURE](ARCHITECTURE.md). Port after the contract and bridge are hardware-validated. Logic to port: `acInterlock`, `validateCommand`, command/ack handling.
