# Khaos Nexus

Khaos Nexus is a local-first Windows desktop control center for Discord automation and game-server operations. It runs independently from the retired website workflow and stores protected credentials through Windows secure storage.

## Current desktop capabilities

- Supervised Discord bot startup, recovery, slash commands, and operator access.
- ARK, Palworld REST/RCON, and generic Source RCON server connections.
- Persistent Discord server-status panels with privacy-safe player summaries.
- Discord Studio, role menus, channel automation, and routed observability feeds.
- Verified local backups, crash diagnostics, application monitoring, and updates.
- Recurring server schedules with warnings, save-before-shutdown protection, host-managed restart verification, Discord reports, cancellation, and execution history.
- Software-renderer compatibility mode and serialized feature startup for stable Windows operation.

## Server Scheduler

The scheduler can broadcast player warnings, save worlds, request game-specific safe shutdowns, and verify that the hosting service returns the server online. It does not claim to power on a hosted server without a provider API.

See [SERVER_SCHEDULER_SETUP.md](SERVER_SCHEDULER_SETUP.md) for configuration and safety details.

## Running from source

See [RUN_FROM_SOURCE.md](RUN_FROM_SOURCE.md).

## Windows builds

The repository packages both:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`

Owner-test builds remain on draft branches until they have been verified on the target Windows PC. Stable releases are published only after startup, navigation, server operations, Discord delivery, and update behavior pass real-device testing.

## Security

Discord tokens, provider credentials, and game-server passwords are never rendered back into the interface after storage. Public Discord outputs exclude passwords, IP addresses, platform IDs, and user IDs unless a feature explicitly requires a safe display name.

See [SECURITY.md](SECURITY.md) for the security model.
