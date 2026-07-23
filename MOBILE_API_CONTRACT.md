# Khaos Nexus Mobile API contract

Status: **foundation contract — transport not active**

This contract defines the boundary between Khaos Nexus Mobile and the Windows desktop application. The Android app never talks directly to Discord, GitHub, RCON, Palworld REST, or a hosting provider.

## Security envelope

Every authenticated request will include:

- `Authorization: Bearer <device credential>`
- `X-Khaos-Device: <device id>`
- `X-Khaos-Timestamp: <UTC epoch milliseconds>`
- `X-Khaos-Nonce: <unique random value>`
- `X-Khaos-Signature: <request signature>`

The desktop validates:

- HTTPS certificate and pinned installation fingerprint
- enabled, non-revoked device record
- credential hash
- request timestamp window
- nonce uniqueness
- request signature
- device role
- endpoint-specific rate limit

The desktop returns a request ID for audit and support.

## Standard response

```json
{
  "ok": true,
  "requestId": "req-...",
  "time": "2026-07-23T18:00:00.000Z",
  "data": {}
}
```

Errors never include protected configuration:

```json
{
  "ok": false,
  "requestId": "req-...",
  "time": "2026-07-23T18:00:00.000Z",
  "error": {
    "code": "FORBIDDEN",
    "message": "This device does not have permission to run that action."
  }
}
```

## Pairing endpoints

### `POST /v1/pair/claim`

Unauthenticated but rate-limited. Requires a live one-time session.

Request:

```json
{
  "sessionId": "pair-...",
  "code": "123456",
  "deviceName": "Kirito's phone",
  "devicePublicKey": "base64...",
  "certificateFingerprint": "AA:BB:..."
}
```

Response while awaiting desktop approval:

```json
{
  "ok": true,
  "data": {
    "claimId": "claim-...",
    "status": "pending-owner-approval",
    "expiresAt": "2026-07-23T18:05:00.000Z"
  }
}
```

### `GET /v1/pair/claim/{claimId}`

Returns `pending-owner-approval`, `approved`, `rejected`, or `expired`.

The approved response returns the device credential once. The desktop stores only its salted hash.

## Read-only Viewer endpoints

### `GET /v1/health`

Public-safe gateway health and protocol version.

### `GET /v1/session`

Device ID, display name, role, desktop name, certificate fingerprint, and session expiry.

### `GET /v1/dashboard`

- desktop application version
- Discord runtime state
- game-server summary
- attention items
- backup summary
- update state
- module progress

### `GET /v1/discord`

- bot state
- uptime
- latency
- memory
- guild count
- last heartbeat
- last redacted error ID

### `GET /v1/servers`

Public-safe cards only:

- server ID
- display name
- game
- enabled state
- online state
- players current/max
- version
- uptime
- performance
- last check

Never include host, port, username, password, token, provider ID, or player platform ID.

### `GET /v1/servers/{id}`

Adds public-safe game-specific detail such as Palworld world day, FPS, frame time, and player display names.

### `GET /v1/modules`

Module catalog, migration stage, progress, dependencies, and enabled state. Phone editing is not included initially.

### `GET /v1/logs?after=<cursor>&level=<level>`

Redacted desktop activity with cursor pagination.

### `GET /v1/status-panels`

Discord status-panel configuration summary and runtime health without Discord channel secrets or raw server endpoints.

### `GET /v1/update`

Desktop and Android release state.

### `GET /v1/events`

Authenticated event stream for state updates, alerts, logs, server checks, backup results, and update status.

## Operator action endpoints

All action requests require an idempotency key and explicit typed payload.

### Bot

- `POST /v1/actions/bot/start`
- `POST /v1/actions/bot/stop`
- `POST /v1/actions/bot/restart`

### Game servers

- `POST /v1/actions/servers/{id}/check`
- `POST /v1/actions/servers/{id}/save`
- `POST /v1/actions/servers/{id}/announce`

### Status panels

- `POST /v1/actions/status-panels/{id}/refresh`
- `POST /v1/actions/status-panels/refresh-all`

### Desktop safety

- `POST /v1/actions/recovery`
- `POST /v1/actions/backups`

## Owner action endpoints

Owner endpoints are excluded from the first APK. When added, they require:

- Android biometric confirmation when enabled
- a short-lived Owner action token
- a typed confirmation phrase for destructive actions
- optional desktop approval
- complete audit metadata

Candidate Owner actions:

- Maintenance Mode
- configuration restore
- player moderation
- graceful shutdown
- emergency force stop
- mobile device role changes
- gateway settings

## Rate limits

Initial limits per device:

- state reads: 120/minute
- log polling: 30/minute
- event stream: one active connection
- server checks: 12/minute
- save world: 2/minute per server
- bot restart: 3/10 minutes
- Safe Recovery: 2/10 minutes
- backup creation: 3/hour
- pairing claim: 5/10 minutes per address

## Audit record

Every mobile action stores:

- request ID
- device ID and name
- paired device role
- desktop operator role
- endpoint/action
- target resource ID
- timestamp
- result
- duration
- redacted error ID
- source address

Request bodies are summarized rather than stored when they may contain private community text.

## Versioning

- Base path: `/v1`
- Android app sends supported API range.
- Desktop returns minimum and current API versions.
- Breaking changes require a new base path.
- Additive fields do not break older clients.

## Offline behavior

The Android app may cache the last public-safe dashboard and server state, clearly marked with its age. Actions are never queued blindly while offline. The user must reconnect and explicitly resubmit an action.
