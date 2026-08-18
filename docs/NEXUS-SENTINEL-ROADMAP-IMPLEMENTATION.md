# Nexus Sentinel — Full Roadmap Implementation Contract

This document records what the `split/nexus-sentinel` Windows product must implement before it can be called roadmap-complete. D&D is deliberately outside this product and is not part of any acceptance gate here.

## Completion vocabulary

- **Implemented / CI verified** — the feature has a real backend path and automated tests/build gates can verify its behavior without external credentials.
- **Implemented / live validation required** — the feature has a real backend path, safety controls and automated unit/integration coverage, but final acceptance requires the owner's actual Discord or Palworld environment.
- **Deferred** — intentionally outside the current Discord + Palworld product and hidden/disabled rather than represented as complete.

## Phase matrix

| Phase | State | Implementation |
|---|---|---|
| 0 — Product boundary & first launch | Implemented / CI verified | Sentinel-only startup graph, D&D/deferred navigation suppression, Palworld-only server scope, single-instance reveal, installed + portable packaging |
| 1 — Command Center & Readiness | Implemented / CI verified | Live state-driven readiness, safe local self-test, verified backup creation, explicit live-test controls, acceptance test-path dashboard |
| 2 — Discord identity & Sentinel runtime | Implemented / live validation required | Protected bot token, owner/operator OAuth, supervised Sentinel worker, slash registration, start/stop/restart/crash recovery |
| 3 — Discord community operations | Implemented / live validation required | Embed Studio, role menus, color roles, additive organization, audit logging, observability, persistent message update paths |
| 4 — Palworld registration & read-only health | Implemented / live validation required | Palworld-only configuration, REST/RCON transport, status, players, settings, metrics, snapshot summary, read-only connection testing |
| 5 — Palworld guarded operations | Implemented / live validation required | Nexus Core command gateway, capability checks, idempotency, save, broadcast, kick, ban, unban, delayed shutdown, confirmed force-stop, guarded raw console |
| 6 — Players, moderation & status panels | Implemented / live validation required | Privacy-safe player projection, short-lived moderation tokens, persisted moderation history without raw player identifiers, persistent status message create/update/recovery |
| 7 — Runtime Modules | Implemented / CI verified | Current-scope catalog, Operational/Migrate in progress/Disabled/Blocked states, dependency blocking, owner toggles, deferred modules impossible to enable |
| 8 — Owner access & Application Monitor | Implemented / CI verified | Owner-only Monitor UI and backend actions, redacted error capture, local queue, optional GitHub delivery, protected token handling |
| 9 — Backups, recovery, logs & diagnostics | Implemented / CI verified | Verified manual/automatic backup, restore, retention, lockout recovery, Safe Recovery, interface watchdog, crash diagnostics, redacted export, log retention |
| 10 — Sentinel update experience | Implemented / CI verified for staging and rollback logic; release-to-release live validation required | Dedicated `vX.Y.Z-sentinel` channel, exact asset contract, SHA-256 manifest, background staging, verified pre-update backup, previous-build snapshot, startup-health acceptance, automatic rollback |

## Phase 10 release contract

A production Sentinel release uses exactly:

- tag: `vX.Y.Z-sentinel`
- installer: `Khaos-Nexus-Sentinel-Setup-X.Y.Z-x64.exe`
- portable: `Khaos-Nexus-Sentinel-Portable-X.Y.Z-x64.exe`
- checksum manifest: `Khaos-Nexus-Sentinel-X.Y.Z-sha256.json`

The updater must reject generic Khaos Nexus releases, D&D releases, roadmap/test labels, drafts and prereleases.

Before replacing the running build it must:

1. download the exact Sentinel asset for the current installation mode;
2. verify its SHA-256 against a trusted release digest or the release checksum manifest;
3. create and verify a `pre-update` Nexus backup;
4. snapshot the currently running executable/install directory as the rollback target;
5. apply the new build only after the above gates succeed;
6. launch the new build with an explicit update-health marker;
7. wait for critical startup-health acceptance;
8. automatically terminate and restore the previous build if the new build crashes, fails a critical startup check or times out;
9. relaunch the restored build after rollback.

## External acceptance is not simulated

CI does not invent a Discord bot login, Palworld server, player, moderation target or production release. The following final validations happen against the owner's environment after the Windows artifact is green:

- Discord OAuth and command registration
- `/ping`, `/health`, `/status`, `/players`, and remaining live commands
- Discord channel/role/menu publishing and idempotent reconciliation
- Palworld REST/RCON connectivity
- real save/broadcast/moderation/shutdown operations
- persistent status panel recovery against real Discord messages
- one real Sentinel-to-newer-Sentinel update after two production releases exist

A failure in live validation is treated as a roadmap defect to fix; it is not reclassified as deferred work.

## Ship rule

The full-roadmap Windows artifact may be offered for home testing only after:

1. source syntax checks pass;
2. the focused Sentinel/Discord/Palworld/update regression suite passes;
3. installer and portable executables build;
4. the checksum manifest is generated and contains both Windows assets;
5. the packaged portable executable launches successfully;
6. startup health has no critical failure;
7. the final renderer proves the Sentinel product boundary, Palworld-only server selection, populated operational Module Center and protected update panel.
