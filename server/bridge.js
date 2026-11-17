// ANVA bridge: MQTT <-> WebSocket. Credentials/tokens come from environment only.
// Per-user auth (scrypt + signed session tokens); roles are enforced server-side (see docs/SECURITY.md).
import { WebSocketServer } from 'ws';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import mqtt from 'mqtt';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { controllerOf, gateCommand } from './gate.js';
import { authenticate, loadUsers, checkSecret, issueToken, verifyToken, createLockout, canCommand, canAdmin } from './auth.js';
import { checkBind, mqttSecurity } from './netcheck.js';
import { createScheduler } from './scheduler.js';

const CONTROLLERS = ['esp32_01', 'esp32_02'];
const AC_TELEMETRY_MAX_AGE_MS = 15_000;
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const isBool = (v) => typeof v === 'boolean';
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const AC_KEYS = ['contactor', 'overload', 'phaseFail', 'estop', 'fault'];

// Returns a sanitized copy or null. Unknown keys are dropped, never forwarded.
export function validateTelemetry(p) {
  if (!isObj(p)) return null;
  const out = {};
  if (p.ts !== undefined) { if (!Number.isFinite(p.ts)) return null; out.ts = p.ts; }
  if (p.relays !== undefined) {
    if (!Array.isArray(p.relays) || p.relays.length > 16 || !p.relays.every(isBool)) return null;
    out.relays = p.relays;
  }
  if (p.ac !== undefined) {
    if (!isObj(p.ac) || !AC_KEYS.every((k) => isBool(p.ac[k]))) return null;
    out.ac = Object.fromEntries(AC_KEYS.map((k) => [k, p.ac[k]]));
  }
  if (p.meter !== undefined) {
    if (!isObj(p.meter) || !Object.values(p.meter).every(Number.isFinite)) return null;
    out.meter = { ...p.meter };
  }
  return out;
}
export function validateAck(p) {
  if (!isObj(p) || typeof p.id !== 'string' || p.id.length > 64 || !isBool(p.ok)) return null;
  const out = { id: p.id, ok: p.ok };
  if (p.error !== undefined) { if (typeof p.error !== 'string') return null; out.error = p.error.slice(0, 200); }
  return out;
}


