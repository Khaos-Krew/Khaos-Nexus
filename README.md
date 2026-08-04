# Khaos Nexus

Khaos Nexus is a local-first Windows desktop command network for Discord automation, game-server operations, D&D campaign management, and isolated AI services. It runs independently from the retired website workflow and stores protected credentials through Windows secure storage.

## Current desktop capabilities

- Supervised Discord bot startup, recovery, slash commands, and operator access.
- ARK, Palworld REST/RCON, and generic Source RCON server connections.
- Encrypted Pterodactyl Client API connections with hosted-server discovery, resources, and guarded power controls.
- Cross-server connected-player visibility with guarded kick and owner-confirmed ban workflows.
- Persistent Discord server-status panels with privacy-safe player summaries.
- Discord Studio, role menus, channel automation, and routed observability feeds.
- Complete local D&D campaign workflows for campaigns, members, characters, sources, sessions, encounters, NPCs, loot, maps, homebrew, Discord bindings, Co-DM drafts, procedural map proposals, and explicit AI Game Master sessions.
- Isolated bundled D&D AI and Nexus AI Core services with separate processes, endpoints, tokens, logs, readiness, shutdown handling, and authority boundaries.
- Verified local backups, crash diagnostics, application monitoring, and updates.
- Recurring server schedules with warnings, save-before-shutdown protection, host-managed restart verification, Discord reports, cancellation, and execution history.
- Software-renderer compatibility mode and serialized feature startup for stable Windows operation.

## Desktop navigation

The refreshed application shell keeps all existing views and controls while organizing them into clearer groups:

- **Command Center** — runtime health, activity, metrics, and quick actions.
- **Connected Systems** — Discord setup and game-server management.
- **D&D** — a dedicated campaign command-table hub for campaign, character, session, encounter, homebrew, map, Co-DM, and AI Game Master workflows.
- **Nexus AI** — a dedicated service hub for D&D AI, Nexus AI Core, assistant surfaces, game/mod monitors, integrations, activity, and protected settings.
- **All Modules** — feature switches and companion workspaces.
- **System** — Application Monitor, live logs, updates, backups, and desktop settings.

The D&D and Nexus AI tabs are presentation and navigation layers over the existing authoritative services. They do not create duplicate storage, permissions, schedulers, Discord logic, AI processes, or game-server control paths.

## Khaos Nexus visual system

The desktop uses a black, charcoal, onyx, ruby, and crimson visual identity with restrained energy glow, command-grid details, D&D rune/forge graphics, and Nexus AI circuitry. Background artwork is original repository-owned SVG/CSS and uses no remote assets.

Readability and performance remain higher priority than decoration:

- Dense logs, forms, settings, and consoles retain strong opaque backgrounds.
- Module graphics are layered behind content and do not intercept input.
- Existing dark styling remains the fallback if the optional UI extension cannot load.
- Motion is disabled automatically when the operating system requests reduced motion.
- No large looping video backgrounds or external image dependencies are used.

## D&D and AI boundaries

- D&D AI is the only AI service allowed to receive explicitly approved and redacted campaign context.
- Nexus AI Core does not receive D&D campaign records and remains advisory-only.
- AI output stays private until a user explicitly reviews and applies an approved proposal.
- AI services do not directly own the shared scheduler, Discord authority, game adapters, or server commands.
- Provider credentials and service tokens remain outside renderer-visible state, logs, diagnostics, backups, and registered-bot configuration.

## Hosted Server Control

The first provider adapter uses the Pterodactyl Client API. Client API keys are encrypted through Windows secure storage. The renderer receives safe server cards and short-lived action tokens, not API keys or Pterodactyl server identifiers. Operators can start, restart, and stop; emergency kill is Owner-only and requires an exact-name confirmation.

See [PTERODACTYL_SETUP.md](PTERODACTYL_SETUP.md) for setup and testing guidance.

## Players & Moderation

The player console refreshes connected players across selected servers, supports name/server/game search, and uses short-lived internal moderation tokens rather than exposing player account IDs or raw RCON commands to the renderer. Kick requires Operator access; ban and history clearing require Owner access. Every action requires a reason and is recorded locally.

## Server Scheduler

The scheduler can broadcast player warnings, save worlds, request game-specific safe shutdowns, and verify that the hosting service returns the server online. It does not claim to power on a hosted server without a provider API. Nexus AI monitoring reuses this shared scheduler rather than introducing a second scheduler.

See [SERVER_SCHEDULER_SETUP.md](SERVER_SCHEDULER_SETUP.md) for configuration and safety details.

## Running from source

See [RUN_FROM_SOURCE.md](RUN_FROM_SOURCE.md).

Typical validation for renderer-only UI changes:

```bash
npm test
npm run check
```

Windows packaging validation remains required before any release candidate can be published.

## Windows builds

The repository packages both:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`

Owner-test builds remain on draft branches until they have been verified on the target Windows PC. Stable releases are published only after startup, navigation, D&D, AI services, server operations, Discord delivery, accessibility, and update behavior pass real-device testing.

See [TEST_BUILDS.md](TEST_BUILDS.md) for preserved owner-test checkpoints and checksums.

## Development and release policy

- Production work starts from an exact approved commit on an assigned issue and branch.
- UI work must preserve existing view IDs, service calls, permission checks, scheduler ownership, storage, and update behavior.
- Mobile-only code belongs in `Khaos-Krew/nexus-mobile-companion`, not this repository.
- A feature branch or draft pull request is not a release.
- Tags, public releases, updater assets, and deployment require separate explicit Owner authorization and exact-head validation.

The `ui/v0.35.0-khaos-nexus-refresh-r2` work is intentionally non-release UI development based on merged PR #190. It must not publish or modify a release channel.

## Security

Discord tokens, provider credentials, AI service tokens, and game-server passwords are never rendered back into the interface after storage. Public Discord outputs exclude passwords, IP addresses, platform IDs, and user IDs unless a feature explicitly requires a safe display name.

See [SECURITY.md](SECURITY.md) for the security model.
