# Hosted Nexus services

This directory contains deployment boundaries for long-running services that are hosted independently from the Windows desktop application.

The desktop application remains the primary Khaos Nexus product. These services do not replace desktop-owned configuration, permission, scheduler, or game-server authority.

## Services

### `nexus-sentinel`

Persistent Discord gateway and automation scheduler. This is the maintained successor to the archived `chaos-nexus-hub/bot-worker` Railway workload. It intentionally preserves the existing Railway environment-variable contract while moving the source into the canonical `Khaos-Krew/Khaos-Nexus` repository.

Railway build context: repository root

Dockerfile: `services/nexus-sentinel/Dockerfile`

### `veyra`

Hosted deployment wrapper for the existing `packages/ai/dnd-ai` service. Veyra owns D&D lore / Co-DM AI concerns and remains isolated from Nexus Sentinel's system/Discord automation role.

Railway build context: repository root

Dockerfile: `services/veyra/Dockerfile`

## Authority boundaries

- Nexus Sentinel must not receive private D&D campaign records.
- Veyra may receive only campaign context allowed by the D&D AI service's authentication and tenancy policies.
- Neither hosted service owns the desktop application's protected credentials or local game-server configuration.
- Secrets are supplied through Railway environment variables and are never committed to this repository.