const readTls = (t) => (t ? { cert: t.cert ?? readFileSync(t.certFile), key: t.key ?? readFileSync(t.keyFile) } : null);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export function createBridge(o = {}) {
  const cfg = {
    buildingId: 'building001', port: 8787, host: '127.0.0.1', allowAnon: false, devOperator: false,
    allowedOrigins: DEFAULT_ORIGINS, maxPayload: 4096, rateMax: 20, rateWindowMs: 10_000,
    commandTimeoutMs: 5000, authTimeoutMs: 5000, sessionTtlMs: 3_600_000, usersFile: here('./users.json'),
    lockout: {}, scheduler: {}, mqttOptions: {}, log: console.log, ...o,
  };
  if (!cfg.mqttUrl) throw new Error('mqttUrl required');
  checkSecret([].concat(cfg.sessionSecret ?? '')[0]);
  const tls = readTls(cfg.tls);
  checkBind({ host: cfg.host, tls, remoteInsecureOverride: cfg.remoteInsecureOverride });
  const mqttSec = mqttSecurity({ url: cfg.mqttUrl, caFile: cfg.mqttCaFile });
  if (cfg.allowAnon) console.warn(`WARNING: BRIDGE_ALLOW_ANON=1: unauthenticated clients get ${cfg.devOperator ? 'OPERATOR (BRIDGE_DEV_OPERATOR=1)' : 'viewer'} access. DEV ONLY.`);
  const getUsers = () => (cfg.users ?? loadUsers(cfg.usersFile));
  const lock = createLockout(cfg.lockout);
  const ipLock = createLockout({ ...cfg.lockout, maxFails: (cfg.lockout.maxFails ?? 5) * 4 });   // per-address limit is looser: NAT/shared hosts
  const revoked = new Set();
  const B = cfg.buildingId;
  const mq = mqtt.connect(cfg.mqttUrl, { username: cfg.mqttUser, password: cfg.mqttPass, reconnectPeriod: 3000, ...mqttSec, ...cfg.mqttOptions });
  const server = tls ? https.createServer(tls) : http.createServer();
  const wss = new WebSocketServer({
    server, maxPayload: cfg.maxPayload,
    verifyClient: ({ origin }) => !origin || cfg.allowedOrigins.includes('*') || cfg.allowedOrigins.includes(origin),
  });
  const ac = { state: null, at: 0, offSince: null, wasOn: false };
  const status = new Map();           // controller -> online (last retained/live status)
  const pending = new Map();          // command id -> { resolve, ws, timer }
  let mqttUp = false;

  const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const broadcast = (m) => wss.clients.forEach((c) => c.session && send(c, m));
  const settle = (id, payload) => {
    const p = pending.get(id); if (!p) return false;
    clearTimeout(p.timer); pending.delete(id); p.resolve(payload); return true;
  };
  const failAll = (error) => [...pending.keys()].forEach((id) => settle(id, { id, ok: false, error }));
  const setStatus = (c, online) => { status.set(c, online); broadcast({ type: 'status', controller: c, online }); };
  const bridgeMsg = () => ({ type: 'bridge', mqtt: mqttUp, scheduler: sched.state() });
  const schedMsg = () => ({ type: 'schedules', scheduler: sched.state(), schedules: sched.list(), results: sched.results() });

  // The single command path: used by websocket clients AND the scheduler. Resolves with the ack payload.
  function runCommand(cmd, ws = null) {
    const now = Date.now();
    const fail = (error) => Promise.resolve({ id: typeof cmd?.id === 'string' ? cmd.id : undefined, ok: false, error });
    const fresh = ac.state && now - ac.at < AC_TELEMETRY_MAX_AGE_MS ? ac.state : null;
    const err = gateCommand(cmd, { ac: fresh, offSince: ac.offSince, now });
    if (err) return fail(err);
    const controller = controllerOf(cmd);
    if (!mqttUp) return fail('Bridge not connected to MQTT');
    if (status.get(controller) !== true) return fail(`Controller ${controller} offline`);
    if (pending.has(cmd.id)) return fail('Duplicate command id');
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(cmd.id, { id: cmd.id, ok: false, error: 'Controller did not acknowledge' }), cfg.commandTimeoutMs);
      pending.set(cmd.id, { resolve, ws, timer });
      mq.publish(`anva/${B}/${controller}/command`, JSON.stringify({ id: cmd.id, type: cmd.type, relay: cmd.relay, on: cmd.on }), { qos: 1 }, (e) => {
        if (e) settle(cmd.id, { id: cmd.id, ok: false, error: 'Publish failed' });
      });
    });
  }

  const sched = createScheduler({
    file: here('./data/schedules.json'),
    ...cfg.scheduler, log: cfg.log,
    execute: (cmd, who) => { const full = { ...cmd, id: `s${randomUUID().slice(0, 12)}` }; cfg.log(`AUDIT user=${who} cmd=${cmd.type} relay=${cmd.relay} on=${cmd.on} id=${full.id}`); return runCommand(full); },
    onResult: (r) => broadcast({ type: 'schedule_result', payload: r }),
    onChange: () => broadcast(schedMsg()),
  });

  mq.on('connect', () => { mqttUp = true; mq.subscribe(`anva/${B}/+/+`); broadcast(bridgeMsg()); });
  const down = () => {
    if (!mqttUp) return;
    mqttUp = false; ac.state = null;
    failAll('Bridge lost MQTT connection');
    CONTROLLERS.forEach((c) => setStatus(c, false));   // unknown == offline until retained status returns
    broadcast(bridgeMsg());
  };
  mq.on('close', down); mq.on('offline', down);
  mq.on('error', (e) => console.error('MQTT error', e.message));

  mq.on('message', (t, buf) => {
    const [root, bld, controller, kind] = t.split('/');
    if (root !== 'anva' || bld !== B || !CONTROLLERS.includes(controller) || buf.length > cfg.maxPayload) return;
    let p; try { p = JSON.parse(buf.toString()); } catch { return; }
    if (kind === 'status') {
      if (isObj(p) && isBool(p.online)) { if (!p.online) ac.state = null; setStatus(controller, p.online); }
    } else if (kind === 'telemetry') {
      const v = validateTelemetry(p); if (!v) return;
      if (v.ac) {
        if (ac.wasOn && v.ac.contactor === false) ac.offSince = Date.now();
        ac.wasOn = v.ac.contactor; ac.state = v.ac; ac.at = Date.now();
      }
      broadcast({ type: 'telemetry', controller, payload: v });
    } else if (kind === 'ack') {
      const v = validateAck(p); if (v) settle(v.id, v);   // unknown/late ids ignored
    }
  });

  const audit = (ws, cmd, decision) => cfg.log(`AUDIT user=${ws.session.username} role=${ws.session.role} ip=${ws.ip} cmd=${cmd?.type} relay=${cmd?.relay} on=${cmd?.on} id=${cmd?.id} ${decision}`);

  function handleCommand(ws, cmd) {
    const nack = (error) => send(ws, { type: 'ack', payload: { id: typeof cmd?.id === 'string' ? cmd.id : undefined, ok: false, error } });
    if (!canCommand(ws.session.role)) { audit(ws, cmd, 'DENIED role'); return nack(`Forbidden: role ${ws.session.role} cannot send commands`); }
    const now = Date.now();
    if (now - ws.rate.start > cfg.rateWindowMs) ws.rate = { start: now, n: 0 };
    if (++ws.rate.n > cfg.rateMax) { audit(ws, cmd, 'DENIED rate'); return nack('Rate limit exceeded'); }
    runCommand(cmd, ws).then((ack) => { audit(ws, cmd, ack.ok ? 'OK' : `FAILED ${ack.error}`); send(ws, { type: 'ack', payload: ack }); });
  }

  function handleSchedule(ws, m) {
    const reply = (ok, error, extra) => send(ws, { type: 'schedule_ack', ok, ...(error ? { error } : {}), ...extra });
    if (m.type === 'schedule_list') return send(ws, schedMsg());   // read-only for every role
    if (!canAdmin(ws.session.role)) { cfg.log(`AUDIT user=${ws.session.username} role=${ws.session.role} ${m.type} DENIED role`); return reply(false, 'Forbidden: admin role required'); }
    try {
      const s = m.type === 'schedule_create' ? sched.create(m.schedule) : m.type === 'schedule_update' ? sched.update(m.id, m.schedule) : (sched.remove(m.id), undefined);
      cfg.log(`AUDIT user=${ws.session.username} role=admin ${m.type} id=${s?.id ?? m.id}`);
      reply(true, undefined, { schedule: s });
    } catch (e) { reply(false, e.message); }
  }

  function startSession(ws, { username, role }, exp) {
    ws.session = { username, role, exp };
    clearTimeout(ws.authTimer); clearTimeout(ws.expTimer);
    let token;
    if (Number.isFinite(exp)) {
      token = issueToken(cfg.sessionSecret, { username, role, cid: ws.cid }, exp - Date.now());
      ws.expTimer = setTimeout(() => ws.close(1008, 'session expired'), Math.max(0, exp - Date.now()));
    }
    send(ws, { type: 'auth', ok: true, user: username, role, ...(token ? { token, exp } : {}) });
    send(ws, bridgeMsg());
    status.forEach((online, controller) => send(ws, { type: 'status', controller, online }));
    send(ws, schedMsg());
  }
  const authFail = (ws, error) => { send(ws, { type: 'auth', ok: false, ...(error ? { error } : {}) }); ws.close(1008, 'auth failed'); };

  function handleLogin(ws, m) {
    const uk = `u:${String(m.username).slice(0, 64)}`, ik = `ip:${ws.ip}`;
    if (lock.locked(uk) || ipLock.locked(ik)) { cfg.log(`AUTH locked user=${m.username} ip=${ws.ip}`); return authFail(ws, 'Too many failed attempts; try again later'); }
    const u = authenticate(getUsers(), m.username, m.password);
    if (!u) { lock.fail(uk); ipLock.fail(ik); cfg.log(`AUTH failed user=${String(m.username).slice(0, 64)} ip=${ws.ip}`); return authFail(ws); }
    lock.ok(uk); ipLock.ok(ik); cfg.log(`AUTH ok user=${u.username} role=${u.role} ip=${ws.ip}`);
    startSession(ws, u, Date.now() + cfg.sessionTtlMs);
  }

  function handleResume(ws, m) {
    if (m.token === undefined && cfg.allowAnon) return startSession(ws, { username: 'anonymous-dev', role: cfg.devOperator ? 'operator' : 'viewer' }, Infinity);
    const t = verifyToken(cfg.sessionSecret, m.token);
    if (!t || revoked.has(t.jti)) return authFail(ws);
    const u = getUsers().find((x) => x.username === t.username);
    if (!u) return authFail(ws);                       // user removed since login
    revoked.add(t.jti);                                // one-time: reconnect rotates the token per connection
    startSession(ws, { username: u.username, role: u.role }, t.exp);
  }

  wss.on('connection', (ws, req) => {
    ws.session = null; ws.rate = { start: 0, n: 0 }; ws.cid = randomUUID(); ws.ip = req.socket.remoteAddress;
    ws.authTimer = setTimeout(() => ws.close(1008, 'auth timeout'), cfg.authTimeoutMs);
    ws.on('close', () => { clearTimeout(ws.authTimer); clearTimeout(ws.expTimer); for (const [id, p] of pending) if (p.ws === ws) { clearTimeout(p.timer); pending.delete(id); } });
    ws.on('error', () => {});
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      if (!isObj(m)) return;
      if (!ws.session) {
        if (m.type === 'login') return handleLogin(ws, m);
        if (m.type === 'auth') return handleResume(ws, m);
        return ws.close(1008, 'auth required');
      }
      if (ws.session.exp <= Date.now()) return ws.close(1008, 'session expired');
      if (m.type === 'command') handleCommand(ws, m.payload);   // any m.role is ignored by design
      else if (typeof m.type === 'string' && m.type.startsWith('schedule_')) handleSchedule(ws, m);
      else if (m.type === 'logout') { const t = verifyToken(cfg.sessionSecret, m.token); if (t) revoked.add(t.jti); ws.close(1000, 'logout'); }
    });
  });

  const ready = new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  server.listen(cfg.port, cfg.host);
  sched.start();
  return {
    ready, wss, mq, sched, runCommand,
    get port() { return server.address()?.port; },
    close: () => new Promise((res) => {
      sched.stop(); failAll('Bridge shutting down'); wss.clients.forEach((c) => c.terminate());
      mq.end(true, () => wss.close(() => server.close(() => res())));
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const e = process.env;
  const host = e.HOST || '127.0.0.1';
  const tls = e.TLS_CERT_FILE && e.TLS_KEY_FILE ? { certFile: e.TLS_CERT_FILE, keyFile: e.TLS_KEY_FILE } : null;
  try {
    const b = createBridge({
      mqttUrl: e.MQTT_URL, mqttUser: e.MQTT_USER, mqttPass: e.MQTT_PASS, mqttCaFile: e.MQTT_CA_FILE, buildingId: e.BUILDING_ID || 'building001',
      port: Number(e.PORT || 8787), host, tls, remoteInsecureOverride: e.REMOTE_INSECURE_OVERRIDE === '1',
      sessionSecret: [e.SESSION_SECRET, e.SESSION_SECRET_PREVIOUS].filter(Boolean), usersFile: e.USERS_FILE || undefined,
      allowAnon: e.BRIDGE_ALLOW_ANON === '1', devOperator: e.BRIDGE_DEV_OPERATOR === '1',
      allowedOrigins: e.ALLOWED_ORIGINS ? e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS,
      scheduler: { enabled: e.SCHEDULER_ENABLED === '1', dryRun: e.SCHEDULER_DRY_RUN !== '0', tz: e.SCHEDULER_TZ, graceMs: Number(e.MISSED_GRACE_MS || 0) },
    });
    b.ready.then(() => console.log(`Bridge listening on ${tls ? 'wss' : 'ws'}://${host}:${b.port}`));
  } catch (err) { console.error(err.message); process.exit(1); }
}
