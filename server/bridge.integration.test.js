// End-to-end: real aedes broker + real bridge + real ws client + simulated controller (an MQTT client).
// This does NOT touch any hardware.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Aedes } from 'aedes';
import mqtt from 'mqtt';
import WebSocket from 'ws';
import { createBridge } from './bridge.js';
import { hashPassword } from './auth.js';

const SECRET = 'test-secret-0123456789-0123456789-xx';
const PW = 'pw-0123456789';
const mkUser = (username, role) => ({ username, role, ...hashPassword(PW) });
const USERS = [mkUser('op', 'operator'), mkUser('view', 'viewer'), mkUser('adm', 'admin'), mkUser('victim', 'viewer')];
const B = 'building001';
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const until = async (fn, ms = 3000) => { const t = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };

let broker, server, brokerPort, bridge, ctl, cmds;
const pub = (ctrl, kind, p, retain = false) => ctl.publishAsync(`anva/${B}/${ctrl}/${kind}`, JSON.stringify(p), { retain });

async function client({ user = 'op', password = PW, token, origin } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}`, { origin });
  ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', () => rej(new Error('rejected'))); });
  if (token !== undefined) ws.send(JSON.stringify({ type: 'auth', token }));
  else if (user !== null) ws.send(JSON.stringify({ type: 'login', username: user, password }));
  return ws;
}
const find = (ws, f) => until(() => ws.msgs.find(f));

before(async () => {
  broker = await Aedes.createBroker();
  server = net.createServer(broker.handle);
  brokerPort = await listen(server);
  bridge = createBridge({ mqttUrl: `mqtt://127.0.0.1:${brokerPort}`, port: 0, users: USERS, sessionSecret: SECRET, log: () => {}, lockout: { maxFails: 3, lockMs: 60000 }, commandTimeoutMs: 400, rateMax: 5, mqttOptions: { reconnectPeriod: 200 } });
  await bridge.ready;
  ctl = await mqtt.connectAsync(`mqtt://127.0.0.1:${brokerPort}`);
  cmds = [];
  ctl.on('message', (t, b) => cmds.push({ t, p: JSON.parse(b.toString()) }));
  await ctl.subscribeAsync(`anva/${B}/+/command`);
  await until(() => bridge.mq.connected);
});
after(async () => { ctl?.end(true); await bridge?.close(); broker?.close(); server?.close(); });

test('requires login: wrong password rejected, unauthenticated command rejected', async () => {
  const bad = await client({ user: 'op', password: 'nope' });
  assert.equal(await new Promise((r) => bad.once('close', (c) => r(c))), 1008);
  assert.equal(bad.msgs.find((m) => m.type === 'auth').ok, false);
  const none = await client({ user: null });
  none.send(JSON.stringify({ type: 'command', payload: { id: 'x', type: 'relay', relay: 1, on: true } }));
  assert.equal(await new Promise((r) => none.once('close', r)), 1008);
  assert.equal(cmds.length, 0);
});

test('login returns server-assigned role + token; token resumes once (rotated)', async () => {
  const ws = await client({ user: 'adm' });
  const a = await find(ws, (m) => m.type === 'auth' && m.ok);
  assert.equal(a.role, 'admin'); assert.ok(a.token); ws.close();
  const r1 = await client({ user: null, token: a.token });
  assert.equal((await find(r1, (m) => m.type === 'auth')).role, 'admin'); r1.close();
  const r2 = await client({ user: null, token: a.token });                  // replay of rotated token
  assert.equal((await find(r2, (m) => m.type === 'auth')).ok, false);
  const r3 = await client({ user: null, token: a.token.slice(0, -2) + 'xx' });
  assert.equal((await find(r3, (m) => m.type === 'auth')).ok, false);
});

