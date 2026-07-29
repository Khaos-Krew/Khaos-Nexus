# Khaos Nexus v0.19.0 Production Audit

**Audit date:** 2026-07-29  
**Base checkpoint:** `test/v0.18.22-full-audit`  
**Candidate:** `agent/v0.19.0-owner-module-control-validated`

## Audit scope

The second full audit was performed after completing the module migration framework, adding Owner module switches and writing the game-integration roadmap.

Reviewed surfaces:

- startup ordering and single-instance behavior;
- preload sandbox and renderer readiness;
- grouped navigation and independent scrolling;
- module migration persistence and dependency resolution;
- Owner enable, disable and bulk modes;
- local access recovery and Discord OAuth lockout prevention;
- IPC authorization and module gating;
- Discord process supervision and live configuration updates;
- slash-command registration and game-specific filtering;
- role-menu, color-role and status-panel buttons;
- Application Monitor queueing and delivery;
- updater and mandatory pre-update backup flow;
- automatic backups, health checks, recovery and maintenance;
- server scheduler safety and interrupted-run reconciliation;
- player moderation and hosted-server action tokens;
- Palworld REST, ARK/generic RCON and RCON endpoint guidance;
- Pterodactyl API capability claims;
- dependency vulnerabilities;
- Windows installer and portable artifact contracts.

## Confirmed findings and repairs

### 1. Module flags were not runtime controls

The previous module center stored state but did not prevent navigation, IPC, timers, Discord commands or old Discord buttons from continuing to operate.

**Repair:** introduced an authoritative module registry, effective dependency state, IPC gating, background-service gating, navigation removal and Discord interaction controls.

### 2. Migrations could overwrite Owner intent

Several extensions promote their own implementation state and could write `enabled = true` during configuration normalization.

**Repair:** Owner choices now live in `general.moduleOverrides`. Every configuration write reconciles migration progress with these overrides, so future migrations cannot silently re-enable a module disabled by the Owner.

### 3. Planned website concepts looked switchable

The old catalog mixed implemented desktop services with website roadmap concepts.

**Repair:** every entry is classified as `implemented`, `partial` or `planned`. Planned entries can retain inventory and notes but cannot become effectively runnable.

### 4. v0.18.22 bypassed the complete Discord runtime chain

The audit wrapper loaded the base bot directly, skipping the entry layer that installs role-menu and status-panel handlers.

**Repair:** the supervised wrapper now loads the complete Discord entry chain. A client-boundary module guard is installed before role and status handlers.

### 5. Live bot configuration was not applied by the base runtime

Desktop extensions sent `config-update`, but the bot did not replace its bootstrap or refresh registered commands.

**Repair:** the bot now mutates the active bootstrap, updates secret-redaction values and re-registers slash commands after module/configuration changes.

### 6. Disabling Discord could have locked out the Owner

A broad Discord module rule also covered desktop OAuth actions. With desktop access control enabled, an Owner could have lost the sign-in path needed to re-enable Discord Runtime.

**Repair:** Discord OAuth login, refresh and logout remain available independently of the bot-runtime module. Bot start/configuration remains module-gated.

### 7. Module rendering could override bot supervisor button state

The first module UI pass enabled or disabled all bot buttons solely from the module flag, potentially conflicting with the current `starting`, `online`, `stopping` or `stopped` state.

**Repair:** module gating now composes with the existing supervisor-state rules rather than replacing them.

### 8. Recovery was unnecessarily dependent on Discord

The legacy catalog made Operator Console depend on both Discord Runtime and Game Server Control.

**Repair:** local recovery, maintenance and server health require Game Server Control but no longer require the Discord bot to remain enabled.

### 9. Hosted-server inventory overstated implemented features

The website inventory listed console, files, backups, databases and subusers while the desktop implementation currently provides encrypted provider profiles, discovery, resources and guarded power controls.

**Repair:** the live catalog now describes only implemented Pterodactyl capabilities. Additional host features remain future work.

### 10. Dashboard module count used legacy flags

The dashboard counter could display the old `general.modules` count instead of effective runtime state.

**Repair:** the authoritative module payload now updates the dashboard metric after every module and application-state refresh.

### 11. Planned modules could still show an Enable button

The backend correctly rejected planned modules, but the detail panel could invite an invalid enable attempt.

