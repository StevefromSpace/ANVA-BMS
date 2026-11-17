// Board config: ESP32-S3 N16R8 (16 MB flash, 8 MB OCTAL PSRAM). ALL VALUES ARE UNVERIFIED PLACEHOLDERS.
// These are deliberately NOT the DevKit V1 pins (21/22); the #if below stops a copy-paste of those.
#pragma once
#define BOARD_NAME "esp32-s3-n16r8"
#define I2C_SDA 8                  // UNVERIFIED PLACEHOLDER (a typical S3 default; confirm on your board)
#define I2C_SCL 9                  // UNVERIFIED PLACEHOLDER
#define MCP_ADDR_BASE 0x20         // UNVERIFIED PLACEHOLDER
#define PIN_AC_CONTACTOR_FB 8      // MCP chip 1 port B pin numbers (8-15), NOT ESP32 GPIOs. UNVERIFIED PLACEHOLDERS.
#define PIN_AC_OVERLOAD 9
#define PIN_AC_PHASEFAIL 10
#define PIN_AC_ESTOP 11
#define PIN_AC_FAULT 12
#if I2C_SDA == 21 || I2C_SCL == 22
#error "ESP32-S3 must not reuse the DevKit V1 I2C pins; choose and verify S3 pins."
#endif
// Items to verify against the ESP32-S3 / module datasheet before wiring:
//  - N16R8 uses OCTAL PSRAM + flash: GPIO26-37 are reserved on this module class (GPIO35/36/37 octal PSRAM; flash on 26-32). Do not use them.
//  - Strapping pins GPIO0, 3, 45, 46 (boot mode, JTAG source, VDD_SPI voltage, ROM log): avoid or verify safe at reset.
//  - GPIO19/20 are native USB D-/D+; avoid if USB serial/flashing is needed.
//  - Arduino IDE: select PSRAM "OPI PSRAM" and flash mode for N16R8, USB CDC setting; wrong settings can hang boot.
