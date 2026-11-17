# Hardware Integration

> **WARNING: electrical safety.** The installation involves 400/415 V three-phase mains and a 24 V DC contactor coil. Mains work must be done by a qualified electrician under local regulations. This document is a software integration guide, not an electrical design or certification.
> - Overload, phase-failure and E-stop protection must be **independent hardware** that works with the ESP32 unpowered and cannot be reset from the app.
> - Relay 32 only *requests* AC by driving a 24 V DC contactor coil; it is not a protective function.
> - **Bench test first with all outputs disconnected** (no relay load wiring, no contactor coil connected). Verify behaviour with LEDs or a multimeter before connecting any load.
> - Never invent values: if a signal or meter is not connected, software shows "Not connected".

## Verification status

**No pin, I2C address or wiring below has been verified on physical hardware.** Every GPIO, I2C and MCP23017 value in this repo is marked **PLACEHOLDER-UNVERIFIED**. Do not wire from these tables without confirming them against your boards and modules. Record verified values in a new column once checked.

## Boards and roles (from `web/src/core/config.js`)

| Controller | Board | Relays | Notes |
|---|---|---|---|
| `esp32_01` | ESP32 DevKit V1 (38-pin) | 1-16 | lighting only |
| `esp32_02` | ESP32-S3 N16R8 | 17-32 | lighting 17-31, relay 32 = AC contactor request, AC feedback inputs |

Each controller: 2x MCP23017 (I2C) + 74HCT244 buffering to relay modules. Four 8-channel relay modules in total (relays 1-8, 9-16, 17-24, 25-32).

## Pin / address table (PLACEHOLDER-UNVERIFIED)

Values taken from `firmware/anva_controller/anva_controller.ino` as placeholders:

| Item | Firmware value | Status |
|---|---|---|
| I2C SDA | GPIO 21 | PLACEHOLDER-UNVERIFIED (firmware comment: "ESP32-S3: pick your own pins"; 21/22 are the DevKit V1 defaults, not S3) |
| I2C SCL | GPIO 22 | PLACEHOLDER-UNVERIFIED |
| MCP23017 #0 | address 0x20, port A (pins 0-7) outputs -> relays 0-7 of controller | PLACEHOLDER-UNVERIFIED |
| MCP23017 #1 | address 0x21, port A outputs -> relays 8-15; port B (pins 8-15) inputs | PLACEHOLDER-UNVERIFIED |
| AC contactor feedback | MCP #1 pin 8 | PLACEHOLDER-UNVERIFIED |
| AC overload | MCP #1 pin 9 | PLACEHOLDER-UNVERIFIED |
| AC phase fail | MCP #1 pin 10 | PLACEHOLDER-UNVERIFIED |
| AC E-stop | MCP #1 pin 11 | PLACEHOLDER-UNVERIFIED |
| AC fault | MCP #1 pin 12 | PLACEHOLDER-UNVERIFIED |
| Relay polarity | `RELAY_ACTIVE_LOW true` | PLACEHOLDER-UNVERIFIED (check the module: opto-isolated modules differ) |
| Input polarity | NC healthy contact, opto output + MCP pull-up: healthy = pin LOW, anything else = FAULT | PLACEHOLDER-UNVERIFIED (electrician to confirm; see "Fail-safe protection inputs") |

Pins, addresses and polarity now live in per-board headers selected by `#define BOARD` in `secrets.h`: `firmware/anva_controller/boards/board_esp32_devkit_v1.h` and `board_esp32s3_n16r8.h`. Every value in them is an UNVERIFIED PLACEHOLDER. The S3 header deliberately uses different I2C pins from the DevKit (a `#error` blocks reuse of 21/22). For the N16R8 module, verify against the datasheet: octal PSRAM/flash reserve GPIO26-37 on this module class, strapping pins (GPIO0, 3, 45, 46), USB pins (19/20), and the Arduino PSRAM/flash menu settings.

## Fail-safe protection inputs

Design rule: **HEALTHY = closed circuit; FAULT = not healthy.** Overload, phase-fail, E-stop and fault each use a normally-closed healthy contact, so an open wire, blown fuse or lost field supply reads as FAULT. (Previously an active-high "fault present" input read a broken wire as healthy.)

