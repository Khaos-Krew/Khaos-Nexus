<div align="center">

# 🐉 KHAOS NEXUS 🐺

### **Command the chaos. Unite your worlds.**

[![Platform](https://img.shields.io/badge/platform-Windows-8B0000?style=for-the-badge&logo=windows&logoColor=white)](../../releases/latest)
[![Discord](https://img.shields.io/badge/Discord-Automation-111111?style=for-the-badge&logo=discord&logoColor=DC143C)](#discord-operations)
[![Game Servers](https://img.shields.io/badge/Game_Server-Control-8B0000?style=for-the-badge&logo=serverfault&logoColor=white)](#game-server-control)
[![Status](https://img.shields.io/badge/Nexus-Active-111111?style=for-the-badge)](#nexus-feature-status)

</div>

> **Khaos Nexus** is a local-first Windows command center for Discord automation, game-server administration, protected remote access, scheduling, diagnostics, and expandable game modules.

Built for the **Khaos Krew**, the Nexus brings scattered server tools into one dark, guarded control surface—without depending on the retired website workflow.

---

## ◆ Enter the Nexus

| Path | Purpose |
|---|---|
| [Latest release](../../releases/latest) | Download the current Windows installer or portable build. |
| [Run from source](RUN_FROM_SOURCE.md) | Start a development build locally. |
| [Security model](SECURITY.md) | Review credential storage, redaction, permissions, and protected actions. |
| [Pterodactyl setup](PTERODACTYL_SETUP.md) | Connect hosted servers through the Pterodactyl Client API. |
| [Scheduler setup](SERVER_SCHEDULER_SETUP.md) | Configure safe warnings, saves, shutdowns, and restart verification. |

---

<!-- FEATURES:START -->
### Nexus feature status

**16 available** · **2 in development** · **4 planned**

> The sections below are generated from [`docs/features.json`](docs/features.json). Edit the registry—not this block—when a feature is added, changes status, or enters the roadmap.

## 🜂 Core Desktop Experience

<details>
<summary><strong>✅ Local-First Desktop Command Center</strong> — Runs the Nexus from a Windows desktop instead of depending on the retired website workflow.</summary>

**Status:** Available

Provides one control surface for Discord automation, game-server operations, modules, updates, diagnostics, and local configuration. Sensitive values are protected through Windows secure storage.

</details>

<details>
<summary><strong>✅ Module Center & Owner Recovery Controls</strong> — Lets the local desktop owner enable, disable, recover, and safely gate app modules.</summary>

**Status:** Available

Includes dependency-aware module switching, Disable All, Safe Mode, validated-module recovery, migration notes, and local controls that remain available even when Discord is offline or misconfigured.

</details>

<details>
<summary><strong>✅ Startup Guard, Watchdog & Recovery</strong> — Protects startup and presents a recovery path instead of leaving the interface frozen.</summary>

**Status:** Available

Uses serialized startup, visible-interface health checks, renderer monitoring, retained watchdog state, software-renderer compatibility, and recovery diagnostics for failed or unresponsive launches.

</details>

<details>
<summary><strong>✅ Windows Installer, Portable Build & Updates</strong> — Ships both installable and portable Windows builds with a protected update flow.</summary>

**Status:** Available

Publishes installer and portable executables, updater metadata, checksums, mandatory pre-update backups, retryable installation, and an always-visible in-app update center.

</details>

## ⚔️ Discord Operations

<details>
<summary><strong>✅ Supervised Discord Bot Runtime</strong> — Starts, watches, configures, and recovers the Discord bot from inside the desktop app.</summary>

**Status:** Available

Includes spawn-confirmed process supervision, slash-command support, live configuration updates, operator access controls, runtime status synchronization, and error reporting.

</details>

<details>
<summary><strong>✅ Discord Studio & Server Automation</strong> — Builds and manages Discord-facing tools without hand-editing every server element.</summary>

**Status:** Available

Supports Discord Studio workflows, role menus, category and channel automation, module-aware commands and buttons, routed logs, and persistent server panels.

</details>

<details>
<summary><strong>✅ Privacy-Safe Status & Queue Panels</strong> — Publishes persistent game-server information to Discord without exposing protected connection data.</summary>

**Status:** Available

Provides live server status, player summaries, queue information where supported, refresh controls, and privacy-safe output that excludes credentials, IP addresses, and platform identifiers.

</details>

## 🐉 Game Server Control

<details>
<summary><strong>✅ ARK & Generic RCON</strong> — Connects to ARK and other compatible servers through guarded RCON operations.</summary>

**Status:** Available

Supports status checks, announcements, player visibility, save commands, moderation, schedules, and adapter-based command handling without exposing raw credentials to the interface.

</details>

<details>
<summary><strong>✅ Palworld REST & RCON</strong> — Combines Palworld's REST capabilities with RCON-backed administration.</summary>

**Status:** Available

Provides typed server status, connected-player operations, announcements, save and shutdown workflows, Discord delivery, and safe adapter errors.

</details>

<details>
<summary><strong>✅ Rust WebRCON</strong> — Adds dedicated Rust server operations through WebRCON.</summary>

**Status:** Available

Includes vanilla-safe status, players, saves, announcements, moderation, Discord status and queue panels, plus Owner-only raw console access.

</details>

<details>
<summary><strong>✅ Encrypted Pterodactyl Hosting Control</strong> — Controls hosted servers through the Pterodactyl Client API without exposing API keys to the renderer.</summary>

**Status:** Available

Discovers hosted servers, reads resource state, and provides guarded start, restart, stop, and Owner-confirmed emergency kill actions using encrypted credentials and short-lived action tokens.

</details>

<details>
<summary><strong>✅ Cross-Server Players & Moderation</strong> — Shows connected players across selected servers and centralizes guarded moderation.</summary>

**Status:** Available

Supports game/server/name search, reason-required kick actions, Owner-confirmed bans, protected player identifiers, local action history, and short-lived moderation tokens.

</details>

<details>
<summary><strong>✅ Recurring Server Scheduler</strong> — Automates warnings, saves, shutdowns, restarts, and recovery checks on a recurring schedule.</summary>

**Status:** Available

Includes countdown broadcasts, save-before-shutdown protection, game-specific safe shutdowns, provider restart verification, cancellation, interrupted-job recovery, Discord reports, and execution history.

</details>

<details>
<summary><strong>✅ Typed Game Adapter SDK</strong> — Provides a consistent extension layer for adding more games without rebuilding the whole app.</summary>

**Status:** Available

Uses explicit capability manifests, guarded destructive-action policies, stable redacted errors, bounded protocol fixtures, and bridges for Palworld REST, ARK/generic RCON, and Rust WebRCON.

</details>

<details>
<summary><strong>🧪 Satisfactory Dedicated-Server Adapter</strong> — Extends the adapter system to Satisfactory's dedicated-server API.</summary>

**Status:** In development

Development work covers typed server operations, capability reporting, safe administrative actions, and integration with the shared Nexus status and control surfaces.

</details>

## ◆ Mobile, Diagnostics & Reliability

<details>
<summary><strong>✅ Android Companion & Mobile Gateway</strong> — Provides a read-only Android companion with an optional protected connection to the desktop app.</summary>

**Status:** Available

Uses certificate-pinned HTTPS, one-time Owner-approved pairing, P-256 signed requests, hashed device credentials, replay protection, immediate revocation, and Android Keystore storage.

</details>

<details>
<summary><strong>✅ Backups, Monitoring & Support Bundles</strong> — Captures useful diagnostics while keeping secrets out of logs and support exports.</summary>

**Status:** Available

Includes verified local backups, rolling breadcrumbs, unclean-shutdown detection, retained AppData logs, stale-health cleanup, redacted support bundles, and optional HTTPS diagnostics delivery.

</details>

<details>
<summary><strong>🧪 Standalone Installer Diagnostics</strong> — Adds installer-first troubleshooting before the main interface has to load.</summary>

**Status:** In development

Development work provides a dedicated Khaos Nexus Diagnostics launcher, startup environment checks, portable sidecar reporting, and clearer recovery guidance for installation or launch failures.

</details>

## 🌑 Roadmap

<details>
<summary><strong>🌘 Shared Bot Onboarding + Bring Your Own Bot</strong> — Makes one shared multi-server Nexus bot the easiest setup while preserving an advanced custom-bot path.</summary>

**Status:** Planned

The default onboarding flow will connect communities to the managed Nexus bot. Advanced users will be able to supply their own Discord application and token for separate branding or isolation.

</details>

<details>
<summary><strong>🌘 D&D Campaign Workspace</strong> — Adds campaign, character, session, encounter, homebrew, and Discord-channel tools to the Nexus.</summary>

**Status:** Planned

Campaigns will bind to existing Discord channels instead of creating duplicates, with role-aware campaign access and support for user-created or otherwise permitted content imports.

</details>

<details>
<summary><strong>🌘 Website Migration Import</strong> — Helps move supported Khaos Nexus website settings and module data into the desktop app.</summary>

**Status:** Planned

The migration path is intended to classify old data, import supported settings safely, preserve an audit trail, and clearly identify anything that requires manual review.

</details>

<details>
<summary><strong>🌘 Additional Game Adapters</strong> — Expands the Nexus through the typed adapter SDK as reliable server APIs become available.</summary>

**Status:** Planned

Future adapters will reuse the same capability, permission, status, scheduling, moderation, and redaction contracts rather than introducing one-off control paths.

</details>
<!-- FEATURES:END -->

---

## 🩸 Feature Monitor

The README feature list is backed by [`docs/features.json`](docs/features.json), which acts as the project’s feature registry.

- Adding a feature, changing its status, or placing it on the roadmap updates the expandable sections automatically.
- Pull requests verify that the generated README is synchronized.
- Changes to app, bot, renderer, shared, or release-note files produce a reminder when the feature registry was not reviewed.
- Pushes to `main`, weekly checks, and manual runs can regenerate and commit the README when the registry changes.

Run the sync locally with:

```bash
node .github/scripts/sync-readme-features.mjs
```

Verify without changing files:

```bash
node .github/scripts/sync-readme-features.mjs --check
```

---

## 🛡️ Security by Design

Discord tokens, provider credentials, game-server passwords, device credentials, and protected identifiers are never rendered back into the interface after storage. Public Discord output is designed to exclude passwords, IP addresses, platform IDs, and internal user IDs unless a feature explicitly requires a safe display name.

Destructive operations use role checks, exact-name confirmations where appropriate, short-lived internal tokens, audit history, and redacted error handling.

---

## ⚙️ Windows Builds

Stable releases can include:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`
- updater metadata and blockmaps
- SHA-256 checksum manifests

Owner-test builds remain on validation branches until startup, navigation, server operations, Discord delivery, diagnostics, and update behavior pass real-device testing.

---

<div align="center">

### **The Nexus does not remove the chaos. It gives you command of it.**

**Khaos Krew · Khaos Nexus**

</div>
