# Khaos Nexus 0.1.0 Rebuild

This branch is the active clean rebuild of Khaos Nexus. The previous `0.41.x` stabilization line is preserved as legacy/rollback/reference material for this rebuild direction rather than the active implementation target.

> **Active implementation branch:** `rebuild/nexus-0.1`  
> **Current package version:** `0.1.0`  
> **Current phase:** rebuild foundation  
> **Public/stable release:** not established by this branch or package version alone

## Product boundaries

- **Nexus Backend** owns game logic, provider integrations, scheduling hooks, permissions, health and shared contracts.
- **Nexus Sentinal** is the primary Discord interface for normal game-module use through persistent module-console embeds, module setup/reconciliation and deeper commands.
- **Khaos Nexus Desktop** is an Admin Control Center: Discord/Sentinal administration, account/access linking, module/service management, diagnostics, recovery, integration configuration and the private Thora bridge.
- **Thora** remains a private/local capability and is bridged from its canonical project rather than duplicated here.
- **Veyra** may remain the dedicated D&D presentation client while D&D logic follows the same backend-first rule.

The first rebuild milestone intentionally establishes clean contracts and Discord wiring before provider-specific ARK/Palworld/etc. transports are selectively ported from legacy branches. Old code is reference material, not an automatic dependency.

## Current implementation state

The rebuild currently includes the thin Electron Admin Control Center, backend module/runtime foundations, a generic provider bridge, module registrations for ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn and D&D, persistent Sentinal module consoles, Discord module provisioning/reconciliation, join-to-create temporary voice lobbies, and Administrator-permission preflight for provisioning.

Presence in the branch is not the same as validation or release acceptance. Dedicated rebuild CI and Windows-build workflows exist, but README status must only call the current head green after exact-head workflow evidence is available.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** stabilize the thin admin desktop, backend module contract, capability model, Sentinal setup/reconciliation, permissions/redaction boundaries, and exact-head CI/Windows packaging.
- **Next — Provider-backed game services:** connect provider transports behind the shared backend contract and prove modules with focused domain tests instead of putting game logic back into Electron or Discord handlers.
- **Then — Sentinal operational acceptance:** validate `/nexus setup`, persistent consoles, degraded-backend behavior, permissions/confirmations, restart recovery, temporary lobby lifecycle, and Veyra/D&D presentation on real Discord infrastructure.
- **Release hardening:** establish one rebuild release identity, correlate tested commit and installer artifacts, validate diagnostics/update/recovery paths, and keep public/stable publication behind a separate explicit owner decision.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand capability-driven game services, keep routine game dashboards out of the desktop, and consider future web/public surfaces only when they support rather than duplicate protected authority.

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
