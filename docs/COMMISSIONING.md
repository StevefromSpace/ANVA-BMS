# Commissioning checklist (firmware controllers)

> Electrical work only by a qualified electrician. Nothing here is verified on hardware yet. Every pin, address and polarity is a placeholder until you record it below. See [HARDWARE_INTEGRATION.md](HARDWARE_INTEGRATION.md).

Record the controller (`esp32_01` / `esp32_02`), board, firmware build date and tester on the sign-off table at the end.

## 1. Bench, outputs disconnected
- [ ] No relay load wiring, no contactor coil, no mains. Field inputs on bench switches only.
- [ ] `secrets.h` created from the example; `BOARD`, `CONTROLLER_ID`, `FIRST_RELAY`, `HAS_AC` set for this controller; `AC_FEEDBACK_VERIFIED` is still `false`.
- [ ] Board header values (I2C pins, MCP addresses, input pins) compared with the real wiring and datasheets (N16R8: octal PSRAM/flash GPIOs, strapping pins); header edited and recorded.
- [ ] Compiled build from `docs/FIRMWARE_COMPILATION_REPORT.md` commands succeeds for this board.

## 2. I2C scan
- [ ] Stock I2C scanner shows both MCP23017 addresses; recorded: ____ , ____ . Firmware `MCP_ADDR_BASE` matches.
- [ ] Pull one MCP off the bus (or power it down): telemetry shows `health.i2c:'fail'`, that chip `ok:false`, its `relays[i]=null`, commands to it return ack error `mcp_unavailable`. After 3 failed cycles it stays failed until reboot.
- [ ] Reconnect, reboot: both chips `ok:true`, all relays OFF.

## 3. Relay mapping (de-energised)
- [ ] All relays OFF at power-up and after reset (check with LEDs/multimeter on module inputs; check 74HCT244 OE state at power-up).
- [ ] Toggle each channel via MQTT command; the intended relay clicks; map recorded; `RELAY_ACTIVE_LOW` confirmed.
- [ ] Telemetry `relays[]` matches the physical relay state (physical readback), ack arrives only after the change.
- [ ] Relay 32 cannot be driven by `type:"relay"` (only `type:"ac"`).

## 4. Fault inputs (esp32_02), bench switches
For each of overload, phase-fail, E-stop, fault (and contactor aux):
- [ ] Healthy (NC closed): after about 0.5 s the flag reads `false` (no fault), `inputsValid:true`. Right after boot it reads fault until the stable-read count is met.
- [ ] Open the loop (wire break / lost 24 V): flag becomes `true` (fault) immediately.
- [ ] Short the loop / bypass the contact: record the result. Expected with single-input hardware: reads healthy (NOT detected). Record whether the optional EOL/two-input hardware is fitted.
- [ ] Remove the opto/I2C connection to MCP chip 1: `inputsValid:false`, all protection flags fault, contactor `null`.
- [ ] Contactor aux closed/open reads on/off; open vs broken wire is indistinguishable (accepted limit).
- [ ] Electrician confirms opto series resistor, pull-up and polarity against the real supply range.

## 5. Interlock verification
- [ ] With `AC_FEEDBACK_VERIFIED=false`: AC-ON request is refused ("AC feedback unverified").
- [ ] Any protection input faulted: AC-ON refused ("AC protection active").
- [ ] Min OFF-time 300 s enforced from boot and after contactor drop ("min OFF-time").
- [ ] With the request relay ON (coil disconnected, LED/meter only): open any protection input; relay 32 goes OFF locally with the broker disconnected, and the trip is reported when the link is up.

## 6. AC_FEEDBACK_VERIFIED
- [ ] Only after sections 4 and 5 pass and are signed, set `AC_FEEDBACK_VERIFIED true`, rebuild, repeat section 5 AC-ON path with the coil still disconnected.

## 7. Comms-loss test
- [ ] Owner has decided `AC_COMMS_LOSS_OFF_MS` (policy, default 600000 ms, 0 = disabled): value ____ ms.
- [ ] Lighting relays ON, AC request ON; cut Wi-Fi/broker: lighting stays at last state; AC request drops OFF after the configured time (use a short test value, then restore the owner value).
- [ ] On reconnect telemetry shows true state; `seq` increases; ts/seq reset only on reboot.

## 8. Loads (electrician only)
- [ ] Connect loads one channel at a time, re-check telemetry versus reality at each step. Confirm independent hardware protection works with the ESP32 unpowered.

## Sign-off

| Item | Verified value / result | Tester | Date | Pass |
|---|---|---|---|---|
| MCP addresses | | | | |
| I2C pins | | | | |
| Relay map and polarity | | | | |
| Fault inputs open test | | | | |
| Fault inputs short test (limit recorded) | | | | |
| Interlocks | | | | |
| AC_FEEDBACK_VERIFIED set | | | | |
| Comms-loss policy and test | | | | |
| Electrician approval | | | | |
