# ANVA BMS security notes

Status: development prototype. Not verified on real hardware or a real broker beyond a local test broker (aedes).

## Authentication (live mode)
- Individual accounts live in `server/users.json` (git-ignored; format in `server/users.example.json`): username, role, scrypt hash + salt (N=16384, r=8, p=1). Manage with `node server/users-cli.js add <user> <viewer|operator|admin> | passwd <user> | remove <user> | list`. The password is read from stdin or a hidden prompt, never argv (min 10 chars).
- WebSocket login: first message `{type:'login',username,password}`. The bridge replies `{type:'auth',ok,user,role,token,exp}`. The token is HMAC-SHA256 signed with `SESSION_SECRET` (required, min 32 chars; the bridge refuses to start without it), short-lived (1 h default), and bound to a per-connection id. Reconnect resumes with `{type:'auth',token}`; each resume token is one-time (a fresh one is issued), so a replayed token is rejected. Revocation list and lockout counters are in memory and reset on bridge restart.
- Roles are assigned by the server from users.json and enforced server-side on every message; any `role` field sent by a client is ignored.
  - viewer: receive only.
  - operator: lighting relay commands (relays 1-31) and AC enable/disable (still subject to the gate).
  - admin: additionally schedule create/update/delete and settings/mode-level changes.
- Lockout: 5 failed logins per username (locks 5 min); per-address limit is 4x looser to tolerate shared NAT. Unknown users take the same scrypt time as known ones.
- Audit: every command (allowed, denied or failed) logs `AUDIT user=... role=... ip=... cmd=... relay=... on=... id=... <decision>`; schedule edits and scheduler-issued commands are logged too. Logs go to stdout; ship them somewhere durable.
- `BRIDGE_TOKEN` is removed. `BRIDGE_ALLOW_ANON=1` (dev only) lets a client with no token in as a **viewer**; `BRIDGE_DEV_OPERATOR=1` raises that to operator. Both log a loud warning. Never use on a reachable host.
- The web **simulation-mode role picker is local UI only. It is NOT authentication and is not secure**; it has no effect on live hardware.

### SESSION_SECRET rotation
1. Generate a new secret (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`).
2. Set `SESSION_SECRET_PREVIOUS=<old>` and `SESSION_SECRET=<new>`, restart the bridge. New tokens are signed with the new secret; tokens signed with the previous one are still accepted until they expire.
3. After one session TTL (1 h), remove `SESSION_SECRET_PREVIOUS` and restart. To force everyone out immediately, skip step 2 (no previous secret).
Rotate also if the secret leaks. Removing a user from users.json blocks their next resume; an already-open connection lasts until token expiry.

## WebSocket / TLS
- Binds `127.0.0.1` by default. Set `TLS_CERT_FILE` and `TLS_KEY_FILE` to serve `wss://` directly. A non-loopback `HOST` without TLS makes the bridge refuse to start (fail closed). `REMOTE_INSECURE_OVERRIDE=1` bypasses this: **unsafe**, passwords and tokens travel in clear text; for isolated lab use only.
- `ALLOWED_ORIGINS` allowlist (default Vite dev origins). Origin is browser-enforced only; the login is the real control.
- Limits: 4 KiB max message, login within 5 s, 20 commands / 10 s per connection, one in-flight command per id, 5 s ack timeout.
- Commands are rejected when the bridge has no MQTT link or the controller's last status is not online. Inbound MQTT is shape-validated before broadcast; unknown/late ack ids are ignored.

## MQTT
- A non-loopback broker requires `mqtts://` (or `wss://`) with `rejectUnauthorized: true`; optional `MQTT_CA_FILE` pins the CA. Otherwise the bridge refuses to start. Plain `mqtt://` is accepted only for loopback.
- Credentials only in `server/.env` and `firmware/anva_controller/secrets.h` (git-ignored). Use per-device broker users with topic ACLs. Rotate any credential ever pasted into chat, logs or a repo.
- Firmware verifies the broker with `BROKER_CA_CERT` and refuses to connect if empty or before NTP time sync.

## Safety / admin commands
- AC enable is gated three times (UI, bridge, firmware). The firmware refuses AC enable until `AC_FEEDBACK_VERIFIED` is set after bench verification, and enforces min OFF-time. Protection (overload/phase/E-stop) must remain independent hardware.
- The server scheduler never issues AC commands; see [SCHEDULER.md](SCHEDULER.md).

## Known limitations
- Single bridge process: lockout, revocation and rate counters are in memory.
- users.json is read on each login/resume (no caching); protect its file permissions.
- No password complexity beyond length, no MFA, no per-user session list.
- TLS paths are covered by configuration-fail-closed tests only; no real certificate handshake test exists.
- Bench verification of pins, I2C addresses, relay polarity and AC feedback is still required; broker ACLs and firmware signing are outside this repo.
