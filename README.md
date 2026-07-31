<div align="center">

# Khaos Nexus

### Local-first command center for Discord and game-server operations

[![Platform](https://img.shields.io/badge/Platform-Windows-111111?style=for-the-badge&logo=windows&logoColor=white)](../../releases/latest)
[![Desktop](https://img.shields.io/badge/Desktop-Electron-8B0000?style=for-the-badge&logo=electron&logoColor=white)](#current-features)
[![Discord](https://img.shields.io/badge/Discord-Automation-111111?style=for-the-badge&logo=discord&logoColor=white)](#discord-automation)
[![Status](https://img.shields.io/badge/Nexus-Active-8B0000?style=for-the-badge)](#current-features)

**Command the chaos. Keep control local.**

</div>

Khaos Nexus is a Windows desktop operations platform for managing Discord automation, dedicated game servers, scheduled maintenance, moderation, diagnostics, updates, and protected remote access from one application.

The project is designed around a local-first security model: credentials remain protected on the host system, public Discord output is redacted, and destructive actions are guarded by role checks, confirmations, and audit history.

---

<!-- CURRENT_FEATURES:START -->
## Current Features

Khaos Nexus currently includes **16 production-ready capabilities** across the desktop platform, Discord automation, game-server operations, mobile access, and reliability tooling.

### Core Desktop Platform

<details>
<summary><strong>Local-First Desktop Command Center</strong> — Runs Khaos Nexus as a standalone Windows application.</summary>

**Status:** Available

Provides one control surface for Discord automation, game-server operations, modules, updates, diagnostics, and local configuration. Sensitive values are protected through Windows secure storage.

</details>

<details>
<summary><strong>Module Center and Local Recovery</strong> — Lets the local desktop owner enable, disable, recover, and safely gate application modules.</summary>

**Status:** Available

Includes dependency-aware module switching, Disable All, Safe Mode, validated-module recovery, migration notes, and local recovery controls that remain available when Discord is offline or misconfigured.

</details>

<details>
<summary><strong>Startup Guard, Watchdog, and Recovery</strong> — Detects failed or unresponsive launches and presents a usable recovery path.</summary>

**Status:** Available

Uses serialized startup, visible-interface health checks, renderer monitoring, retained watchdog state, software-renderer compatibility, and recovery diagnostics instead of leaving the application frozen.

</details>

<details>
<summary><strong>Windows Installer, Portable Build, and Updates</strong> — Ships installable and portable Windows builds with a protected update flow.</summary>

**Status:** Available

Supports installer and portable executables, updater metadata, checksums, mandatory pre-update backups, retryable installation, and an always-visible in-app update center.

</details>

### Discord Automation

<details>
<summary><strong>Supervised Discord Bot Runtime</strong> — Starts, monitors, configures, and recovers the Discord bot from the desktop application.</summary>

**Status:** Available

Includes spawn-confirmed process supervision, slash-command support, live configuration updates, operator access controls, synchronized runtime status, and error reporting.

</details>

<details>
<summary><strong>Discord Studio and Server Automation</strong> — Builds and manages Discord-facing tools without manually recreating each server element.</summary>

**Status:** Available

Supports Discord Studio workflows, role menus, category and channel automation, module-aware commands and buttons, routed logs, and persistent server panels.

</details>

<details>
<summary><strong>Privacy-Safe Status and Queue Panels</strong> — Publishes persistent game-server information without exposing protected connection data.</summary>

**Status:** Available

Provides live server status, player summaries, queue information where supported, and refresh controls while excluding credentials, IP addresses, and platform identifiers from public output.

</details>

### Game Server Operations

<details>
<summary><strong>ARK and Generic RCON</strong> — Connects to ARK and other compatible servers through guarded RCON operations.</summary>

**Status:** Available

Supports status checks, announcements, player visibility, saves, moderation, schedules, and adapter-based command handling without exposing raw credentials to the interface.

</details>

<details>
<summary><strong>Palworld REST and RCON</strong> — Combines Palworld REST capabilities with RCON-backed administration.</summary>

**Status:** Available

Provides typed server status, connected-player operations, announcements, save and shutdown workflows, Discord delivery, and stable redacted adapter errors.

</details>

<details>
<summary><strong>Rust WebRCON</strong> — Adds dedicated Rust server administration through WebRCON.</summary>

**Status:** Available

Includes vanilla-safe status, players, saves, announcements, moderation, Discord status and queue panels, and Owner-only raw console access.

</details>

<details>
<summary><strong>Encrypted Pterodactyl Hosting Control</strong> — Controls hosted servers through the Pterodactyl Client API without exposing API keys to the renderer.</summary>

**Status:** Available

Discovers hosted servers, reads resource state, and provides guarded start, restart, stop, and Owner-confirmed emergency kill actions through encrypted credentials and short-lived action tokens.

</details>

<details>
<summary><strong>Cross-Server Players and Moderation</strong> — Shows connected players across selected servers and centralizes guarded moderation.</summary>

**Status:** Available

Supports game, server, and player search; reason-required kicks; Owner-confirmed bans; protected identifiers; local action history; and short-lived moderation tokens.

</details>

<details>
<summary><strong>Recurring Server Scheduler</strong> — Automates warnings, saves, shutdowns, restarts, and recovery checks.</summary>

**Status:** Available

Includes countdown broadcasts, save-before-shutdown protection, game-specific safe shutdowns, provider restart verification, cancellation, interrupted-job recovery, Discord reports, and execution history.

</details>

<details>
<summary><strong>Typed Game Adapter SDK</strong> — Provides a consistent extension layer for adding supported games.</summary>

**Status:** Available

Uses explicit capability manifests, guarded destructive-action policies, stable redacted errors, bounded protocol fixtures, and shared bridges for Palworld REST, ARK and generic RCON, and Rust WebRCON.

</details>

### Mobile, Diagnostics, and Reliability

<details>
<summary><strong>Android Companion and Mobile Gateway</strong> — Provides a read-only Android companion with an optional protected connection to the desktop application.</summary>

**Status:** Available

Uses certificate-pinned HTTPS, one-time Owner-approved pairing, P-256 signed requests, hashed device credentials, replay protection, immediate revocation, and Android Keystore storage.

</details>

<details>
<summary><strong>Backups, Monitoring, and Support Bundles</strong> — Captures actionable diagnostics while keeping secrets out of logs and exports.</summary>

**Status:** Available

Includes verified local backups, rolling breadcrumbs, unclean-shutdown detection, retained AppData logs, stale-health cleanup, redacted support bundles, and optional HTTPS diagnostics delivery.

</details>

## In Development

These **2 capabilities** are actively being built or validated and are not yet presented as fully released features.

<details>
<summary><strong>Satisfactory Dedicated-Server Adapter</strong> — Extends the shared adapter system to Satisfactory's dedicated-server API.</summary>

**Status:** In development

Development work covers typed server operations, capability reporting, safe administrative actions, and integration with the shared Nexus status and control surfaces.

</details>

<details>
<summary><strong>Standalone Installer Diagnostics</strong> — Adds installer-first troubleshooting before the main interface has to load.</summary>

**Status:** In development

Development work provides a dedicated Khaos Nexus Diagnostics launcher, startup environment checks, portable sidecar reporting, and clearer recovery guidance for installation or launch failures.

</details>
<!-- CURRENT_FEATURES:END -->

---

## Downloads and Documentation

| Resource | Description |
| --- | --- |
| [Latest release](../../releases/latest) | Download the current Windows installer or portable build. |
| [Run from source](RUN_FROM_SOURCE.md) | Install dependencies and launch a local development build. |
| [Security model](SECURITY.md) | Review credential storage, redaction, permissions, and protected actions. |
| [Pterodactyl setup](PTERODACTYL_SETUP.md) | Connect compatible hosted servers through the Pterodactyl Client API. |
| [Scheduler setup](SERVER_SCHEDULER_SETUP.md) | Configure warnings, saves, shutdowns, restarts, and verification. |
| [Owner test builds](TEST_BUILDS.md) | Review preserved validation checkpoints and test-build guidance. |

## Feature Documentation Monitor

Feature documentation is maintained through [`docs/features.json`](docs/features.json), which serves as the machine-readable registry for released, in-development, and planned capabilities.

The accompanying GitHub Action:

- verifies that generated README sections match the feature registry;
- warns when application or release files change without a corresponding feature-registry review;
- synchronizes the README after registry changes reach `main`;
- performs a scheduled weekly consistency check; and
- supports manual synchronization through GitHub Actions.

Update the feature registry rather than editing the generated feature blocks directly.

```bash
node .github/scripts/sync-readme-features.mjs
```

Validate synchronization without changing the README:

```bash
node .github/scripts/sync-readme-features.mjs --check
```

## Security and Operational Safety

Khaos Nexus is built to keep operational secrets away from public interfaces and renderer code.

- Discord tokens, provider credentials, server passwords, and device credentials are protected after storage.
- Public Discord messages exclude passwords, IP addresses, platform identifiers, and internal IDs unless a safe display value is explicitly required.
- Destructive operations use permission checks, short-lived internal tokens, reason requirements, and exact-name confirmation where appropriate.
- Backups, logs, diagnostics, and support bundles are designed to redact sensitive values.
- Updates require a verified pre-update backup before installation proceeds.

See [`SECURITY.md`](SECURITY.md) for the complete security model.

## Windows Distribution

Stable releases may include:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`
- updater metadata and blockmaps
- SHA-256 checksum manifests

Release candidates remain on validation branches until startup, navigation, Discord delivery, server operations, diagnostics, and update behavior pass real-device testing.

---

<!-- ROADMAP:START -->
## Planned Roadmap

The roadmap currently contains **4 planned capabilities**. Priorities may change as the desktop platform, Discord runtime, and game adapters mature.

<details>
<summary><strong>Shared Bot Onboarding and Bring Your Own Bot</strong> — Makes one shared multi-server Nexus bot the default while preserving an advanced custom-bot path.</summary>

**Status:** Planned

The default onboarding flow will connect communities to the managed Nexus bot. Advanced users will be able to supply their own Discord application and token for separate branding or isolation.

</details>

<details>
<summary><strong>D&D Campaign Workspace</strong> — Adds campaign, character, session, encounter, homebrew, and Discord-channel tools.</summary>

**Status:** Planned

Campaigns will bind to existing Discord channels instead of creating duplicates, with role-aware campaign access and support for user-created or otherwise permitted content imports.

</details>

<details>
<summary><strong>Website Migration Import</strong> — Moves supported Khaos Nexus website settings and module data into the desktop application.</summary>

**Status:** Planned

The migration path will classify legacy data, import supported settings safely, preserve an audit trail, and clearly identify anything that requires manual review.

</details>

<details>
<summary><strong>Additional Game Adapters</strong> — Expands the Nexus through the typed adapter SDK as reliable server APIs become available.</summary>

**Status:** Planned

Future adapters will reuse the same capability, permission, status, scheduling, moderation, and redaction contracts instead of introducing one-off control paths.

</details>
<!-- ROADMAP:END -->
