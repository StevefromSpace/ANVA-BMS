import { test as base, expect } from '@playwright/test';

const SHOTS = '../docs/screenshots';
const ROUTES = ['/', '/lighting', '/hvac', '/meter', '/energy', '/water', '/fire', '/security', '/lift', '/alarms', '/schedules', '/ai', '/controllers', '/reports', '/settings'];
const shotName = (r) => (r === '/' ? '-dashboard' : r.replace('/', '-'));

// Every test fails on any console error / pageerror.
const test = base.extend({
  errors: async ({ page }, use) => {
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await use(errors);
    // browser itself logs failed WebSocket handshakes (expected when no bridge is running)
    errors.splice(0, errors.length, ...errors.filter((e) => !/WebSocket connection to 'ws:\/\/localhost:59999/.test(e)));
    expect(errors, 'console/page errors').toEqual([]);
  },
});

async function login(page, role = 'admin') {
  await page.goto('/');
  await page.getByLabel('Role').selectOption(role);
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}
const go = (page, r) => page.goto(`/#${r}`);
const waitOnline = (page) => page.waitForFunction(() => window.__animSim && document.querySelector('.main') && !document.querySelector('.main').innerText.includes('OFFLINE'), null, { timeout: 8000 }).then(() => page.waitForTimeout(1200));
const sw = (page, name) => page.getByRole('switch', { name });

test('startup + dashboard', async ({ page, errors }) => {
  await login(page);
  await expect(page.locator('.chip.sim', { hasText: 'SIMULATION MODE' })).toBeVisible();
  await expect(page.getByText('Simulation mode: all readings are generated')).toBeVisible();
  await waitOnline(page);
  await expect(page.getByText('SIMULATED DATA').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
});

test('navigate every route', async ({ page, errors }) => {
  await login(page);
  for (const r of ROUTES) {
    await go(page, r);
    await expect(page.locator('.main')).not.toBeEmpty();
    await expect(page.locator('header h1')).not.toHaveText('ANVA BMS');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/route${shotName(r)}.png`, fullPage: true });
  }
});

test('mobile 390x844: no horizontal overflow on any route', async ({ page, errors }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const bad = [];
  for (const r of ROUTES) {
    await go(page, r);
    await page.waitForTimeout(400);
    const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, main: document.querySelector('.main').scrollWidth, mainC: document.querySelector('.main').clientWidth, w: innerWidth }));
    if (o.doc > o.w || o.body > o.w || o.main > o.mainC) bad.push(`${r}: ${JSON.stringify(o)}`);
    await page.screenshot({ path: `${SHOTS}/mobile${shotName(r)}.png` });
  }
  expect(bad).toEqual([]);
});

test('lighting: single toggle acks, bulk confirm, floor filter, relay numbering', async ({ page, errors }) => {
  await login(page);
  await go(page, '/lighting');
  await waitOnline(page);
  await expect(page.getByText(/^Relay \d+ ·/)).toHaveCount(31);
  await expect(page.getByText('Relay 1 · esp32_01')).toBeVisible();
  await expect(page.getByText('Relay 16 · esp32_01')).toBeVisible();
  await expect(page.getByText('Relay 17 · esp32_02')).toBeVisible();
  await expect(page.getByText('Relay 31 · esp32_02')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Relay 32/ })).toBeVisible();
  const s1 = sw(page, 'Lobby relay 1');
  await expect(s1).toHaveAttribute('aria-checked', 'false');
  await s1.click();
  await expect(s1).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
  await expect(page.getByText(/Pending confirmation/)).toHaveCount(0);
  await page.getByRole('button', { name: /^All ON/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(sw(page, 'Reception relay 2')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: /^All ON/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[role=switch][aria-checked=true]')).toHaveCount(31, { timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/lighting-all-on.png`, fullPage: true });
  await page.getByLabel('Floor filter').selectOption('Exterior');
  await expect(page.getByText(/^Relay \d+ ·/)).toHaveCount(4);
  await page.getByRole('button', { name: /^All OFF/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[role=switch][aria-checked=true]')).toHaveCount(0, { timeout: 8000 });
  await page.getByLabel('Floor filter').selectOption('All');
  await expect(page.locator('[role=switch][aria-checked=true]')).toHaveCount(27);
  await page.getByRole('button', { name: /^All OFF/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('[role=switch][aria-checked=true]')).toHaveCount(0, { timeout: 10000 });
});

test('stuck relay: controller acks but relay does not move => UNCONFIRMED, never shown ON', async ({ page, errors }) => {
  await login(page);
  await go(page, '/lighting');
  await waitOnline(page);
  await page.evaluate(() => window.__animSim.stick(1, true));
  const s1 = sw(page, 'Lobby relay 1');
  await s1.click();
  await expect(page.locator('[data-status=PENDING]')).toHaveCount(1);
  await expect(s1).toHaveAttribute('aria-checked', 'false');
  const card = page.locator('[data-status]').filter({ hasText: 'Relay 1 · esp32_01' });
  await expect(card).toHaveAttribute('data-status', 'UNCONFIRMED', { timeout: 9000 });
  await expect(card).toContainText('UNCONFIRMED: requested ON, controller reports OFF');
  await expect(s1).toHaveAttribute('aria-checked', 'false');
  await go(page, '/');
  await expect(page.getByText('Lighting ON (confirmed)').locator('..')).toContainText('0/31');
  await expect(page.getByTestId('lighting-unknown')).toContainText('1 unconfirmed');
  await page.screenshot({ path: `${SHOTS}/lighting-stuck-relay.png`, fullPage: true });
});

test('unreadable relay (null telemetry) => UNKNOWN, excluded from counts, assistant says unknown', async ({ page, errors }) => {
  await login(page);
  await go(page, '/lighting');
  await waitOnline(page);
  await page.evaluate(() => window.__animSim.unreadable(2, true));
  const card = page.locator('[data-status]').filter({ hasText: 'Relay 2 · esp32_01' });
  await expect(card).toHaveAttribute('data-status', 'UNKNOWN', { timeout: 4000 });
  await expect(card).toContainText('UNKNOWN');
  await go(page, '/');
  await expect(page.getByTestId('lighting-unknown')).toContainText('1 unknown', { timeout: 4000 });
  await go(page, '/ai');
  await page.getByRole('textbox').fill('how many lights are on');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/1 UNKNOWN/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/lighting-unknown.png`, fullPage: true });
});

test('controller offline/online: lights disabled, alarm raised, command rejected', async ({ page, errors }) => {
  await login(page);
  await go(page, '/lighting');
  await waitOnline(page);
  await page.evaluate(() => window.__animSim.drop('esp32_01', true));
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-disabled', 'true', { timeout: 5000 });
  await expect(page.getByText('OFFLINE').first()).toBeVisible();
  await sw(page, 'Lobby relay 1').click({ force: true });
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: /^All ON/ }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status')).toContainText('rejected');
  await page.screenshot({ path: `${SHOTS}/controller-offline.png`, fullPage: true });
  await go(page, '/alarms');
  await expect(page.getByText('Controller esp32_01 went offline').first()).toBeVisible();
  await page.evaluate(() => window.__animSim.drop('esp32_01', false));
  await go(page, '/lighting');
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-disabled', 'false', { timeout: 5000 });
  await sw(page, 'Lobby relay 1').click();
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-checked', 'true', { timeout: 3000 });
  await sw(page, 'Lobby relay 1').click();
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-checked', 'false', { timeout: 3000 });
});

test('AC interlock: enable ok, blocked offline and by each protection flag', async ({ page, errors }) => {
  await login(page);
  await go(page, '/hvac');
  await waitOnline(page);
  const enable = page.getByRole('button', { name: 'Enable request' });
  await expect(enable).toBeEnabled();
  await page.evaluate(() => window.__animSim.drop('esp32_02', true));
  await expect(enable).toBeDisabled({ timeout: 5000 });
  await expect(page.getByText('Controller ESP32-S3 is offline')).toBeVisible();
  await page.evaluate(() => window.__animSim.drop('esp32_02', false));
  await expect(enable).toBeEnabled({ timeout: 5000 });
  for (const [flag, text] of [['phaseFail', 'Phase failure'], ['overload', 'Overload trip active'], ['fault', 'AC fault active'], ['estop', 'Emergency stop engaged']]) {
    await page.evaluate((f) => window.__animSim.setAcFlags({ [f]: true }), flag);
    await expect(enable).toBeDisabled({ timeout: 3000 });
    await expect(page.getByText(text).first()).toBeVisible();
    await page.evaluate((f) => window.__animSim.setAcFlags({ [f]: false }), flag);
    await expect(enable).toBeEnabled({ timeout: 3000 });
  }
  await page.evaluate(() => window.__animSim.setAcFlags({ overload: true }));
  await expect(enable).toBeDisabled({ timeout: 3000 });
  await page.screenshot({ path: `${SHOTS}/hvac-interlock-blocked.png`, fullPage: true });
  await page.evaluate(() => window.__animSim.setAcFlags({ overload: false }));
  await expect(enable).toBeEnabled({ timeout: 3000 });
  await enable.click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Contactor feedback: Closed/)).toBeVisible({ timeout: 4000 });
  await page.getByRole('button', { name: 'Disable request' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/Contactor feedback: Open/)).toBeVisible({ timeout: 4000 });
  await expect(enable).toBeDisabled({ timeout: 4000 });
  await expect(page.getByText(/Compressor minimum OFF-time/).first()).toBeVisible();
});

test('meter page labelled SIMULATED', async ({ page, errors }) => {
  await login(page);
  await go(page, '/meter');
  await expect(page.getByText('SIMULATED DATA').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: `${SHOTS}/meter.png`, fullPage: true });
});

test('every page showing meter values carries a SIM label', async ({ page, errors }) => {
  await login(page);
  const missing = [];
  for (const r of ['/', '/hvac', '/meter', '/energy']) {
    await go(page, r);
    await page.waitForTimeout(1500);
    const t = await page.locator('.main').innerText();
    if (!/SIM/i.test(t)) missing.push(r);
  }
  expect(missing, 'pages with numbers but no SIM label').toEqual([]);
});

test('alarms acknowledge', async ({ page, errors }) => {
  await login(page);
  await go(page, '/hvac');
  await waitOnline(page);
  await page.evaluate(() => window.__animSim.drop('esp32_01', true));
  await page.waitForTimeout(1500);
  await go(page, '/alarms');
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
  await expect(page.getByText('acknowledged').first()).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge all' }).click();
  await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /🔔 0/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/alarms-acked.png`, fullPage: true });
});

test('viewer cannot operate', async ({ page, errors }) => {
  await login(page, 'viewer');
  await go(page, '/lighting');
  await waitOnline(page);
  await expect(page.getByText('Viewer role: controls are read-only.')).toBeVisible();
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-disabled', 'true');
  await sw(page, 'Lobby relay 1').click({ force: true });
  await expect(sw(page, 'Lobby relay 1')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: /^All ON/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /^All OFF/ })).toBeDisabled();
  await go(page, '/hvac');
  await expect(page.getByRole('button', { name: 'Enable request' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Disable request' })).toBeDisabled();
  await go(page, '/settings');
  await expect(page.getByRole('button', { name: 'Live hardware' })).toBeDisabled();
});

test('settings: live without bridge shows Not connected, then back to sim', async ({ page, errors }) => {
  await login(page);
  await go(page, '/settings');
  await page.getByLabel('Bridge WebSocket URL').fill('ws://localhost:59999');
  await page.getByRole('button', { name: 'Live hardware' }).click();
  await expect(page.getByText('LIVE · bridge')).toBeVisible();
  await page.waitForTimeout(1500);
  await go(page, '/meter');
  await expect(page.getByText('No meter connected')).toBeVisible();
  await expect(page.getByText('SIMULATED DATA')).toHaveCount(0);
  await expect(page.getByText('Not connected').first()).toBeVisible();
  await go(page, '/hvac');
  await expect(page.getByText('Not connected').first()).toBeVisible();
  await go(page, '/');
  await expect(page.getByText('Simulation mode: all readings')).toHaveCount(0);
  await expect(page.getByText('2/2')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/settings-live-no-bridge.png`, fullPage: true });
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Simulation', exact: true }).click();
  await expect(page.locator('.chip.sim', { hasText: 'SIMULATION MODE' })).toBeVisible();
  await go(page, '/meter');
  await expect(page.getByText('SIMULATED DATA').first()).toBeVisible({ timeout: 5000 });
});
