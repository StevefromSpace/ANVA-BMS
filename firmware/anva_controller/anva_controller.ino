// ANVA BMS controller firmware (UNTESTED ON HARDWARE, NOT COMPILED: verify pins/polarity on the bench first).
// Libraries: Adafruit MCP23017, PubSubClient, ArduinoJson (v7), WiFiClientSecure.
#include <WiFi.h>
#include <time.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_MCP23X17.h>
#define BOARD_ESP32_DEVKIT_V1 1
#define BOARD_ESP32S3_N16R8 2
#include "secrets.h"
#ifndef BOARD
#error "Define BOARD in secrets.h (BOARD_ESP32_DEVKIT_V1 or BOARD_ESP32S3_N16R8)"
#endif
#if BOARD == BOARD_ESP32_DEVKIT_V1
#include "boards/board_esp32_devkit_v1.h"
#elif BOARD == BOARD_ESP32S3_N16R8
#include "boards/board_esp32s3_n16r8.h"
#else
#error "Unknown BOARD"
#endif
#ifndef AC_COMMS_LOSS_OFF_MS
#define AC_COMMS_LOSS_OFF_MS 600000UL   // owner policy; see secrets.h.example
#endif

#define BUILDING "building001"
#define RELAY_ACTIVE_LOW true      // check your relay module
// Set to true ONLY after the AC feedback inputs are wired and bench-verified (docs/COMMISSIONING.md). While false, AC enable is always refused.
#define AC_FEEDBACK_VERIFIED false
#define AC_MIN_OFF_MS 300000UL
// Input polarity (UNVERIFIED): inputs sit behind an opto/level stage, NC healthy contact, MCP pull-up enabled.
// Healthy loop closed -> opto conducts -> pin LOW. Open wire / lost field supply -> pin pulled HIGH -> FAULT.
#define PROT_HEALTHY_LEVEL LOW
#define CONTACTOR_ON_LEVEL LOW     // aux contact closed (via opto) = contactor energised; open is indistinguishable from a broken wire
#define INPUT_POLL_MS 100
#define INPUT_STABLE_READS 5       // consecutive healthy reads before an input may be called healthy (also after boot)
#define MCP_RETRIES 2              // extra attempts per operation
#define MCP_LATCH_FAILS 3          // consecutive failed cycles before the chip is latched failed until reboot
#define AC_RELAY 15                // local relay index of relay 32 on esp32_02: chip 1, port A bit 7

// MCP23017 registers (IOCON.BANK=0, the power-on default)
#define R_IODIRA 0x00
#define R_IODIRB 0x01
#define R_GPPUB 0x0D
#define R_GPIOA 0x12
#define R_GPIOB 0x13
#define R_OLATA 0x14

Adafruit_MCP23X17 mcp[2];          // used only for the begin_I2C() presence check; all I/O goes through checked raw I2C below
struct Chip { uint8_t addr; bool ok; uint8_t fails; bool latched; uint8_t phys; uint8_t olat; };
Chip chips[2];
const uint8_t OFF_MASK = RELAY_ACTIVE_LOW ? 0xFF : 0x00;
WiFiClientSecure net; PubSubClient mq(net);
unsigned long acOffSince = 0;      // set at boot: treat compressor as just stopped
unsigned long lastCommsOk = 0;
uint32_t seq = 0;
// Protection inputs. healthy[] is false (FAULT) until INPUT_STABLE_READS consecutive healthy reads.
const uint8_t PROT_PINS[4] = { PIN_AC_OVERLOAD, PIN_AC_PHASEFAIL, PIN_AC_ESTOP, PIN_AC_FAULT };
bool healthy[4]; uint8_t stableCnt[4];
bool inputsValid = false, contactorKnown = false, contactorOn = false;
String tTelemetry = String("anva/" BUILDING "/" CONTROLLER_ID "/telemetry");
String tStatus = String("anva/" BUILDING "/" CONTROLLER_ID "/status");
String tCmd = String("anva/" BUILDING "/" CONTROLLER_ID "/command");
String tAck = String("anva/" BUILDING "/" CONTROLLER_ID "/ack");