Electrical arrangement (a method, not verified values; **verify with the electrician**):
- 24 V-class field signals must not touch the MCP23017 (3.3/5 V logic). Use one opto-isolator channel per signal: field 24 V -> NC contact -> series resistor -> opto LED -> field 0 V. Add reverse-polarity protection and, if the loop can see AC or inductive kick, whatever the opto datasheet requires.
- Series resistor method: R = (V_supply_min - V_F) / I_F, with I_F chosen from the opto datasheet so the LED current is enough at the lowest supply and CTR ageing, and R power rating checked at the highest supply. Do not copy a value from this repo.
- Opto output (transistor) pulls the MCP pin to GND when the loop is healthy. The MCP pin needs a pull-up so a de-energised loop reads HIGH: the firmware enables the MCP23017 internal pull-up (GPPU, nominally ~100 kOhm) on the input pins; if noise or opto leakage is a problem use a stronger external pull-up sized from the opto dark-current and the MCP input-leakage/V_IH datasheet figures. Pull-ups are enabled only on the five port-B input pins, never on outputs.
- Polarity in firmware: `PROT_HEALTHY_LEVEL LOW`. NC contact closed + opto conducting = LOW = healthy; open = HIGH = FAULT. Contactor feedback (`CONTACTOR_ON_LEVEL LOW`): NO aux contact closed = contactor on; open is indistinguishable from a broken wire.

Detection limits (single input per signal, what the firmware implements):
- Open circuit / wire break / lost supply: detected as FAULT.
- Short circuit across the contact (contact bypassed or wires shorted): reads HEALTHY. **Not detectable** with one input.
- A stuck or welded contact, or a protective relay that has failed internally, is not detectable by software.
- Optional hardware change (not implemented in firmware): an end-of-line resistor in the loop with two sensed levels, or a two-input scheme (NC and NO contacts on separate inputs, valid only when they disagree), distinguishes open from short. This needs extra opto channels/inputs and a firmware change; decide with the electrician.

Input initialisation: all protection inputs are FAULT after boot until `INPUT_STABLE_READS` (5) consecutive healthy reads at `INPUT_POLL_MS` (100 ms); any unhealthy read faults immediately. Contactor feedback is `null` (unknown) until the first successful read. If any input read or the I2C bus fails, `ac.inputsValid=false`, all protection flags report fault and feedback is unknown.

Protection trip and comms loss:
- The AC request relay (relay 32) is forced OFF locally within one poll when any protection input faults or inputs are invalid, independent of Wi-Fi/MQTT, and reported in telemetry (`relays[15]`, `ac.*`). AC-ON is refused while protection is active. This is a software request, not protection; the hardware protection chain remains independent.
- On Wi-Fi/MQTT loss lighting keeps its last state. The AC request drops OFF after `AC_COMMS_LOSS_OFF_MS` (default 600000 ms, `0` disables). **This duration is an owner policy decision**, not an engineering default; the owner must confirm it.

## MCP23017 reliability

- `begin_I2C()` is checked per chip; a missing chip is never operational. Before every telemetry cycle and every write the chip is probed (`beginTransmission/endTransmission`); its direction register is checked (detects a power-cycled/replaced chip); writes are confirmed by reading the physical port back.
- Up to 2 retries per operation; 3 consecutive failed cycles latch the chip as failed until reboot. A chip that recovers before latching is re-initialised with all relays OFF.
- Commands for a failed chip are refused with ack error `mcp_unavailable`; telemetry shows `relays[i]=null` for that chip's relays and `health.i2c:'fail'`, `health.mcp[].ok=false`. `ac.inputsValid=false` if chip 1 fails.
- Limitation: if an MCP loses power or latches failed while a relay is ON, the relay's real state then depends on the 74HCT244 OE/pull network (unverified here). The firmware cannot switch it off through a dead bus; use hardware design (default-OFF pulls) and report the state as unknown.

Telemetry contract: `{ts, seq, relays:[16 x bool|null], health:{i2c:'ok'|'fail', mcp:[{addr,ok}]}, ac?:{contactor:bool|null, overload, phaseFail, estop, fault, inputsValid}}` where `relays` is the physical readback (not the last command), `true` in `overload/phaseFail/estop/fault` means fault present, and `seq` is monotonic per boot (a reset indicates a reboot). Ack `{id, ok, error?}` is sent only after write and readback and means "executed by the controller"; state truth comes from telemetry.

## Bring-up procedure

