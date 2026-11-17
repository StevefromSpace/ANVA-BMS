// Individual-user auth: scrypt password hashes, HMAC-signed short-lived session tokens, login lockout.
import { scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ROLES = ['viewer', 'operator', 'admin'];
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const MIN_SECRET_LEN = 32;

const derive = (password, salt) => scryptSync(String(password), salt, KEYLEN, SCRYPT);

export function hashPassword(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString('hex'), hash: derive(password, salt).toString('hex') };
}
export function verifyPassword(password, rec) {
  const want = Buffer.from(rec.hash, 'hex');
  const got = derive(password, Buffer.from(rec.salt, 'hex'));
  return want.length === got.length && timingSafeEqual(want, got);
}
const DUMMY = hashPassword('dummy-password-for-timing');   // burn the same scrypt cost for unknown users

export function loadUsers(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')).users ?? []; }
  catch (e) { if (e.code === 'ENOENT') return []; throw new Error(`Cannot read users file ${file}: ${e.message}`); }
}

// Returns {username, role} or null. Same work for unknown and known users.
export function authenticate(users, username, password) {
  const u = users.find((x) => x.username === username);
  const ok = verifyPassword(typeof password === 'string' ? password : '', u ?? DUMMY);
  return u && ok && ROLES.includes(u.role) ? { username: u.username, role: u.role } : null;
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (secret, body) => createHmac('sha256', secret).update(body).digest();

export function checkSecret(s) {
  if (typeof s !== 'string' || s.length < MIN_SECRET_LEN) throw new Error(`SESSION_SECRET required (min ${MIN_SECRET_LEN} chars)`);
}
// secrets: current secret string, or [current, ...previous] to verify during rotation (only current signs).
export function issueToken(secrets, { username, role, cid }, ttlMs, now = Date.now()) {
  const s = [].concat(secrets)[0];
  const body = b64(JSON.stringify({ u: username, r: role, cid, jti: randomUUID(), exp: now + ttlMs }));
  return `${body}.${b64(sign(s, body))}`;
}
export function verifyToken(secrets, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const given = Buffer.from(sig, 'base64url');
  const sigOk = [].concat(secrets).some((s) => { const w = sign(s, body); return w.length === given.length && timingSafeEqual(w, given); });
  if (!sigOk) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!Number.isFinite(p.exp) || p.exp <= now || !ROLES.includes(p.r) || typeof p.u !== 'string') return null;
    return { username: p.u, role: p.r, cid: p.cid, jti: p.jti, exp: p.exp };
  } catch { return null; }
}

// Failure counter per key (username and client address). Locks for lockMs after maxFails within the window.
export function createLockout({ maxFails = 5, lockMs = 300_000, now = Date.now } = {}) {
  const m = new Map();
  return {
    locked: (k) => (m.get(k)?.until ?? 0) > now(),
    fail(k) {
      const e = m.get(k) ?? { n: 0, until: 0 };
      if (e.until && e.until <= now()) { e.n = 0; e.until = 0; }
      if (++e.n >= maxFails) e.until = now() + lockMs;
      m.set(k, e);
    },
    ok: (k) => m.delete(k),
  };
}

export const canCommand = (role) => role === 'operator' || role === 'admin';
export const canAdmin = (role) => role === 'admin';