// ---- checked raw I2C ----
bool i2cProbe(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
bool regWrite(uint8_t a, uint8_t r, uint8_t v) { Wire.beginTransmission(a); Wire.write(r); Wire.write(v); return Wire.endTransmission() == 0; }
bool regRead(uint8_t a, uint8_t r, uint8_t& v) {
  Wire.beginTransmission(a); Wire.write(r);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint16_t)a, (uint8_t)1, true) != 1) return false;
  v = Wire.read(); return true;
}
uint8_t pullupMaskB() {
  uint8_t m = (1 << (PIN_AC_CONTACTOR_FB - 8));
  for (int k = 0; k < 4; k++) m |= (1 << (PROT_PINS[k] - 8));
  return m;
}

// ---- chip health: limited retries then latch ----
bool usable(int c) { return chips[c].ok && !chips[c].latched; }
void chipGood(int c) { if (!chips[c].latched) { chips[c].fails = 0; chips[c].ok = true; } }
void chipBad(int c) { chips[c].ok = false; if (++chips[c].fails >= MCP_LATCH_FAILS) chips[c].latched = true; }

// Latch all-OFF levels BEFORE making port A outputs so relays never glitch on; verify by readback.
bool chipInit(int c) {
  Chip& ch = chips[c]; uint8_t v;
  if (!regWrite(ch.addr, R_OLATA, OFF_MASK) || !regWrite(ch.addr, R_IODIRA, 0x00)) return false;
  if (c == 1 && (!regWrite(ch.addr, R_IODIRB, 0xFF) || !regWrite(ch.addr, R_GPPUB, pullupMaskB()))) return false;
  if (!regRead(ch.addr, R_IODIRA, v) || v != 0x00) return false;
  ch.olat = OFF_MASK; return regRead(ch.addr, R_GPIOA, ch.phys);
}

// Probe + config check (detects removal and power-cycle resets) + physical readback of the output port.
void refreshChip(int c) {
  Chip& ch = chips[c];
  if (ch.latched) return;
  for (int a = 0; a <= MCP_RETRIES; a++) {
    uint8_t dir;
    if (!i2cProbe(ch.addr)) continue;
    if (!ch.ok) { if (chipInit(c)) { chipGood(c); return; } continue; }   // recovered chip comes back all-OFF
    if (!regRead(ch.addr, R_IODIRA, dir) || dir != 0x00) { ch.ok = false; continue; }  // reset chip: re-init next attempt
    if (regRead(ch.addr, R_GPIOA, ch.phys)) { chipGood(c); return; }
  }
  chipBad(c);
}

// Drive one relay, confirm by readback of the physical port. Returns nullptr on success, else the ack error string.
const char* setRelay(int i, bool on) {
  int c = i / 8, b = i % 8; Chip& ch = chips[c];
  if (!usable(c)) return "mcp_unavailable";
  bool level = (on != RELAY_ACTIVE_LOW);
  uint8_t want = level ? (ch.olat | (1 << b)) : (ch.olat & ~(1 << b)), got;
  for (int a = 0; a <= MCP_RETRIES; a++) {
    if (!i2cProbe(ch.addr) || !regWrite(ch.addr, R_OLATA, want) || !regRead(ch.addr, R_GPIOA, got)) continue;
    ch.olat = want; ch.phys = got;
    if (got == want) { chipGood(c); return nullptr; }
  }
  chipBad(c);
  return usable(c) ? "readback_failed" : "mcp_unavailable";
}
bool acRequestOn() { return (((chips[1].olat >> 7) & 1) == 1) != RELAY_ACTIVE_LOW; }
// Best-effort local OFF for the AC request (attempted even if the chip is flagged failed).
void forceAcOff() {
  if (usable(1)) { setRelay(AC_RELAY, false); return; }
  chips[1].olat = RELAY_ACTIVE_LOW ? (chips[1].olat | 0x80) : (chips[1].olat & ~0x80);
  regWrite(chips[1].addr, R_OLATA, chips[1].olat);   // result unknown: reported via relays[]=null and inputsValid=false
}

