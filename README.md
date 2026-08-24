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

**Sentinal owns the self-role migration path.** PR #329 unified generic self-role/color menus; #330 expanded bounded discovery; #331 added safe migration of older emoji reaction-role messages; and #335 added direct adoption of the old bot-authored Nexus button menus. The live hardening path has now advanced further: **#339 adds exact legacy-button target diagnostics and excludes false positives such as the Community Rules report control and owner-testing poll; #341 deterministically maps five renamed legacy panels to existing roles while refusing ambiguous duplicates and leaving generic `LFG` unresolved; and #342 restores the original custom Discord color-swatch emoji on Name Color buttons while preserving global color exclusivity and safe hierarchy behavior.** Legacy controls are still retired only after replacement controls are active.

**PR #332 adds the safe-space Rules + private report-ticket system.** Users can open a private report from the Rules panel or `/report`, submit details through a modal, receive a case-ID channel without reporter identity in its name, and work with authorized staff through claim/add/escalate/resolve/close controls. Closed cases create restricted transcripts while report narrative/evidence stays out of routine Sentinal state/log persistence.

**PR #333 adds one-time roadmap milestone patch-note publishing.** Only 66% and 100% milestones are valid, publication is idempotent across restarts/state loss, missing `#patch-notes` leaves the milestone pending, and restricted private-edition content is blocked from public notes. The Community Safety & Reporting implementation milestone is recorded at 100%; live owner acceptance of the report workflow remains a separate gate.

Superseded role-migration proposals are not active roadmap items. The earlier #334/#336/#337/#340 follow-ups were overtaken by the merged #339/#341 implementation path.

PR #309 and PR #311 harden staged-update/update-bundle SHA-256 verification. None of these changes publishes an update or release by itself.

The latest exact merged implementation head with completed rebuild validation is **PR #342 head `0702ca5c78faa156022ee45859ec0faf35fde5cb`**: **Nexus Rebuild CI run #296 passed**, and PR #342 merged into `rebuild/nexus-0.1`. PR #341 head `a2e20744a0dc320fb660a074563379332f663081` passed run #294, and PR #339 head `4762480c0d894ecf7eae3bcfa3f506d7d530f701` passed run #291. This is automated evidence only; final owner acceptance, live-provider correctness, real hosted provider synchronization/persistence, explicit hosted-pairing validation, live self-role migration/adoption, safety-report acceptance, updater apply/rollback success, Thora owner validation, and public/stable release remain separate gates.

The current [`Discord + Nexus Setup Acceptance`](docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md) checkpoint records useful hosted and Owner interaction evidence. The role-migration diagnosis is now materially safer and more deterministic, but real-guild acceptance is still pending—especially the remaining generic `LFG` decision, duplicate-role safety, final legacy-control retirement, and end-to-end Name Color behavior.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, hosted provider synchronization, safe Repair Nexus flow, and current Thora bridge while preserving exact commit/artifact correlation.
- **Next — Provider-backed game services:** providers, authenticated hosted sync, persistent hosted-provider storage, guarded read-only validation, event feeds, capability-driven help, interactive ARK taming, and Warframe Archon Hunt reads are merged; exercise Palworld first, then other supported providers, and validate the companion surfaces in real Discord usage.
- **Then — Sentinal operational acceptance:** unified self-role/color menus, reaction-role migration, direct legacy button adoption, exact target diagnostics, deterministic renamed-panel aliases, restored Name Color swatches, and the private safe-space reporting workflow are merged; complete the remaining Discord + Nexus Setup Acceptance gates on the intended guild/Railway instance before declaring old controls retired.
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
