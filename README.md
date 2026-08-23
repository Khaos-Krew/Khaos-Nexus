# Khaos Nexus 0.1.0 Rebuild

This branch is the active clean rebuild of Khaos Nexus. The previous `0.41.x` stabilization line is preserved as legacy/rollback/reference material for this rebuild direction rather than the active implementation target.

> **Active implementation branch:** `rebuild/nexus-0.1`  
> **Current package version:** `0.1.0`  
> **Current phase:** rebuild foundation + provider validation + release hardening  
> **Public/stable release:** not established by this branch or package version alone

## Product boundaries

- **Nexus Backend** owns game logic, provider integrations, scheduling hooks, permissions, health and shared contracts.
- **Nexus Sentinal** is the primary Discord interface for normal game-module use through persistent module-console embeds, module setup/reconciliation and deeper commands.
- **Khaos Nexus Desktop** is an Admin Control Center: Discord/Sentinal administration, account/access linking, module/service management, diagnostics, recovery, integration configuration and the private Thora bridge.
- **Thora** remains a private/local capability and is bridged from its canonical project rather than duplicated here.
- **Veyra** may remain the dedicated D&D presentation client while D&D logic follows the same backend-first rule.

The rebuild intentionally keeps routine game logic out of Electron and Discord handlers. Legacy code is reference material, not an automatic dependency.

## Current implementation state

The rebuild includes the thin Electron Admin Control Center, backend module/runtime foundations, shared scheduler, module registrations for ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn and D&D, persistent Sentinal module consoles, Discord provisioning/reconciliation, temporary voice lobbies and permission preflight.

Concrete backend providers are present for Division 2, Palworld, Warframe, Rust, Satisfactory and IdleOn, with shared HTTP, Source RCON, server-provider and native-provider foundations.

Accounts & Access is merged through PR #288: household Owner/Co-Owner records, Discord OAuth linking, one-time pairing codes, and Sentinal `/nexus link` / `/nexus account` flows are implemented. Owner-environment OAuth and second-account pairing still require explicit validation.

Provider validation is also merged. PR #290 added an authenticated read-only backend validation endpoint with predefined viewer-safe probes, and PR #291 exposed it in the Admin Control Center as **Live Provider Validation** without moving provider logic into the renderer. Palworld is the first recommended real-provider acceptance target.

PR #293 adds the staged in-app updater. Approved updates are downloaded as verified full-payload bundles, staged while Nexus remains usable, and applied only after explicit Owner restart. Normal updates do not rerun the NSIS installer; an external helper backs up replaced files, applies the staged payload, waits for startup confirmation, and can restore the previous files if the updated build fails to confirm startup. Owner Test and Stable update channels remain separate.

The latest exact implementation head with completed rebuild CI is PR #293 head `6350dafb70cd9bd69507acb90b8c34c33e98a883`: Nexus Rebuild CI run #163 passed. The test job passed repository checks/tests, and the Windows job passed repository checks/tests, updater PowerShell syntax validation, `npm run dist:win`, `npm run dist:update`, update-manifest/hash verification, payload extraction verification, and artifact upload. This is automated build/package/update-bundle evidence only; live-provider validation, installed updater apply/rollback validation, owner acceptance and public/stable release remain separate gates.

Draft PR #292 proposes deeper private Thora controls for the owner household. It is not merged and is not part of the active implementation baseline yet.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center plus merged Accounts & Access flows while continuing to stabilize the thin admin desktop, backend contract, Sentinal setup/reconciliation, permissions/redaction boundaries and exact commit/artifact correlation.
- **Next — Provider-backed game services:** the guarded read-only validation path is merged; exercise Palworld first and then other supported providers against real configured services while keeping destructive actions outside validation and game logic out of Electron/Discord handlers.
- **Then — Sentinal operational acceptance:** validate `/nexus setup`, persistent consoles, degraded-backend behavior, permissions/confirmations, restart recovery, temporary lobby lifecycle and Veyra/D&D presentation on real Discord infrastructure.
- **Release hardening:** staged in-app updating is merged and automated bundle verification is green; next validate a real installed Owner Test update through download, verification, staging, explicit restart/apply, startup confirmation and rollback while keeping NSIS for first install/recovery.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand capability-driven game services, keep routine game dashboards out of the desktop, integrate Thora through the approved private bridge, and consider future web/public surfaces only when they support rather than duplicate protected authority.

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
