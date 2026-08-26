# Khaos Nexus Web/PWA — Development Deployment

Status: **Under Development**

This document is the source of truth for the staff-only Web/PWA preview deployment.

## Cloudflare Pages project

- Repository: `Khaos-Krew/Khaos-Nexus`
- Branch: `sidecar/nexus-web-pwa`
- Root directory: `web`
- Build command: `npm run build`
- Output directory: `dist`
- Node: `22.16.0` or newer compatible Node 22 release

The `web/functions/` directory provides same-origin Cloudflare Pages Functions for `/api/v1/*`.

## Required runtime variables / secrets

Configure these in the Cloudflare project environment. Secret values must never be committed to GitHub or exposed as `VITE_*` variables.

| Name | Secret | Purpose |
| --- | --- | --- |
| `NEXUS_ENV` | No | Environment label, e.g. `development` |
| `DISCORD_CLIENT_ID` | No | Discord OAuth application/client ID |
| `DISCORD_CLIENT_SECRET` | **Yes** | Discord OAuth client secret |
| `NEXUS_SESSION_SECRET` | **Yes** | Long random secret used to HMAC-sign Nexus sessions |
| `NEXUS_OWNER_DISCORD_IDS` | No | Comma-separated approved owner Discord user IDs |
| `NEXUS_STAFF_DISCORD_IDS` | No | Comma-separated approved staff Discord user IDs |

Generate `NEXUS_SESSION_SECRET` with at least 48 random characters. Do not reuse a Discord token or any other service secret.

## Discord OAuth redirect

For the development Pages hostname, add this redirect to the Discord application:

`https://<pages-host>/api/v1/auth/discord/callback`

When a custom Nexus hostname is introduced, add its callback URI before switching traffic.

OAuth scope is intentionally limited to `identify` for the first staff preview.

## Optional health integrations

These do not block account setup or panel installation:

| Name | Secret | Purpose |
| --- | --- | --- |
| `SENTINEL_HEALTH_URL` | No | Read-only Sentinel health endpoint |
| `SENTINEL_HEALTH_TOKEN` | Yes when required | Bearer token used server-side for Sentinel health |
| `GAME_SERVICES_HEALTH_URL` | No | Aggregate game-service health endpoint |
| `GAME_SERVICES_HEALTH_TOKEN` | Yes when required | Bearer token used server-side for game-service health |

The browser never receives these tokens.

## Deployment readiness

The panel exposes `/api/v1/config`, which reports only boolean readiness and allowlist counts. It never returns configured IDs or secret values.

Core staff sign-in is considered ready when all of the following are configured:

1. Discord client ID
2. Discord client secret
3. Nexus session secret
4. At least one owner Discord ID
5. Staff access allowlist (an owner alone satisfies the initial staff-access requirement)

## Release rule

The UI, PWA metadata, and Discord Staff Hub entry must remain labeled **Under Development** until the owner explicitly authorizes changing that status.