**Repair:** planned modules now show **Not Implemented** and cannot be enabled from the Owner detail panel.

### 12. Production dependency audit found vulnerable Discord networking

The added production audit identified a high-severity `undici` advisory range inherited through `discord.js 14.26.4`.

**Repair:** upgraded to `discord.js 14.27.0`, the audited remediation identified by npm. CI now blocks high-severity production dependency advisories.

### 13. Windows artifacts were uploaded without explicit content validation

Packaging success alone did not assert that both expected executables existed and were non-trivial files.

**Repair:** Windows CI now requires the versioned NSIS installer and portable executable, checks that each exceeds 1 MB and emits SHA-256 hashes before upload.

## Owner control behavior

### Individual controls

An Owner can enable or disable every implemented module independently. Disabling a dependency leaves child choices intact but marks them **Blocked** until the dependency returns.

### Disable All

Disables every catalog module while preserving access to the Modules workspace and desktop access-recovery/authentication paths.

### Safe Mode

Enables only:

- Application Monitor;
- Backup & Update Center.

All Discord, server-control and optional automation modules remain disabled.

### Enable Validated

Enables every `implemented` module. `partial` and `planned` modules remain disabled until explicitly completed and reclassified.

## Implemented module inventory

The current desktop build recognizes these as implemented and eligible for Owner control:

- Discord Runtime;
- Game Server Control;
- Palworld Operations;
- ARK Server Operations;
- Operator Console;
- Application Monitor;
- Backup & Update Center;
- Server Scheduler;
- Players & Moderation;
- Server Status Panels;
- Pterodactyl Control;
- Embed Studio;
- Role Menus;
- Color Roles;
- Discord Organization;
- Discord Audit Logging;
- Discord Observability;
- Admin Command Center.

Mobile Companion remains partial and network-disabled. Website-only community, economy, store, creator and companion concepts remain planned rather than falsely represented as complete.

## Automated regression coverage

The suite verifies:

- unique registry IDs and acyclic dependencies;
- availability classification;
- Owner override persistence;
- requested versus effective state;
- planned-module refusal;
- local recovery without Discord;
- OAuth lockout prevention;
- `color` and `colors` menu routing;
- view and IPC decisions;
- module-aware slash-command registration;
- old Discord button blocking;
- expected module-denial filtering;
- startup extension order;
- complete Discord entry restoration;
- live bot bootstrap replacement;
- status-panel button handling;
- monitor delivery limits and timer recovery;
- stale health removal;
- interrupted scheduler recovery;
- updater retry state;
- RCON endpoint validation and guidance;
- scrolling, navigation, watchdog and startup foundations;
- v0.19.0 release identity and notes.

## Release gates

The candidate is not considered deliverable until the exact final source checkpoint passes:

1. production dependency audit at high severity;
2. complete Node behavioral test suite;
3. repository-wide JavaScript syntax check;
4. Windows dependency installation;
5. Windows copy of the complete behavioral suite;
6. Windows syntax check;
7. NSIS installer packaging;
8. portable executable packaging;
9. explicit executable existence, size and SHA-256 verification;
10. artifact upload.

## Manual Owner-device validation still required

Automated checks cannot reproduce the Owner's exact Windows 10 profile, Discord guild permissions, encrypted credential store, hosted-server network paths or GPU driver behavior.

Before stable publication, validate on the Owner PC:

- application reaches the main interface without freezing;
- grouped navigation routes correctly;
- Modules opens while every other module is disabled;
- individual disable/re-enable survives application restart;
- Disable All does not remove Owner sign-in or Modules access;
- Safe Mode leaves diagnostics and backups available;
- Enable Validated restores implemented workspaces;
- Discord Runtime stop/start follows its module switch;
- slash commands disappear and return after module changes;
- role-menu, color-role and status-panel buttons are blocked while disabled and work after re-enable;
- bot PID, uptime and online state remain synchronized;
- Palworld and RCON tests retain protected credentials and clear guidance;
- update center remains visible and requires a verified pre-update backup.

## Deliberate boundaries

- No stable release is automatically published from this audit branch.
- Planned modules are not presented as finished.
- Mobile network transport remains disabled.
- Future game integrations are research candidates, not claimed current support.
- Server-host features are limited to the capabilities actually implemented by each adapter.
