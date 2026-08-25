# Nexus Web Authentication and Authorization Model

Status: **Sidecar design contract**

The Nexus Web/PWA must never become an alternate path around Sentinel/backend authorization. Authentication identifies the Nexus account; authorization is always enforced by the Nexus API.

## Identity provider

Initial sign-in provider: **Discord OAuth2**.

Discord is used to prove the user's Discord identity. Discord is not the long-term authorization database for the web client. After OAuth, the backend resolves the Discord identity to a Nexus account and calculates Nexus roles/capabilities server-side.

## Login flow

1. Browser requests `GET /api/v1/auth/discord`.
2. Nexus API creates a short-lived OAuth state value and begins the Discord authorization flow.
3. Discord redirects to the Nexus API callback.
4. Nexus API validates state and exchanges the OAuth code server-side.
5. Nexus API reads only the Discord identity data required for account linking.
6. Nexus API resolves or creates the Nexus account.
7. Nexus API creates a revocable web session.
8. Browser receives only an opaque `HttpOnly` session cookie.
9. Browser calls `GET /api/v1/session` to receive the safe session projection.

OAuth client secrets, Discord bot tokens, refresh tokens, and backend service credentials never enter browser JavaScript.

## Session rules

Production session cookies must be:

- `HttpOnly`;
- `Secure`;
- scoped to the Nexus web/API origin as narrowly as practical;
- `SameSite=Lax` or stricter unless the final OAuth topology requires a documented exception;
- short-lived and revocable server-side.

Session identifiers should be rotated at authentication and other security-sensitive transitions.

## Nexus account model

Recommended server-side entities:

- `nexus_accounts`
  - internal UUID
  - Discord user ID (unique when linked)
  - display metadata safe for Nexus UI
  - account state
  - created/updated timestamps
- `nexus_roles`
- `nexus_capabilities`
- `nexus_account_roles`
- `nexus_role_capabilities`
- `nexus_account_capability_overrides` for narrowly-scoped exceptional/private access
- `nexus_web_sessions`
- `nexus_audit_events`

Do not put private capability meaning or private payload data into public profile fields.

## Initial role vocabulary

The first public role vocabulary may include:

- `owner`
- `community_manager`
- `admin`
- `moderator`
- `member`

Discord role synchronization can influence Nexus role assignment, but the API must resolve the effective Nexus role set at the trusted backend boundary.

## Capability model

Prefer capabilities over hard-coded role checks inside endpoint logic.

Initial public capabilities:

- `nexus.dashboard.read`
- `nexus.services.read`
- `nexus.account.read`
- `nexus.admin.read`
- `nexus.admin.write`
- `nexus.private.access`

Example endpoint policy:

```text
GET /api/v1/health
  requires nexus.services.read

POST /api/v1/admin/example
  requires nexus.admin.write
  requires CSRF validation
  writes audit event
```

The UI may hide or show controls using the session projection, but this is only presentation logic. Every protected API route independently checks the authenticated session and effective capability set.

## Private owner-only capability

The public repository contains only the generic `nexus.private.access` gate. Private feature implementation, prompts, memory, private data models, and private service endpoints remain outside public documentation and public release notes.

Only explicitly approved Nexus accounts receive the private capability. A public Discord role alone must never grant it.

## CSRF and write operations

The read-only milestone does not expose mutation endpoints.

Before the first write operation is enabled:

- establish a CSRF defense compatible with the final cookie/session topology;
- require explicit endpoint capabilities;
- validate all input against bounded schemas;
- write an audit event for privileged actions;
- include actor Nexus account ID, action, target, timestamp, success/failure, and correlation/request ID;
- redact secrets and sensitive payload fields from logs.

## Logout and revocation

`POST /api/v1/auth/logout` will revoke the current server-side session and clear the browser cookie.

Owner/admin tooling must eventually support revoking all web sessions for a Nexus account.

## Authentication milestone acceptance

Authentication is not considered complete until all of the following are verified in preview:

1. Discord sign-in succeeds through the backend callback.
2. No OAuth/service secrets appear in browser storage or JavaScript bundles.
3. The session cookie is `HttpOnly` and `Secure` in preview/production.
4. `GET /session` returns the correct safe account projection.
5. An account without a capability receives `403` from the API even if it manually calls the endpoint.
6. Logout revokes the server session.
7. Private capability assignment cannot be obtained solely from a Discord role or client-side state.
