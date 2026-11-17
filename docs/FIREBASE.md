# Firebase Integration (PLANNED, NOT IMPLEMENTED)

Nothing here exists in the code. There is no Firebase SDK dependency, no project and no deployed rules. This is a design proposal for a later phase. Current login is a local role picker (not secure); see [SECURITY.md](SECURITY.md).

## Goals

- Real sign-in with roles (viewer / operator / admin) replacing the role picker.
- Persistent audit log, alarms, schedules/scenes and daily/monthly energy history (today in-memory or localStorage).
- Push notifications for critical alarms.

## Proposed design

| Service | Use |
|---|---|
| Firebase Auth | Email/password (or Google). Role as custom claim `role`, set by an admin-only server script. |
| Firestore | Config, schedules, audit, alarms, energy rollups. Machine data written by the bridge (Admin SDK); user edits by the web app. |
| FCM | Critical alarms (overload, phase failure, controller offline). Web push needs a service worker and HTTPS. |

Control commands should keep flowing through the bridge/MQTT path, not Firestore, unless a server component applying the same `gateCommand` checks is added. A client must never be able to write to a path that bypasses the interlocks.

### Collections (sketch)

```
buildings/{b}/schedules/{id}      {name,time,days,action,target,on,enabled}
buildings/{b}/scenes/{id}         {name,relays[]}
buildings/{b}/alarms/{id}         {t,level,source,text,ack,ackBy}
buildings/{b}/audit/{id}          {t,uid,msg}                 (append only)
buildings/{b}/energy/{yyyy-mm-dd} {kwh,peakKw,samples}        (written by bridge)
users/{uid}                       {displayName}               (role lives in the auth claim)
```

### Rules sketch (illustrative, untested)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    match /buildings/{b}/{col}/{doc} {
      allow read: if signedIn();
      allow write: if signedIn() && role() in ['operator','admin']
                   && col in ['schedules','scenes'];
      allow update: if signedIn() && role() in ['operator','admin'] && col == 'alarms'
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['ack','ackBy']);
      allow create: if signedIn() && col == 'audit' && request.resource.data.uid == request.auth.uid;
    }
    // energy, config: Admin SDK (bridge) only; no client writes.
  }
}
```

Must be tested with the Firebase emulator before any use. Audit rows must not be deletable by clients.

## Open questions

- Should the bridge verify Firebase ID tokens on the WebSocket (replacing or complementing the shared token in [SECURITY.md](SECURITY.md))?
- Who runs unattended schedules (see [ROADMAP](ROADMAP.md))? Reading them from Firestore ties local control to cloud availability.
- On-site behaviour when the internet drops: local control must keep working.
