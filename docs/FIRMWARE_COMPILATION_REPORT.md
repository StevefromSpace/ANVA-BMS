# Firmware compilation report

**Compilation was NOT performed.** `where arduino-cli` found nothing on PATH, and nothing was downloaded or installed. The firmware is therefore uncompiled and untested; treat every line as unverified.

## Static review checklist (manual, no compiler)

| Check | Result |
|---|---|
| Board selected via `BOARD`; unknown/missing BOARD hits `#error` | done by inspection |
| S3 header cannot reuse DevKit I2C pins (`#error`) | done by inspection |
| `AC_FEEDBACK_VERIFIED` defaults false; CA-cert TLS unchanged | yes |
| begin_I2C checked per chip; probe before telemetry and each write; readback; retries then latch | yes |
| Telemetry matches contract (`seq`, null relays, `health`, `ac.inputsValid`) | yes |
| Ack sent only after write+readback | yes |
| Protection inputs fault until 5 stable healthy reads; contactor unknown until read | yes |
| Local AC trip and comms-loss OFF independent of MQTT | yes |
| Items a compiler must confirm | ArduinoJson v7 calls `r.add(nullptr)`, `a["contactor"]=nullptr`, `m.add<JsonObject>()`; `Wire.requestFrom((uint16_t),(uint8_t),bool)` overload on both cores; `Wire.setTimeOut`; `#include "boards/..."` path resolution; aggregate assignment `chips[k] = {...}`; `Adafruit_MCP23X17` still needed (begin_I2C) |
| Assumption to verify on hardware | MCP23017 IOCON.BANK=0 register map after `begin_I2C()` |

## Commands to run (when arduino-cli, the esp32 core, and libraries Adafruit MCP23017, PubSubClient, ArduinoJson 7 are installed)

Copy `secrets.h.example` to `secrets.h` first (set the matching `BOARD`), then from `firmware/`:

```
arduino-cli compile --fqbn esp32:esp32:esp32 anva_controller
arduino-cli compile --fqbn esp32:esp32:esp32s3 anva_controller
```

For the S3 set `BOARD BOARD_ESP32S3_N16R8` in `secrets.h` (and likely PSRAM/flash options for N16R8, e.g. `--fqbn esp32:esp32:esp32s3:PSRAM=opi`, to be confirmed against the board). Record the results here.


## Update: compiled (2026-11-17)
Tool: arduino-cli 1.6.0, esp32:esp32 core 3.3.13, Adafruit MCP23017 2.3.2, PubSubClient 2.8, ArduinoJson 7.4.3. Config copied from `secrets.h.example` (placeholders only).
| Target | Config | Result |
|---|---|---|
| esp32:esp32:esp32 | BOARD_ESP32_DEVKIT_V1, esp32_01, relays 1-16, HAS_AC false | Compiled, 1029797 B flash (78%), 49344 B RAM (15%) |
| esp32:esp32:esp32s3 | BOARD_ESP32S3_N16R8, esp32_02, FIRST_RELAY 17, HAS_AC true | Compiled, 978494 B flash (74%), 48200 B RAM (14%) |
Compiling proves syntax and library API use only. It does not verify pins, I2C addresses, polarity, PSRAM/USB settings on the S3, or any runtime behaviour. The earlier "not performed" statement above is superseded by this table; the "Not verified" items remain open.