test('createBridge refuses to start without SESSION_SECRET; anon is viewer-only', async () => {
  assert.throws(() => createBridge({ mqttUrl: 'mqtt://127.0.0.1:1', port: 0 }), /SESSION_SECRET/);
  const b = createBridge({ mqttUrl: 'mqtt://127.0.0.1:1', port: 0, sessionSecret: SECRET, allowAnon: true, users: [], log: () => {} });
  await b.ready;
  const ws = new WebSocket(`ws://127.0.0.1:${b.port}`); ws.msgs = []; ws.on('message', (d) => ws.msgs.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r)); ws.send(JSON.stringify({ type: 'auth' }));
  assert.equal((await find(ws, (m) => m.type === 'auth')).role, 'viewer');
  ws.close(); await b.close();
});

test('roles enforced server-side: viewer cannot command, operator cannot edit schedules, admin can', async () => {
  const v = await client({ user: 'view' }); await find(v, (m) => m.type === 'auth' && m.ok);
  const n = cmds.length;
  v.send(JSON.stringify({ type: 'command', role: 'admin', payload: { id: 'v1', type: 'relay', relay: 1, on: true } }));
  assert.match((await find(v, (m) => m.payload?.id === 'v1')).payload.error, /Forbidden/);
  v.send(JSON.stringify({ type: 'schedule_create', schedule: { name: 'x', time: '08:00', days: [1], relays: [1], on: true } }));
  assert.equal((await find(v, (m) => m.type === 'schedule_ack')).ok, false);
  const o = await client({ user: 'op' }); await find(o, (m) => m.type === 'auth' && m.ok);
  o.send(JSON.stringify({ type: 'schedule_create', schedule: { name: 'x', time: '08:00', days: [1], relays: [1], on: true } }));
  assert.match((await find(o, (m) => m.type === 'schedule_ack')).error, /admin/);
  const a = await client({ user: 'adm' }); await find(a, (m) => m.type === 'auth' && m.ok);
  a.send(JSON.stringify({ type: 'schedule_create', schedule: { name: 'x', time: '08:00', days: [1], relays: [1], on: true } }));
  const ack = await find(a, (m) => m.type === 'schedule_ack'); assert.equal(ack.ok, true);
  a.send(JSON.stringify({ type: 'schedule_delete', id: ack.schedule.id }));
  await until(() => a.msgs.filter((m) => m.type === 'schedule_ack').length === 2);
  assert.equal(cmds.length, n); v.close(); o.close(); a.close();
});

test('login lockout after repeated failures (even with correct password afterwards)', async () => {
  for (let i = 0; i < 3; i++) { const w = await client({ user: 'victim', password: 'bad' }); await new Promise((r) => w.once('close', r)); }
  const w = await client({ user: 'victim' });
  const a = await find(w, (m) => m.type === 'auth');
  assert.equal(a.ok, false); assert.match(a.error, /Too many/);
});

test('origin allowlist blocks foreign browser origins', async () => {
  await assert.rejects(client({ origin: 'http://evil.example' }));
  const ok = await client({ origin: 'http://localhost:5173' });
  await find(ok, (m) => m.type === 'auth' && m.ok); ok.close();
});

test('commands rejected while controller offline / unknown', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  ws.send(JSON.stringify({ type: 'command', payload: { id: 'off1', type: 'relay', relay: 1, on: true } }));
  const a = await find(ws, (m) => m.type === 'ack' && m.payload.id === 'off1');
  assert.equal(a.payload.ok, false); assert.match(a.payload.error, /offline/);
  assert.equal(cmds.length, 0); ws.close();
});

