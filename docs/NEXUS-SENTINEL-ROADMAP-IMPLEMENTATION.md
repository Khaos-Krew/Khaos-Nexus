# Nexus Sentinel — Roadmap Implementation Contract

This document records the implementation state of the Windows Discord + Palworld Nexus Sentinel product. D&D and its AI runtime are outside this product and are not part of these release gates.

## Implementation state

All roadmap phases 0 through 10 have an implemented product path in `build/sentinel-roadmap-complete`. A phase can still require live acceptance against the owner's Discord guild or Palworld server; that is validation of the implementation, not unfinished code.

| Phase | Implementation | Live acceptance still required |
|---|---|---|
| 0 Product boundary | Complete | First launch on owner PC |
| 1 Command Center & Readiness | Complete | Run Safe Local Self-Test |
| 2 Discord identity & Sentinel runtime | Complete | OAuth, bot login, slash commands |
| 3 Discord community operations | Complete | Publish/reconcile against test guild |
| 4 Palworld read-only health | Complete | Connect to real Palworld REST/RCON target |
| 5 Palworld guarded operations | Complete | Save/broadcast/moderation/shutdown on safe target |
| 6 Players & status panels | Complete | Repeated live refresh/offline recovery |
| 7 Runtime modules | Complete | Owner toggle/dependency test |
| 8 Owner access & Application Monitor | Complete | Owner/operator identity test |
| 9 Backup/recovery/diagnostics | Complete | Restore and exported-redaction inspection |
| 10 Sentinel updates & rollback | Complete | Upgrade between two published Sentinel versions |

## Current-scope module rule

The current operational module list contains only fully implemented Discord, Palworld server-management, and supporting desktop modules. Partial companion expansion such as Palworld breeding/maps is deferred rather than being presented as a current incomplete module.

The runtime vocabulary remains `Operational`, `Disabled`, and `Blocked` for the completed product. `Migrate in progress` remains understood by the generic module renderer for backwards compatibility, but the packaged RC acceptance gate fails if a current-scope module renders with that state.

## Phase 9 recovery guarantees

New backups keep the existing compatible backup format while adding a SHA-256 integrity manifest and Sentinel product metadata. Restore validates the payload and decryptability of protected secrets before mutation. Restore then performs post-write validation; a failure restores the previous config and secret files instead of leaving a partial profile.

## Phase 10 update guarantees

The old monolithic update kill-switch is removed. The active updater:

1. Scans GitHub releases but accepts only tags matching `vX.Y.Z-sentinel...`.
2. Stable builds ignore prereleases; test channel builds may accept Sentinel prereleases.
3. Installed builds point `electron-updater` at the selected Sentinel release's immutable generic release URL and require `latest.yml` plus the Sentinel setup asset.
4. Portable builds accept only `Khaos-Nexus-Sentinel-Portable-...-x64.exe` and require SHA-256 from GitHub asset digest metadata or an `.exe.sha256` sidecar.
5. Automatic update checks stage/download an available update in the background when automatic checks are enabled; they do not replace the running app automatically.
6. Installation remains an explicit owner action.
7. A verified configuration backup remains mandatory before install.
8. A filesystem rollback snapshot is created before replacement. If that snapshot cannot be created, install is cancelled.
9. An external PowerShell watchdog waits for the new build's startup-health acceptance marker.
10. The new build writes acceptance only after startup health completes with no critical failure.
11. If acceptance never arrives, the watchdog restores the prior portable executable or installed application directory and starts the previous version.

## Release channel

`.github/workflows/sentinel-release.yml` only runs for Sentinel tags. It validates the package/tag version match, reruns the release gates, builds Windows installer and portable assets, generates SHA-256 sidecars, verifies `latest.yml`, then publishes only those Sentinel assets to the tagged release.

## RC1

- App version: `0.33.0`
- Product display: `0.33.0-SENTINEL-RC1`
- Planned release tag: `v0.33.0-sentinel-rc1`
- Windows CI artifact: `Nexus-Sentinel-Complete-Roadmap-RC1`

Do not publish the RC tag until the branch Windows acceptance workflow is green. Do not merge to the stable product branch until the owner's live Discord and Palworld acceptance pass is complete.