// ---- inputs ----
bool protectionOk() { if (!inputsValid) return false; for (int k = 0; k < 4; k++) if (!healthy[k]) return false; return true; }
void invalidateInputs() { inputsValid = false; contactorKnown = false; for (int k = 0; k < 4; k++) { healthy[k] = false; stableCnt[k] = 0; } }
void pollInputs() {
  uint8_t v;
  if (!usable(1) || !i2cProbe(chips[1].addr) || !regRead(chips[1].addr, R_GPIOB, v)) { invalidateInputs(); return; }
  inputsValid = true;
  for (int k = 0; k < 4; k++) {
    bool h = (((v >> (PROT_PINS[k] - 8)) & 1) == (PROT_HEALTHY_LEVEL == HIGH));
    stableCnt[k] = h ? (stableCnt[k] < 255 ? stableCnt[k] + 1 : 255) : 0;   // any unhealthy read -> immediate fault
    healthy[k] = stableCnt[k] >= INPUT_STABLE_READS;
  }
  bool on = (((v >> (PIN_AC_CONTACTOR_FB - 8)) & 1) == (CONTACTOR_ON_LEVEL == HIGH));
  if (contactorKnown && contactorOn && !on) acOffSince = millis();
  contactorKnown = true; contactorOn = on;
}
bool acFeedbackTrusted() { return AC_FEEDBACK_VERIFIED && inputsValid && contactorKnown; }

void ack(const char* id, bool ok, const char* err) {
  JsonDocument d; d["id"] = id; d["ok"] = ok; if (err) d["error"] = err;
  String s; serializeJson(d, s); mq.publish(tAck.c_str(), s.c_str());
}

void publishTelemetry() {
  for (int c = 0; c < 2; c++) refreshChip(c);   // probe every cycle
  JsonDocument d; d["ts"] = millis(); d["seq"] = ++seq;   // seq is monotonic per boot; a reset signals a reboot
  JsonArray r = d["relays"].to<JsonArray>();
  for (int i = 0; i < 16; i++) {
    if (!usable(i / 8)) r.add(nullptr);   // never report a missing MCP as a state
    else r.add((((chips[i / 8].phys >> (i % 8)) & 1) == 1) != RELAY_ACTIVE_LOW);   // PHYSICAL readback, not last command
  }
  JsonObject h = d["health"].to<JsonObject>();
  h["i2c"] = (usable(0) && usable(1)) ? "ok" : "fail";
  JsonArray m = h["mcp"].to<JsonArray>();
  for (int c = 0; c < 2; c++) { JsonObject o = m.add<JsonObject>(); o["addr"] = chips[c].addr; o["ok"] = usable(c); }
  if (HAS_AC) {
    JsonObject a = d["ac"].to<JsonObject>();
    if (contactorKnown) a["contactor"] = contactorOn; else a["contactor"] = nullptr;
    a["overload"] = !(inputsValid && healthy[0]); a["phaseFail"] = !(inputsValid && healthy[1]);   // true = fault present
    a["estop"] = !(inputsValid && healthy[2]); a["fault"] = !(inputsValid && healthy[3]);
    a["inputsValid"] = inputsValid;
  }
  // No "meter" key: meter integration (Modbus) is awaiting hardware. Never send made-up values.
  String s; serializeJson(d, s); mq.publish(tTelemetry.c_str(), s.c_str());
}

