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

The rebuild includes the thin Electron Admin Control Center, backend module/runtime foundations, shared scheduler, Discord provisioning/reconciliation, temporary voice lobbies, permission preflight, persistent Sentinal module consoles, household Accounts & Access, guarded read-only provider validation, staged updating, Admin Operations / Owner Test Center, backend-first Pokémon GO, friendly per-module commands, universal event/schedule feeds, supporter-rank handling, self-reconciling module access roles, hosted Sentinal pairing, guided Setup Center, hosted provider synchronization, Discord Admin acceptance tooling, and Discord Server Shop rank authority.

Provider-backed companion work includes capability-driven module help, read-only Warframe Archon Hunt data, and the merged interactive `/ark tame` wizard with creature/rate input, KO/tranq planning where appropriate, food/timing guidance, passive-tame handling, and posting to `#ark-tame-info`.

**Sentinal now owns the self-role migration path.** PR #329 unified generic self-role/color menus; PR #330 expanded bounded discovery across older role/self-role/reaction/color/notification channels; **PR #331 merged safe migration of older emoji reaction-role messages into Sentinal buttons**; and **PR #335 merged direct adoption of the visible old Khaos Nexus button menus even when they use older custom IDs**. Existing Discord role/message IDs are reused when safe, duplicate generic roles are avoided, Name Color pages share one exclusive color pool, and legacy controls are retired only after replacement controls are active.

**PR #332 adds the safe-space Rules + private report-ticket system.** Users can open a private report from the Rules panel or `/report`, submit details through a modal, receive a case-ID channel without reporter identity in its name, and work with authorized staff through claim/add/escalate/resolve/close controls. Closed cases create restricted transcripts while report narrative/evidence stays out of routine Sentinal state/log persistence.

**PR #333 adds one-time roadmap milestone patch-note publishing.** Only 66% and 100% milestones are valid, publication is idempotent across restarts/state loss, missing `#patch-notes` leaves the milestone pending, and restricted private-edition content is blocked from public notes. The Community Safety & Reporting implementation milestone is recorded at 100%; live owner acceptance of the report workflow remains a separate gate.

Open follow-up hardening is not part of the accepted baseline until merged and validated. PR #334 narrows reaction-role candidate detection so ordinary reaction polls are not mistaken for role menus. PR #336 proposes a deeper one-time legacy-role history scan plus negative-result caching so Sentinal does not repeat an expensive guild-wide discovery walk every ten minutes when nothing migratable is found.

PR #309 and PR #311 harden staged-update/update-bundle SHA-256 verification. None of these changes publishes an update or release by itself.

The latest exact merged implementation head with completed rebuild validation is **PR #335 head `ab92b519e21466030f6c06e89267e9eb8c2c9c08`**: **Nexus Rebuild CI run #282 passed**. PR #333 head `ab20274db953a5dd2b1dfa2d1825f8ae96d1568b` passed run #279, PR #332 head `9b1dcb994dbb629a9d21d8d74ef3762c71f76136` passed run #274, and PR #331 head `0e46e0b85944ce9c048c0c78d65659f680f537b7` passed run #265. This is automated evidence only; final owner acceptance, live-provider correctness, real hosted provider synchronization/persistence, explicit hosted-pairing validation, live self-role migration/adoption, safety-report acceptance, updater apply/rollback success, Thora owner validation, and public/stable release remain separate gates.

The current [`Discord + Nexus Setup Acceptance`](docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md) checkpoint records successful hosted evidence from the PR #316 Railway deployment and partial Owner interaction evidence from 2026-08-24. The desktop-hosted Discord admin path reached Sentinal successfully, reported the expected permissions, completed the hosted scan transport, and exposed real per-section findings. The false Rank / SKU red section was corrected by PRs #320/#321. Subsequent live role-menu evidence changed the migration diagnosis: PR #331 covers older reaction-role messages, while PR #335 covers the old bot-authored button menus actually visible in the guild screenshots.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, hosted provider synchronization, safe Repair Nexus flow, and current Thora bridge while preserving exact commit/artifact correlation.
- **Next — Provider-backed game services:** providers, authenticated hosted sync, persistent hosted-provider storage, guarded read-only validation, event feeds, capability-driven help, interactive ARK taming, and Warframe Archon Hunt reads are merged; exercise Palworld first, then other supported providers, and validate the companion surfaces in real Discord usage.
- **Then — Sentinal operational acceptance:** unified self-role/color menus, emoji reaction-role migration, direct legacy button-menu adoption, and the private safe-space reporting workflow are merged; complete the remaining Discord + Nexus Setup Acceptance gates on the intended guild/Railway instance and validate the new role/report surfaces live before declaring the old controls retired.
- **Release hardening:** staged updating, updater/rebuild-CI hash hardening, and the Owner Test Center are merged; next validate a real installed Owner Test update through download, verification, staging, explicit restart/apply, startup confirmation, and rollback while keeping NSIS for first install/recovery.
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
