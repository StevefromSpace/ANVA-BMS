// Static building configuration. Hardware facts come from the project brief.
export const BUILDING_ID = 'building001';
export const LAMP_WATTS = 100;
export const TARIFF_PER_KWH = 8; // currency units; editable in Settings
export const AC_RELAY = 32;
export const AC_MIN_OFF_SECONDS = 300;
export const CONFIRM_WINDOW_MS = 5000; // telemetry must match the request within this long after the command
export const TELEMETRY_STALE_MS = 15000;

export const CONTROLLERS = [
  { id: 'esp32_01', name: 'ESP32 DevKit V1', board: 'ESP32 DevKit V1 (38-pin)', relays: [1, 16], expanders: 'MCP23017 ×2 + 74HCT244' },
  { id: 'esp32_02', name: 'ESP32-S3', board: 'ESP32-S3 N16R8', relays: [17, 32], expanders: 'MCP23017 ×2 + 74HCT244' },
];

export const topic = (controller, kind) => `anva/${BUILDING_ID}/${controller}/${kind}`;

export const controllerOfRelay = (n) => (n <= 16 ? 'esp32_01' : 'esp32_02');

const ZONES = [
  ['Ground', 'Lobby'], ['Ground', 'Reception'], ['Ground', 'Corridor A'], ['Ground', 'Corridor B'],
  ['Ground', 'Parking'], ['Ground', 'Stairwell'], ['Ground', 'Cafeteria'], ['Ground', 'Washrooms'],
  ['First', 'Open Office 1'], ['First', 'Open Office 2'], ['First', 'Conference Room'], ['First', 'Manager Cabin'],
  ['First', 'Corridor'], ['First', 'Pantry'], ['First', 'Server Room'], ['First', 'Washrooms'],
  ['Second', 'Open Office 1'], ['Second', 'Open Office 2'], ['Second', 'Training Room'], ['Second', 'Meeting Room'],
  ['Second', 'Corridor'], ['Second', 'Pantry'], ['Second', 'Storage'], ['Second', 'Washrooms'],
  ['Terrace', 'Staircase Head'], ['Terrace', 'Walkway'], ['Terrace', 'Plant Area'],
  ['Exterior', 'Facade'], ['Exterior', 'Boundary'], ['Exterior', 'Signage'], ['Exterior', 'Gate'],
];

// 31 lighting groups (relays 1-31): 16 groups x 3 lamps + 15 groups x 2 lamps = 78 lamps.
export const LIGHT_GROUPS = ZONES.map(([floor, room], i) => ({
  relay: i + 1,
  name: `${room}`,
  floor,
  room,
  controller: controllerOfRelay(i + 1),
  lamps: i < 16 ? 3 : 2,
  ratedWatts: (i < 16 ? 3 : 2) * LAMP_WATTS,
}));

export const FLOORS = [...new Set(LIGHT_GROUPS.map((g) => g.floor))];

export const totalLamps = () => LIGHT_GROUPS.reduce((s, g) => s + g.lamps, 0);

// Optional future modules: no hardware connected yet.
export const FUTURE_MODULES = {
  water: { title: 'Water Management', items: ['Tank levels', 'Pump operation', 'Leak detection', 'Pump fault status'] },
  fire: { title: 'Fire & Emergency', items: ['Certified fire panel status', 'Alarm events', 'Emergency notifications'], note: 'Monitoring only, via a certified fire panel interface. ANVA never controls fire systems.' },
  security: { title: 'Security', items: ['Door contacts', 'Motion detection', 'Security events'] },
  lift: { title: 'Lift Monitoring', items: ['Lift status', 'Fault indication', 'Emergency status'], note: 'Read-only through an approved manufacturer interface.' },
};
