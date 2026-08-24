# Khaos Nexus 0.1.0 Rebuild

This branch is the active clean rebuild of Khaos Nexus. The previous `0.41.x` stabilization line is preserved as legacy/rollback/reference material rather than the active implementation target.

> **Active implementation branch:** `rebuild/nexus-0.1`  
> **Current package version:** `0.1.0`  
> **Current phase:** rebuild foundation + provider services + Sentinal acceptance + release hardening  
> **Public/stable release:** not established by this branch, package version, CI, deployment, or merge state alone

## Product boundaries

- **Nexus Backend** owns game logic, providers, scheduling hooks, permissions, health, and shared contracts.
- **Nexus Sentinal** is the primary Discord interface for normal game-module use through persistent consoles, setup/reconciliation, friendly commands, event feeds, self-role/rank surfaces, private reporting, and deeper controls.
- **Khaos Nexus Desktop** is an Admin Control Center for Discord/Sentinal administration, accounts/access, module/service management, owner testing, diagnostics, recovery, updates, and the private Thora bridge.
- **Thora** remains private/local and is bridged from its canonical project rather than duplicated here.
- **Veyra** may remain the dedicated D&D presentation client while D&D logic follows the same backend-first rule.

Routine game logic remains outside Electron and Discord handlers.

## Current implementation state

The rebuild includes the thin Electron Admin Control Center, backend module/runtime foundations, shared scheduler, Discord provisioning/reconciliation, temporary voice lobbies, permission preflight, persistent Sentinal module consoles, household Accounts & Access, guarded read-only provider validation, staged updating, Admin Operations / Owner Test Center, backend-first Pokémon GO, friendly per-module commands, universal event/schedule feeds, supporter-rank handling, self-reconciling module access roles, hosted Sentinal pairing, guided Setup Center, hosted provider synchronization, Discord Admin acceptance tooling, Discord Server Shop rank authority, private safe-space reporting, and milestone patch-note publishing.

Current game modules include **ARK, Palworld, Minecraft, Warframe, Division 2, Rust, Satisfactory, IdleOn, Nexus D&D, Pokémon GO, Call of Duty, Dead by Daylight, and Diablo IV**.

Provider-backed companion work includes capability-driven module help, read-only Warframe Archon Hunt data, the interactive `/ark tame` wizard, Pokémon GO event/operation surfaces, Dead by Daylight public/community reads through Tricky/NightLight, and safe/local Call of Duty and Diablo IV companion surfaces that deliberately avoid undocumented protected player-data routes or nonexistent live character/inventory APIs.

**Sentinal now owns the role/self-role authority path.** The merged chain covers unified self-role/color menus (#329), legacy discovery/migration (#330/#331), old button-menu adoption (#335), safe target diagnostics/aliases (#339/#341), Name Color swatch preservation and restart recovery (#342/#343), strict module access policy (#344), application-owned live-role-hex color swatches (#345/#346), owner-approved platform-role/LFG/legacy-panel cleanup (#351), Guild Members intent corrections (#352–#354), and serialized reconciliation after live cleanup (#355).

Live evidence records the **Sentinal Discord Role Authority section as accepted at 100%** with 11 current self-role menus, 120 active role options, duplicate platform roles removed, zero legacy reaction candidates remaining, module access healthy at 10 roles / 1 menu / 0 warnings, and moderation hierarchy preserved. This accepts that subsection only; it does not complete the broader Sentinal operational phase. PR #356 contains the corresponding public 100% milestone patch note but remains open/unmerged.

**Persistent Sentinal panels and module layout are also hardened.** PR #347 made managed hubs/live feeds deployment-idempotent and #349 added bounded startup acceptance telemetry. PR #357 then added backend-first Call of Duty, Dead by Daylight, and Diablo IV modules with dedicated Discord categories/access roles plus alphabetical game-category reconciliation above protected Staff/Hidden boundaries. PR #358 fixed the resulting category insertion-order regression and makes missing managed hub embeds create/self-heal automatically during startup/periodic reconciliation.

PR #358 head `e2c7e89e355b1ec103292afa975f4715237fd20c` is the newest exact merged implementation head with completed validation: **Nexus Rebuild CI run #344 passed**. PR #357 head `e5fae99ccb859792253e6233db3d3af2fcf4ed99` passed run #342 before merge. This is automated evidence only; real-guild/provider/owner acceptance and public/stable release remain separate gates.

The current [`Discord + Nexus Setup Acceptance`](docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md) checkpoint remains active. Role authority has live acceptance evidence, but the expanded game-module layout, managed hub self-healing/idempotency, module access isolation, reporting, moderation, pairing, provider flows, Setup Center acceptance, and restart behavior still need real-guild/owner confirmation.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, safe Repair Nexus flow, and current Thora bridge.
- **Next — Provider-backed game services:** providers, authenticated hosted sync, read-only validation, event feeds, ARK taming, Pokémon GO, Warframe Archon Hunt, Dead by Daylight public/community reads, and safe/local Call of Duty/Diablo IV companion surfaces are merged; validate them in real provider/Discord use without treating CI as live acceptance.
- **Then — Sentinal operational acceptance:** the role-authority subsection is live-accepted at 100%; broader acceptance still requires the new game categories/roles/hubs, module visibility, hub/feed idempotency, reporting, moderation, pairing, provider flows, Setup Acceptance, commands/help, and restart behavior to pass in the intended guild/Railway environment.
- **Release hardening:** staged updating, updater/rebuild-CI hash hardening, and the Owner Test Center are merged; next validate a real installed Owner Test update through download, verification, staging, explicit restart/apply, startup confirmation, and rollback while keeping NSIS for first install/recovery.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and safe companion reads, keep routine game dashboards out of the desktop, keep Thora bridged from its canonical private project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

The earlier self-hosted web + Windows Agent roadmap is no longer the immediate successor phase for Nexus 0.1.

## Historical stabilization line

PR #266 on `stabilize/nexus-66-baseline` remains open, draft, mergeable, and unmerged. Its historical owner-test identity remains `0.41.2.1` visible / `0.41.3-test.1` internal / channel `owner-test` / rollback `v0.41.2-B`.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. It is historical stabilization evidence only and does not validate Nexus 0.1.

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