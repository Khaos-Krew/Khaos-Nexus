# Khaos Nexus Web — Cloudflare Deployment

Status: **Under Development**

## Pages project

- Repository: `Khaos-Krew/Khaos-Nexus`
- Branch: `sidecar/nexus-web-pwa`
- Root directory: `web`
- Build command: `npm run build`
- Output directory: `dist`
- Node: `22`

## Public build variables

These values are compiled into the browser bundle and must never contain secrets.

- `VITE_NEXUS_ENV=development`
- `VITE_NEXUS_DATA_MODE=live`
- `VITE_NEXUS_API_BASE_URL=/api/v1`

## Runtime variables / secrets for Pages Functions

Set these in Cloudflare Pages runtime settings. Do not commit values to GitHub.

- `NEXUS_ENV=development`
- `DISCORD_CLIENT_ID=<Discord application client ID>`
- `DISCORD_CLIENT_SECRET=<secret>`
- `NEXUS_SESSION_SECRET=<strong random secret, minimum 48 characters>`
- `NEXUS_OWNER_DISCORD_IDS=<comma-separated Discord user IDs>`
- `NEXUS_STAFF_DISCORD_IDS=<comma-separated Discord user IDs>`

`NEXUS_OWNER_DISCORD_IDS` automatically receives owner + staff + private capabilities. `NEXUS_STAFF_DISCORD_IDS` receives staff access only.

## Discord OAuth redirect

Add the deployed callback URL to the Discord application OAuth2 redirect list:

`https://<pages-project-host>/api/v1/auth/discord/callback`

When a custom Nexus domain is added later, add that callback URL as well before switching the public link.

## First acceptance check

1. `/api/v1/health` returns API v1 JSON.
2. The panel shows Nexus Web and Nexus API as Online.
3. An unapproved Discord account receives HTTP 403 after OAuth.
4. An approved staff account signs in and receives the staff workspace.
5. An approved owner account receives the private capability gate.
6. Refreshing the page keeps the session through the signed HttpOnly cookie.
7. Sign out clears the session.
8. The PWA can be installed from the HTTPS deployment.

Do not remove the **Under Development** label until the owner explicitly authorizes it.
