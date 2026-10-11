# Nexus Web API v1 Contract

Status: **Sidecar incubation / read-only**

This contract defines the first browser-safe interface consumed by the Nexus Web/PWA sidecar. It does **not** expose service credentials, Discord bot tokens, RCON secrets, provider keys, or other privileged configuration.

## Base path

`/api/v1`

The browser receives the base URL through `VITE_NEXUS_API_BASE_URL`. The client defaults to `stub` data mode and does not make network requests until `VITE_NEXUS_DATA_MODE=live` is explicitly configured.

## Session transport

Browser sessions use secure server-managed cookies when live mode is introduced.

Required production cookie properties:

- `HttpOnly`
- `Secure`
- `SameSite=Lax` or stricter unless an approved OAuth callback flow requires otherwise
- short-lived application session with server-side revocation

Bearer tokens, OAuth client secrets, refresh tokens, Discord bot tokens, and service credentials must not be stored in browser local storage.

## `GET /health`

Purpose: return a safe read-only summary of Nexus service health.

Example response:

```json
{
  "apiVersion": "v1",
  "environment": "preview",
  "generatedAt": "2026-08-25T06:00:00.000Z",
  "services": [
    {
      "id": "nexus-api",
      "name": "Nexus API",
      "summary": "Healthy",
      "state": "online",
      "checkedAt": "2026-08-25T06:00:00.000Z",
      "version": "1.0.0"
    }
  ]
}
```

Allowed service states:

- `online`
- `degraded`
- `offline`
- `unknown`

Health responses must remain safe to display. Raw exception traces, connection strings, internal secrets, credentials, or provider responses containing sensitive information must be redacted server-side.

## `GET /session`

Purpose: return the current Nexus web session projection.

Unauthenticated response:

```json
{
  "authenticated": false,
  "user": null
}
```

Authenticated response shape:

```json
{
  "authenticated": true,
  "user": {
    "id": "nexus-user-id",
    "displayName": "Display Name",
    "roles": ["owner"],
    "capabilities": ["nexus.dashboard.read"]
  },
  "expiresAt": "2026-08-25T07:00:00.000Z"
}
```

The web client may use roles/capabilities to decide what to render, but those values are **not authorization by themselves**. Every privileged backend endpoint must independently validate the server-side session and required capability.

## Initial capability namespace

Public capability plumbing may use generic identifiers such as:

- `nexus.dashboard.read`
- `nexus.services.read`
- `nexus.account.read`
- `nexus.admin.read`
- `nexus.admin.write`
- `nexus.private.access`

Private functionality must be represented only by generic capability checks in this public repository. Private implementation details remain outside public documentation and public release notes.

## Error envelope

Non-success API responses should use a stable safe envelope:

```json
{
  "code": "forbidden",
  "message": "This Nexus account does not have access to that capability.",
  "requestId": "optional-correlation-id"
}
```

Do not return stack traces or secret-bearing provider error bodies to the browser.

## Read-only milestone rule

The Web/PWA remains read-only through the initial accepted dashboard milestone. Write endpoints must not be enabled until all of the following exist:

1. authenticated Nexus sessions;
2. backend capability enforcement;
3. CSRF protection appropriate to the selected session model;
4. audit logging for privileged actions;
5. bounded endpoint-specific input validation;
6. accepted preview testing.

## Versioning

Breaking changes require a new API version. Additive fields may be introduced within v1 if existing clients can safely ignore them.