void onMsg(char*, byte* p, unsigned int n) {
  JsonDocument d; if (deserializeJson(d, p, n)) return;
  const char* id = d["id"] | ""; const char* type = d["type"] | "";
  if (!id[0] || strlen(id) > 64) return;                                  // cannot ack without a usable id
  if (!d["on"].is<bool>()) return ack(id, false, "on must be boolean");
  bool on = d["on"]; const char* err;
  if (!strcmp(type, "relay")) {
    if (!d["relay"].is<int>()) return ack(id, false, "relay must be integer");
    int rl = d["relay"], i = rl - FIRST_RELAY;
    // Lighting relays are 1-31 only; relay 32 is the AC request and is reachable ONLY via type "ac".
    if (rl < 1 || rl > 31 || i < 0 || i > 15) return ack(id, false, "relay out of range");
    err = setRelay(i, on);   // ack only after write AND readback
  } else if (!strcmp(type, "ac")) {
    if (!HAS_AC) return ack(id, false, "no AC on this controller");
    if (!usable(1)) return ack(id, false, "mcp_unavailable");
    if (on) {                                     // local interlock: never trust the network
      if (!acFeedbackTrusted()) return ack(id, false, "AC feedback unverified");
      if (!protectionOk()) return ack(id, false, "AC protection active");
      if (millis() - acOffSince < AC_MIN_OFF_MS) return ack(id, false, "min OFF-time");
    }
    err = setRelay(AC_RELAY, on);
  } else return;
  ack(id, err == nullptr, err); publishTelemetry();
}

bool timeSynced() {
  static bool started = false;
  if (!started) { configTime(0, 0, "pool.ntp.org", "time.google.com"); started = true; }
  return time(nullptr) > 1700000000;               // NTP has set the clock
}

void connectAll() {
  if (WiFi.status() != WL_CONNECTED) { WiFi.begin(WIFI_SSID, WIFI_PASS); unsigned long t = millis(); while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) delay(250); }
  if (WiFi.status() == WL_CONNECTED && !mq.connected()) {
    // Last-will marks controller offline if power/Wi-Fi drops.
    if (strlen(BROKER_CA_CERT) < 100) return;      // fail closed: never connect without a CA cert
    if (!timeSynced()) return;                     // certificate validity needs real time
    if (mq.connect(CONTROLLER_ID, MQTT_USER, MQTT_PASS, tStatus.c_str(), 1, true, "{\"online\":false}")) {
      mq.publish(tStatus.c_str(), "{\"online\":true}", true); mq.subscribe(tCmd.c_str());
    }
  }
}

void setup() {
  Wire.begin(I2C_SDA, I2C_SCL); Wire.setTimeOut(50);
  for (int k = 0; k < 2; k++) {
    chips[k] = { (uint8_t)(MCP_ADDR_BASE + k), false, 0, false, 0, OFF_MASK };
    bool present = mcp[k].begin_I2C(chips[k].addr);   // checked per chip; a failure leaves ok=false, never operational
    if (present && chipInit(k)) chips[k].ok = true;   // otherwise refreshChip() retries, then latches
  }
  invalidateInputs();                              // FAULT until INPUT_STABLE_READS healthy reads; contactor unknown
  acOffSince = millis(); lastCommsOk = millis();
  net.setCACert(BROKER_CA_CERT);                  // CA verification; empty cert => connectAll() refuses to connect
  mq.setServer(MQTT_HOST, MQTT_PORT); mq.setCallback(onMsg); mq.setBufferSize(512);
}

void loop() {
  static unsigned long last = 0, lastPoll = 0;
  if (!mq.connected()) connectAll(); else lastCommsOk = millis();
  mq.loop();
  if (HAS_AC && millis() - lastPoll >= INPUT_POLL_MS) {
    lastPoll = millis(); pollInputs();
    // Local trip, independent of the network: protection fault or invalid inputs => AC request OFF.
    // Comms-loss policy (owner decision): AC request drops OFF after AC_COMMS_LOSS_OFF_MS; lighting is untouched.
    bool commsLost = AC_COMMS_LOSS_OFF_MS > 0 && millis() - lastCommsOk > AC_COMMS_LOSS_OFF_MS;
    if ((!protectionOk() || commsLost) && acRequestOn()) {
      forceAcOff();
      if (mq.connected()) publishTelemetry();      // report the trip immediately (relays[] and ac.* show it)
    }
  }
  if (millis() - last > 2000 && mq.connected()) { last = millis(); publishTelemetry(); }
}