1. **Power and logic only.** Power the ESP32 from USB, MCP23017s and 74HCT244s from the logic supply. No relay module load side, no coil, no mains.
2. **I2C scan.** Run a stock I2C scanner sketch; confirm both MCP23017 addresses (set via A0-A2 pins) and record them. Update firmware if different.
3. **Outputs.** With the relay modules' coil side powered per their datasheet but nothing on the contacts, toggle each channel and confirm which relay clicks. Confirm polarity (`RELAY_ACTIVE_LOW`) and that all relays are OFF at boot and after reset.
4. **74HCT244.** The 74HCT244 shifts 3.3 V MCP outputs to 5 V relay-module inputs and its outputs are enabled/disabled by its OE pins. Confirm the OE state at power-up so relays do not pulse on boot. Verify against your wiring; the repo does not define it.
5. **Inputs (esp32_02).** Inject each feedback signal with a bench switch, confirm it reads as expected and that the software shows the alarm.
6. **MQTT.** Configure `secrets.h`, watch `anva/building001/<id>/status` and `telemetry` with an MQTT client, publish a command and observe the ack.
7. **Only then** connect loads, one channel at a time, by a qualified electrician.

## AC contactor request (relay 32, esp32_02)

- Relay 32 drives the **24 V DC contactor coil** through the relay module; the AC power circuit is separate and protected by hardware (overload, phase-failure relay, E-stop).
- Feedback to the controller: contactor auxiliary contact, overload, phase-fail, E-stop, fault. Inputs must be isolated or level-conditioned for the MCP23017 (the 24 V control signals cannot go directly to 3.3 V inputs). Interface circuit is not defined in this repo.
- Software enforces a 300 s minimum OFF-time and blocks AC-ON on protection flags (see [ARCHITECTURE](ARCHITECTURE.md)). This does not replace hardware protection.

## Three-phase Modbus meter

Meter model: **NOT YET IDENTIFIED**. Firmware has no Modbus code; it sends no `meter` object. The UI shows "Not connected" in live mode.

Register map: **PENDING**. Method to fill it (do not guess registers):
1. Identify the exact model and firmware revision from the nameplate; obtain the manufacturer's Modbus map document.
2. Record: interface (RS-485 RTU or Modbus TCP), slave ID, baud/parity/stop bits, function code, register addresses, data types (float32/int32/int16), word and byte order, scaling factors and units.
3. Verify with a PC Modbus tool (USB-RS485 adapter) and compare against the meter's own display for voltage, current, frequency, power and energy.
4. Fill the table below with only verified values.

Target telemetry fields (from the contract): `vr vy vb` (V), `ir iy ib` (A), `hz`, `pf`, `kw`, `kva`, `kvar`, `kwh`.

| Field | Register | Type | Scale | Unit | Verified |
|---|---|---|---|---|---|
| vr, vy, vb | PENDING | PENDING | PENDING | V | no |
| ir, iy, ib | PENDING | PENDING | PENDING | A | no |
| hz | PENDING | PENDING | PENDING | Hz | no |
| pf | PENDING | PENDING | PENDING | | no |
| kw, kva, kvar | PENDING | PENDING | PENDING | kW/kVA/kvar | no |
| kwh | PENDING | PENDING | PENDING | kWh | no |

Electrical notes: RS-485 needs a transceiver (e.g. MAX485-class) with 3.3 V compatibility, A/B polarity, termination and a free UART on the host controller; CT/VT wiring is the electrician's job. Treat a failed read as "no data", not zero.

## MQTT broker

- Any MQTT broker reachable from the controllers and the bridge. The bridge takes `MQTT_URL` (e.g. `mqtts://host:8883`), `MQTT_USER`, `MQTT_PASS` from its environment; the firmware takes `MQTT_HOST/PORT/USER/PASS` from `secrets.h`.
- Use TLS and per-client credentials. Firmware validates the broker with `BROKER_CA_CERT` (no `setInsecure()`), see [SECURITY.md](SECURITY.md).
- Suggested ACLs (not enforced by this repo): each controller publishes only to its own `anva/<b>/<id>/{telemetry,status,ack}` and subscribes to its own `command`; the bridge subscribes `anva/<b>/+/+` and publishes `command`.
- The controllers retain `status` with a last-will; telemetry and commands are not retained.

## Flashing

See [README](../README.md#firmware). Arduino libraries used by the sketch: Adafruit MCP23017 (Adafruit_MCP23X17), PubSubClient, ArduinoJson v7, WiFi/WiFiClientSecure (ESP32 core). Board selection and S3 specifics (USB mode, PSRAM setting for N16R8) are not verified by this repo.
