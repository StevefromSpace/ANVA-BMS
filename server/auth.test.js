import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, authenticate, issueToken, verifyToken, createLockout, checkSecret } from './auth.js';
import { checkBind, mqttSecurity } from './netcheck.js';
import { createBridge } from './bridge.js';

const S = 's'.repeat(40);
test('scrypt hash/verify, unique salts', () => {
  const a = hashPassword('pw-1234567890'), b = hashPassword('pw-1234567890');
  assert.notEqual(a.salt, b.salt); assert.ok(verifyPassword('pw-1234567890', a)); assert.ok(!verifyPassword('x', a));
  assert.equal(authenticate([{ username: 'u', role: 'viewer', ...a }], 'nobody', 'pw-1234567890'), null);
  assert.equal(authenticate([{ username: 'u', role: 'root', ...a }], 'u', 'pw-1234567890'), null);   // bad role
});
test('token: expiry, tamper, wrong secret, rotation', () => {
  const t = issueToken(S, { username: 'u', role: 'admin' }, 1000, 0);
  assert.equal(verifyToken(S, t, 999).role, 'admin');
  assert.equal(verifyToken(S, t, 1000), null);
  const [b, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'u', r: 'admin', exp: 1e15 })).toString('base64url');
  assert.equal(verifyToken(S, `${forged}.${sig}`, 1), null);
  assert.equal(verifyToken(S, `${b}.${sig.slice(0, -2)}AA`, 1), null);
  assert.equal(verifyToken('o'.repeat(40), t, 1), null);
  assert.ok(verifyToken(['n'.repeat(40), S], t, 1));            // previous secret still accepted during rotation
  assert.throws(() => checkSecret('short'));
});
test('lockout', () => {
  let t = 0; const l = createLockout({ maxFails: 2, lockMs: 100, now: () => t });
  l.fail('k'); assert.ok(!l.locked('k')); l.fail('k'); assert.ok(l.locked('k')); t = 101; assert.ok(!l.locked('k'));
});
test('TLS-fail-closed checks', () => {
  assert.throws(() => checkBind({ host: '0.0.0.0', tls: null }), /without TLS/);
  checkBind({ host: '127.0.0.1', tls: null }); checkBind({ host: '0.0.0.0', tls: {} });
  assert.throws(() => mqttSecurity({ url: 'mqtt://broker.example:1883' }), /mqtts/);
  assert.equal(mqttSecurity({ url: 'mqtts://broker.example:8883' }).rejectUnauthorized, true);
  assert.deepEqual(mqttSecurity({ url: 'mqtt://127.0.0.1:1883' }), {});
  assert.throws(() => createBridge({ mqttUrl: 'mqtt://127.0.0.1:1', host: '0.0.0.0', sessionSecret: S }), /without TLS/);
  assert.throws(() => createBridge({ mqttUrl: 'mqtt://broker.example:1', sessionSecret: S }), /mqtts/);
});
