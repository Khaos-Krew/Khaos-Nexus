# Khaos Nexus 0.1.0 Rebuild

This branch is the active clean rebuild of Khaos Nexus. The previous `0.41.x` stabilization line is preserved as legacy/rollback/reference material rather than the active implementation target.

> **Active implementation branch:** `rebuild/nexus-0.1`  
> **Current package version:** `0.1.0`  
> **Current phase:** rebuild foundation + provider services + Sentinal acceptance + release hardening  
> **Public/stable release:** not established by this branch, package version, CI, deployment, or merge state alone

## Product boundaries

- **Nexus Backend** owns game logic, providers, scheduling hooks, permissions, health and shared contracts.
- **Nexus Sentinal** is the primary Discord interface for normal game-module use through persistent module consoles, setup/reconciliation, friendly module commands, event feeds and deeper controls.
- **Khaos Nexus Desktop** is an Admin Control Center for Discord/Sentinal administration, accounts/access, module/service management, owner testing, diagnostics, recovery, updates and the private Thora bridge.
- **Thora** remains private/local and is bridged from its canonical project rather than duplicated here.
- **Veyra** may remain the dedicated D&D presentation client while D&D logic follows the same backend-first rule.

Routine game logic remains outside Electron and Discord handlers.

## Current implementation state

The rebuild includes the thin Electron Admin Control Center, backend module/runtime foundations, shared scheduler, Discord provisioning/reconciliation, temporary voice lobbies, permission preflight and persistent Sentinal module consoles.

Accounts & Access is merged through PR #288. Read-only provider validation is merged through PRs #290/#291. The staged in-app updater is merged through PR #293 and keeps normal updates on a verified stage → restart/apply → startup-confirm/rollback path instead of rerunning NSIS.

PR #294 adds the Admin Operations wave: Owner Test Center, Sentinal health/admin controls, rank/entitlement synchronization, Discord permission/layout checks, module enable/config controls enforced by the backend runtime, persistent panel refresh, command synchronization, safe Repair Nexus orchestration, and startup-health/loading status.

PR #295 adds backend-first Pokémon GO support with trainer/friend-code, raid RSVP, trade matching, Vivillon, collection/showcase, meetup/event, raid-counter/PvP guidance and a persistent operations panel without Pokémon GO credentials or game-client automation. PR #298 adds friendly per-module slash commands while retaining the generic backend route for compatibility, and PR #300 fixes Discord command-schema ordering before registration.

PR #299 adds universal Sentinal event/schedule posting. Absolute times use Discord-local timestamps, persistent feeds are edited/deduplicated, and supported feeds cover Pokémon GO, Warframe, Division 2, ARK, Palworld, Minecraft, Rust and Satisfactory where dated data exists. Pokémon GO official event/news ingestion is credential-free.

PR #301 adds exact-match discovery for existing supporter-rank roles and Premium App SKUs without overwriting configured mappings. PR #304 supersedes the earlier module-access proposal with merged self-reconciling module access roles and conservative rules-link cleanup, while PR #305 adds explicit warning diagnostics for live Discord hierarchy/configuration blockers.

PR #306 supersedes the earlier draft Thora-control proposal with the current private sidecar bridge: Nexus can discover current/future Thora executables, report component readiness and invoke only allowlisted launch targets while keeping Thora household data outside Nexus.

PR #307 is now merged: if an existing module-named Discord role is above Sentinal in the hierarchy, Nexus preserves it and creates/reuses a manageable `<Module> Access` role instead. PR #309 is also merged and hardens staged-update publisher SHA-256 verification by removing the remaining `Get-FileHash` dependency; it does not publish an update or release.

The latest exact merged implementation head with completed rebuild validation is PR #309 head `cfde3c530e8752c4cdf55bec52b0eb7d5aeac734`: **Nexus Rebuild CI run #201 passed**. PR #307 head `ddc86bd21694efd2a08e108abf22ec1eeb73bbf6` also passed **run #200** before merge. This is automated evidence only; owner acceptance, real-guild behavior, live-provider correctness, Thora owner validation and public/stable release remain separate gates.

Open PR #310 is the current secure desktop-to-hosted-Sentinal pairing proposal. Its exact head `40e598a8cc93b4ddd425813b6f91327156c3122d` passed **Nexus Rebuild CI run #204**, but the PR is not merged and hosted pairing is therefore not part of the active baseline yet. Earlier pairing PRs #302/#308 are superseded by this current-baseline proposal.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, safe Repair Nexus flow and current Thora sidecar bridge while preserving exact commit/artifact correlation.
- **Next — Provider-backed game services:** providers, guarded read-only validation and event feeds are merged; exercise Palworld first, then other supported providers, and validate Pokémon GO's credential-free official event feed against live public data and real Discord presentation.
- **Then — Sentinal operational acceptance:** setup/repair, persistent panels, friendly commands, event feeds, rank/SKU discovery, module-access reconciliation, warning diagnostics and the protected-role fallback are merged; validate them on the real guild. Hosted desktop-to-Sentinal pairing remains pending in PR #310.
- **Release hardening:** staged updating, updater hash hardening and the Owner Test Center are merged; next validate a real installed Owner Test update through download, verification, staging, explicit restart/apply, startup confirmation and rollback while keeping NSIS for first install/recovery.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services, keep routine game dashboards out of the desktop, keep Thora bridged from its canonical private project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

The earlier self-hosted web + Windows Agent roadmap is no longer the immediate successor phase for Nexus 0.1.

## Start

1. Copy `config.example.json` to `config.json`.
2. Fill the required Discord configuration.
3. Set `NEXUS_SENTINEL_TOKEN` in the environment.
4. Set `NEXUS_BACKEND_TOKEN` to a strong shared secret when Sentinal and backend are separate processes.
5. Run `npm install`.
6. Run `npm run backend`.
7. Run `npm run sentinel`.
8. Run `npm start` for the Admin Control Center.

For the rebuild boundary and migration rules, see [`REBUILD_SCOPE.md`](REBUILD_SCOPE.md). For Discord module provisioning and reconciliation, see [`docs/SENTINAL_DISCORD_MODULE_SETUP.md`](docs/SENTINAL_DISCORD_MODULE_SETUP.md).