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

PR #295 adds backend-first Pokémon GO support. PR #298 adds friendly per-module slash commands, PR #299 adds universal Sentinal event/schedule posting with Discord-local timestamps and persistent feeds, and PR #300 fixes Discord command-schema ordering before registration.

PR #301 adds discovery for existing supporter-rank roles. PR #313 supports recurring subscription and durable one-time Premium App SKUs when that authority mode is explicitly configured. **PR #320 restores the intended default paid-rank authority for the current guild: Discord Server Shop Premium Roles.** With no paid `rankSkus` mappings configured, the five paid ranks are Server Shop-managed, Nexus protects those paid roles from entitlement reconciliation, and Nexus manages only the free Shadow Recruit baseline. PR #321 aligns the desktop discovery/admin UI with that authority so Server Shop roles are no longer presented as missing Premium App SKUs.

PR #304 provides self-reconciling module access roles, PR #305 adds live hierarchy/configuration warnings, and PR #307 preserves protected module-named roles above Sentinal by creating/reusing manageable `<Module> Access` roles instead.

PR #306 provides the current private Thora sidecar bridge while keeping Thora household data outside Nexus. PR #310 adds secure hosted desktop-to-Sentinal pairing with short-lived one-time codes and protected storage for the long-lived admin credential. PR #312 minimizes the public hosted health surface and requires a strong token for non-loopback binding.

PR #314 adds administrator-only Sentinal moderation. PR #315 adds the guided first-run Setup Center for backend, hosted pairing, household Owner access, rank authority/discovery, Discord acceptance, provider configuration and read-only provider validation.

PR #316 adds authenticated provider configuration synchronization from the desktop to the paired Railway-hosted Sentinal backend. Provider credentials are resolved only in the Electron main process, sent over the paired HTTPS admin channel, encrypted at rest on the persistent Railway volume, and never exposed to the renderer. Hosted providers can be replaced live and exercised through the existing predefined read-only validation probes; Setup Center can use hosted sync/validation evidence.

PR #317 aligns hosted provider persistence with Sentinal by making provider state honor `NEXUS_DATA_DIR`, and adds the dedicated [`Discord + Nexus Setup Acceptance`](docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md) checkpoint.

PRs #318 and #319 harden the Owner acceptance scan path: realistic operation-specific deadlines, Nexus-specific timeout classification, and real per-section findings instead of generic `Operation failed.` output. Owner testing then showed every surfaced acceptance section green except Rank / SKU discovery; PRs #320/#321 establish that remaining red section was a false gate caused by treating Discord Server Shop Premium Roles as if they had to be Nexus Premium App SKUs.

PR #323 makes module `Commands / Help` capability-driven, grouping backend-defined features by player, operator/admin and owner authority so future backend capabilities become discoverable without maintaining a second Discord help system. PR #324 recovers a safe read-only ARK taming planner behind the backend service contract with `/ark tame`, rate-aware rough estimates and Dododex deep links. PR #325 adds read-only Warframe Archon Hunt data through the existing public Warframe provider and friendly `/warframe archon` command. These companion slices do not add game account credentials or move domain logic into Discord handlers.

PR #309 and PR #311 harden staged-update/update-bundle SHA-256 verification by removing the remaining `Get-FileHash` dependencies from those paths in favor of direct .NET hashing. None of these changes publishes an update or release by itself.

The latest exact merged implementation head with completed rebuild validation is **PR #325 head `8a0094f2fd11ed3db1ff40e0ba66c9f98afd63d4`**: **Nexus Rebuild CI run #251 passed**. PR #324 head `086bc8b372f87deeb158072646d691baec6bda8e` passed run #249, PR #323 head `e02700cbc3adb9c9a45ede9874a4cabaabbe5976` passed run #247, and PR #321 head `1aa71b57cb4b40ab29502990737315ee84524ad8` passed run #242. This is automated evidence only; final owner acceptance, live-provider correctness, real hosted provider synchronization/persistence, explicit fresh-code hosted-pairing validation, updater apply/rollback success, Thora owner validation and public/stable release remain separate gates.

The current Discord + Nexus Setup Acceptance checkpoint records successful hosted evidence from the PR #316 Railway deployment and partial Owner interaction evidence from 2026-08-24. The desktop-hosted Discord admin path reached Sentinal successfully, reported 5/5 permissions, completed the hosted scan transport successfully, and exposed real per-section findings. The only surfaced red section was Rank / SKU discovery, which was traced to the authority mismatch repaired by PRs #320/#321. The next acceptance step is one confirmation scan on the PR #321 implementation, followed by the remaining fresh pairing, provider sync/validation, live repair where needed, and restart-persistence gates.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, hosted provider synchronization, safe Repair Nexus flow and current Thora sidecar bridge while preserving exact commit/artifact correlation.
- **Next — Provider-backed game services:** providers, authenticated hosted provider sync, persistent hosted-provider path alignment, guarded read-only validation, event feeds, capability-driven module help, ARK taming planning and Warframe Archon Hunt reads are merged; synchronize the intended provider configuration to Railway, exercise Palworld first, then other supported providers, and validate the new read-only companion surfaces in real Discord usage.
- **Then — Sentinal operational acceptance:** Owner testing reached the real per-section scan and found only the now-corrected Server Shop rank-authority false gate; re-run on the PR #321 implementation, confirm that section is green, then complete the remaining Discord + Nexus Setup Acceptance gates on the intended guild/Railway instance, including discovery through the capability-driven help surface.
- **Release hardening:** staged updating, updater/rebuild-CI hash hardening and the Owner Test Center are merged; next validate a real installed Owner Test update through download, verification, staging, explicit restart/apply, startup confirmation and rollback while keeping NSIS for first install/recovery.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and safe companion reads, keep routine game dashboards out of the desktop, keep Thora bridged from its canonical private project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

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