test('telemetry/status forwarded; invalid payloads dropped; command published and ack routed', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  await pub('esp32_01', 'status', { online: true }, true);
  await find(ws, (m) => m.type === 'status' && m.controller === 'esp32_01' && m.online === true);
  await pub('esp32_01', 'telemetry', { relays: 'bogus' });                    // invalid: dropped
  await pub('esp32_01', 'telemetry', { ts: 1, relays: [true, false], evil: 1 });
  const t = await find(ws, (m) => m.type === 'telemetry');
  assert.deepEqual(t.payload, { ts: 1, relays: [true, false] });             // unknown key stripped; bogus one never arrived
  assert.equal(ws.msgs.filter((m) => m.type === 'telemetry').length, 1);

  ws.send(JSON.stringify({ type: 'command', role: 'admin', payload: { id: 'c1', type: 'relay', relay: 3, on: true } }));
  await until(() => cmds.length === 1);
  assert.equal(cmds[0].t, `anva/${B}/esp32_01/command`);
  assert.deepEqual(cmds[0].p, { id: 'c1', type: 'relay', relay: 3, on: true });
  await pub('esp32_01', 'ack', { id: 'unknown-id', ok: true });                 // ignored
  await pub('esp32_01', 'ack', { id: 'c1', ok: true });
  const a = await find(ws, (m) => m.type === 'ack' && m.payload.id === 'c1');
  assert.equal(a.payload.ok, true);
  assert.ok(!ws.msgs.some((m) => m.type === 'ack' && m.payload.id === 'unknown-id'));
  ws.close();
});

test('relay 32 and malformed commands rejected by gate (not published)', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  const n = cmds.length;
  ws.send(JSON.stringify({ type: 'command', payload: { id: 'r32', type: 'relay', relay: 32, on: true } }));
  assert.equal((await find(ws, (m) => m.payload?.id === 'r32')).payload.ok, false);
  assert.equal(cmds.length, n); ws.close();
});

test('AC enable rejected on overload, accepted when healthy; unacked command times out', async () => {
  await pub('esp32_02', 'status', { online: true }, true);
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  const acT = (o) => ({ ac: { contactor: false, overload: false, phaseFail: false, estop: false, fault: false, ...o } });
  await pub('esp32_02', 'telemetry', acT({ overload: true }));
  await find(ws, (m) => m.type === 'telemetry' && m.controller === 'esp32_02');
  const n = cmds.length;
  ws.send(JSON.stringify({ type: 'command', payload: { id: 'ac1', type: 'ac', on: true } }));
  const a1 = await find(ws, (m) => m.payload?.id === 'ac1');
  assert.match(a1.payload.error, /AC protection/); assert.equal(cmds.length, n);

  await pub('esp32_02', 'telemetry', acT({}));
  await until(() => ws.msgs.filter((m) => m.type === 'telemetry' && m.controller === 'esp32_02').length >= 2);
  ws.send(JSON.stringify({ type: 'command', payload: { id: 'ac2', type: 'ac', on: true } }));
  await until(() => cmds.length === n + 1);                                   // published, controller never acks
  const a2 = await find(ws, (m) => m.payload?.id === 'ac2');
  assert.match(a2.payload.error, /did not acknowledge/);
  await pub('esp32_02', 'ack', { id: 'ac2', ok: true });                       // late ack ignored
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(ws.msgs.filter((m) => m.payload?.id === 'ac2').length, 1);
  ws.close();
});

test('per-client rate limit', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  for (let i = 0; i < 8; i++) ws.send(JSON.stringify({ type: 'command', payload: { id: `rl${i}`, type: 'relay', relay: 32, on: true } }));
  await find(ws, (m) => m.payload?.error === 'Rate limit exceeded'); ws.close();
});

test('oversized message closes the connection', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  ws.send('x'.repeat(10000));
  await new Promise((r) => ws.once('close', r));
});

test('MQTT disconnect: controllers marked offline and bridge status broadcast; recovers on reconnect', async () => {
  const ws = await client(); await find(ws, (m) => m.type === 'auth' && m.ok);
  bridge.mq.stream.destroy();                                                  // simulate broker link loss
  await find(ws, (m) => m.type === 'bridge' && m.mqtt === false);
  assert.ok(ws.msgs.some((m) => m.type === 'status' && m.controller === 'esp32_01' && m.online === false));
  ws.send(JSON.stringify({ type: 'command', payload: { id: 'dc1', type: 'relay', relay: 1, on: true } }));
  assert.equal((await find(ws, (m) => m.payload?.id === 'dc1')).payload.ok, false);
  await find(ws, (m) => m.type === 'bridge' && m.mqtt === true);                 // reconnect
  await find(ws, (m) => m.type === 'status' && m.controller === 'esp32_01' && m.online === true);   // retained status replayed
  ws.close();
});
