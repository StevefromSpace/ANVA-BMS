// Board config: ESP32 DevKit V1 (38-pin). ALL VALUES ARE UNVERIFIED PLACEHOLDERS.
// Verify against the actual board silkscreen, the ESP32 datasheet and your wiring before connecting anything.
#pragma once
#define BOARD_NAME "esp32-devkit-v1"
#define I2C_SDA 21                 // UNVERIFIED PLACEHOLDER (common DevKit V1 default; confirm)
#define I2C_SCL 22                 // UNVERIFIED PLACEHOLDER
#define MCP_ADDR_BASE 0x20         // UNVERIFIED PLACEHOLDER: chip0=0x20, chip1=0x21 (set by A0-A2 straps)
// Input pin map (esp32_02 only; unused on a lighting-only DevKit). MCP chip 1 port B pin numbers 8-15. UNVERIFIED PLACEHOLDERS.
#define PIN_AC_CONTACTOR_FB 8      // contactor aux contact (NO): closed = contactor energised
#define PIN_AC_OVERLOAD 9          // NC healthy contact: closed = healthy
#define PIN_AC_PHASEFAIL 10        // NC healthy contact: closed = healthy
#define PIN_AC_ESTOP 11            // NC healthy contact: closed = healthy
#define PIN_AC_FAULT 12            // NC healthy contact: closed = healthy
// To verify: strapping pins (GPIO0, 2, 12, 15) and flash pins (GPIO6-11) are not used here; confirm your I2C pins avoid them.
