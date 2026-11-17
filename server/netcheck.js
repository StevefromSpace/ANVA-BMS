// Fail-closed transport checks for the bridge's WS listener and its MQTT link.
import { readFileSync } from 'node:fs';

export const isLoopback = (h) => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h) || /^127\./.test(h);

export function checkBind({ host, tls, remoteInsecureOverride }) {
  if (isLoopback(host) || tls) return;
  if (remoteInsecureOverride) { console.warn('WARNING: REMOTE_INSECURE_OVERRIDE=1: serving plaintext ws:// on a non-loopback address. UNSAFE; credentials and tokens are exposed.'); return; }
  throw new Error(`Refusing to bind ${host} without TLS: set TLS_CERT_FILE and TLS_KEY_FILE (or REMOTE_INSECURE_OVERRIDE=1, unsafe)`);
}

// Returns extra mqtt.connect options. Non-loopback broker must use mqtts:// with certificate verification.
export function mqttSecurity({ url, caFile }) {
  let u; try { u = new URL(url); } catch { throw new Error('MQTT_URL is not a valid URL'); }
  if (isLoopback(u.hostname)) return {};
  if (u.protocol !== 'mqtts:' && u.protocol !== 'wss:') throw new Error('Non-loopback MQTT broker requires mqtts:// (TLS)');
  return { rejectUnauthorized: true, ...(caFile ? { ca: readFileSync(caFile) } : {}) };
}
