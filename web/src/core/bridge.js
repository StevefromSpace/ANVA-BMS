// LIVE transport: WebSocket to the ANVA Node bridge (which owns the MQTT credentials).
// Auth: per-user login on the bridge; the session token (short-lived, HMAC-signed, one-time resume) lives in sessionStorage only.
// The role shown in the UI is whatever the bridge says; it is enforced server-side, never trusted from here.
const SESSION_KEY = 'anva.session';
let current = null;

export const getSession = () => { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } };
export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);
export const sendBridge = (m) => { if (current?.readyState === 1) { current.send(JSON.stringify(m)); return true; } return false; };

// One-shot login; resolves {user, role}. Token is stored for the transport to resume with.
export function loginViaBridge(url, username, password) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.close(); reject(new Error('Bridge did not respond')); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'login', username, password }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type !== 'auth') return;
      clearTimeout(t); ws.close();
      if (!m.ok) return reject(new Error(m.error || 'Invalid username or password'));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: m.token, exp: m.exp, user: m.user, role: m.role }));
      resolve({ user: m.user, role: m.role });
    };
    ws.onerror = () => { clearTimeout(t); reject(new Error('Cannot reach bridge')); };
  });
}

export function create(api) {
  let ws, retry, stopped = false, backoff = 1000, authFailed = false;
  const connect = () => {
    api.setState(() => ({ bridge: 'connecting' }));
    ws = current = new WebSocket(api.getState().bridgeUrl);
    ws.onopen = () => {
      backoff = 1000;
      const s = getSession();
      // No token => the bridge accepts only if BRIDGE_ALLOW_ANON=1 (dev viewer).
      ws.send(JSON.stringify({ type: 'auth', ...(s?.token ? { token: s.token } : {}) }));
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'auth') {
        if (!m.ok) { authFailed = true; clearSession(); api.setState(() => ({ bridge: 'error' })); return; }
        if (m.token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: m.token, exp: m.exp, user: m.user, role: m.role }));
        api.setState(() => ({ bridge: 'connected', bridgeRole: m.role, bridgeUser: m.user }));
      }
      else if (m.type === 'telemetry') api.applyTelemetry(m.controller, m.payload);
      else if (m.type === 'status') api.applyStatus(m.controller, m.online);
      else if (m.type === 'ack') api.applyAck(m.payload);
      else if (m.type === 'bridge') api.setState(() => ({ schedulerState: m.scheduler }));
      else if (m.type === 'schedules') api.setState(() => ({ schedulerState: m.scheduler, serverSchedules: m.schedules, scheduleResults: m.results }));
      else if (m.type === 'schedule_result') api.setState((s) => ({ scheduleResults: [...(s.scheduleResults || []), m.payload].slice(-100) }));
      else if (m.type === 'schedule_ack') api.setState(() => ({ scheduleError: m.ok ? null : m.error }));
    };
    ws.onclose = () => {
      api.setState(() => ({ bridge: stopped && !authFailed ? 'idle' : 'error' }));
      if (!stopped && !authFailed) { retry = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 30000); }
    };
    ws.onerror = () => ws.close();
  };
  return {
    start() { authFailed = false; connect(); },
    stop() { stopped = true; clearTimeout(retry); ws?.close(); },
    send(cmd) { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'command', payload: cmd })); },
  };
}
