# Veyra Discord Gateway

Minimal Discord-presence and readiness service for **Veyra — Lore Master**.

This process is intentionally separate from the Veyra D&D AI HTTP service. It keeps Veyra online in Discord and exposes only safe readiness commands while the full Discord/D&D interaction layer is still under test.

## Current authority

- Discord `Guilds` intent only.
- No Message Content intent.
- No normal-message listeners.
- No campaign mutation handlers.
- No direct OpenAI credential.
- May call only the Veyra AI service's unauthenticated `/health` endpoint when `VEYRA_AI_BASE_URL` is configured.

## Commands

- `/veyra-status` — reports Discord gateway readiness and Veyra AI `/health` state.
- `/veyra-about` — explains the current prep/testing boundary.

## Railway

Repository: `Khaos-Krew/Khaos-Nexus`

Branch during rollout: `agent/railway-hosted-services`

Dockerfile: `services/veyra/discord-gateway/Dockerfile`

Required secret:

- `VEYRA_DISCORD_TOKEN` — token for the dedicated Veyra Discord application. Never reuse Nexus Sentinel's token.

Optional variables:

- `VEYRA_AI_BASE_URL=https://veyra-lore-master-production.up.railway.app`
- `VEYRA_ACTIVITY_TEXT=Watching over the Nexus archives`

The bot application must be installed with the `bot` and `applications.commands` scopes for the global readiness commands to appear.
