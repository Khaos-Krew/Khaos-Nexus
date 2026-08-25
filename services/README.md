# Hosted Nexus services

This directory contains deployment boundaries for long-running services that are hosted independently from the Windows desktop application.

The desktop application remains the primary Khaos Nexus product. These services do not replace desktop-owned configuration, permission, scheduler, or game-server authority.

## CI contract

Hosted Node services own their own build and test commands. Root desktop CI must not auto-discover raw service test files. Instead, the stabilization test runner discovers service packages with a `test` script, requires a committed `package-lock.json`, performs a deterministic `npm ci --ignore-scripts`, and then runs that service's own `npm test` command. This keeps TypeScript compilation and runtime test execution inside the service boundary that defines them.

The same service-owned test contract is exercised on Linux CI and the Windows build path. The shared runner invokes the active npm CLI through Node rather than platform-specific command shims, preventing Linux-only success or Windows-only `npm.cmd` spawning failures.

Hosted service validation runs before the larger desktop test suite. A missing lockfile, failed service build, or failed service test therefore stops the PR early without spending the full desktop-test and packaging budget first.

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
