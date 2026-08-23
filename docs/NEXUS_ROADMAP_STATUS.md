# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Repository: `Khaos-Krew/Khaos-Nexus`  
Active implementation branch: `rebuild/nexus-0.1`

## Purpose

This file is the canonical roadmap/status handoff for the active Nexus rebuild. README roadmap claims must be synchronized from repository reality plus this document, not from the superseded 0.41.x stabilization plan, old release notes, rejected test builds, or chat memory.

Do not describe a capability as complete, validated, released, or production-ready merely because code exists. Verify implementation, tests/workflows, owner-test evidence, and actual release state separately.

## Current product line

- Active implementation line: **Nexus 0.1 rebuild**
- Current package version: **0.1.0**
- Active branch: `rebuild/nexus-0.1`
- Previous `0.41.x` stabilization line: **preserved legacy / rollback / reference only for this rebuild direction**
- PR #266 / `stabilize/nexus-66-baseline`: **historical stabilization work; not the active implementation target for Nexus 0.1**
- No public/stable Nexus 0.1 release is established by the rebuild branch or package version alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; the numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved post-stabilization architecture change and its subsequent clean-rebuild decision.

The active target is now:

- **Nexus Backend** — game logic, provider integrations, shared module contracts, permissions, health, scheduling hooks, and backend service routing.
- **Nexus Sentinal** — primary day-to-day Discord interface for game modules through persistent module consoles, setup/reconciliation, interactive controls, and deeper commands.
- **Khaos Nexus Desktop** — privileged Admin Control Center for Discord/Sentinal administration, account/access linking, backend/module/service configuration, diagnostics, logs, recovery, updates, scheduler administration, integrations, and the private Thora bridge.
- **Veyra** — may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- **Thora** — remains private/local and should be bridged from its canonical project rather than duplicated into Nexus.

The earlier incremental thinning strategy is superseded for the Nexus 0.1 line. Legacy code remains available as reference material and may be selectively ported only when it fits the new boundaries and has focused regression coverage.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` currently establishes:

- package identity `0.1.0` and an Electron Admin Control Center entrypoint;
- backend and Sentinal runtime scripts;
- a backend module catalog/registry covering ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn, and D&D;
- concrete backend provider implementations for Division 2, Palworld, Warframe, Rust, Satisfactory, and IdleOn, plus shared HTTP, Source RCON, server-provider, and native-provider transport foundations;
- a shared backend scheduler implementation rather than per-module duplicate schedulers;
- provider/domain regression tests covering provider behavior, server providers, Warframe, Division 2, scheduler behavior, module contracts, module consoles, provisioning, permissions, and backend runtime behavior;
- persistent Sentinal module-console rendering and interaction routing;
- `/nexus setup`, `/nexus repair`, `/nexus repair-all`, `/nexus modules`, `/nexus refresh`, and advanced `/nexus run` command surfaces;
- Discord module provisioning/reconciliation that can reuse or create module categories/channels;
- join-to-create temporary voice lobby behavior with persisted topology/lobby ownership;
- Administrator permission preflight for Sentinal provisioning while setup authorization remains separately restricted to configured owner or Discord Manage Server authority;
- merged household Accounts & Access support from PR #288, including first-account Owner / additional Co-Owner roles, Discord OAuth linking, one-time pairing codes, Sentinal `/nexus link` and `/nexus account`, and protected credential handling;
- a merged authenticated read-only provider-validation endpoint from PR #290 with predefined non-destructive viewer probes, redacted results, and safe skipping for disabled/unconfigured providers;
- a merged Admin Control Center **Live Provider Validation** panel from PR #291 that invokes the backend validation endpoint rather than providers directly and exposes PASS / SKIPPED / FAIL without provider payload data;
- Palworld selected as the first recommended real-provider acceptance target for the read-only validation flow;
- private Thora launch/status bridge boundaries; deeper private Thora controls are currently proposed in draft PR #292 and are not yet part of the active branch;
- dedicated rebuild CI and Windows build workflow definitions;
- a self-contained Admin Control Center owner-test installer path with desktop and Start Menu shortcuts.

These are implementation facts, not release or owner-acceptance claims. The presence of provider code, account-linking code, validation UI, and automated tests does not establish live-provider correctness, production credentials, real-server compatibility, owner acceptance, or release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION STILL REQUIRED**

The original packaged rebuild baseline was PR #287 at `5624e7628581f1f8f89d09cfb873564317ebf58a`. Since then, Accounts & Access (PR #288), the read-only provider-validation backend (PR #290), and its Admin Control Center UI (PR #291) have merged into `rebuild/nexus-0.1`.

The latest exact implementation head with completed rebuild validation is PR #291 head `88168acd6be4591c96d6e5eaa6b71de98e9556cf`. Nexus Rebuild CI run #151 completed successfully on that exact SHA. Its Linux/test job passed, and its Windows job passed repository checks/tests, `npm run dist:win`, and artifact upload. PR #291 then merged into the rebuild branch as `a7cfcdd59083db975137945ac6f48027668bc659`; no separate workflow run is recorded on that merge commit, so validation claims remain tied to the exact tested PR head rather than inferred from merge state.

This automated evidence establishes that the merged Accounts & Access plus read-only provider-validation/UI slice passed the normal rebuild test and Windows packaging gate. It does **not** establish successful Discord OAuth/pairing on the owner household, successful live Palworld/provider communication, owner acceptance, or public/stable release readiness.

Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not claim Accounts & Access owner validation until browser OAuth and the second-account pairing flow are exercised in the intended environment;
- do not claim live-provider correctness until provider paths are exercised against real supported services/servers;
- do not claim public/stable release status from CI, packaging, PR merge state, or package version alone;
- do not carry the old 0.41.x twelve-gate numeric stabilization score into the 0.1 rebuild as if it were already applicable;
- define new acceptance gates around the clean rebuild rather than inheriting legacy scores by default.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Goals:

- keep the desktop thin and admin-focused;
- stabilize the backend module contract and capability model;
- keep Sentinal as the primary game-module user surface;
- preserve safe permission, confirmation, redaction, audit, and secret-storage boundaries;
- maintain deterministic Discord provisioning/reconciliation without duplicate channels, consoles, or lobbies;
- owner-test the merged Accounts & Access flows, including browser Discord OAuth and one-time pairing for the second trusted household account;
- exercise the packaged Admin Control Center on the owner Windows environment and record explicit acceptance/failures;
- preserve exact commit/artifact correlation for any subsequent owner-test build.

### Next — Provider-backed game services

Status: **IN PROGRESS — READ-ONLY VALIDATION PATH MERGED; LIVE/OWNER VALIDATION REQUIRED**

Concrete provider implementations and regression coverage exist for several modules. PRs #290 and #291 now provide a guarded read-only backend validation endpoint plus an Admin Control Center validation panel. The next factual gate is live/provider evidence, beginning with the intended Palworld status probe, not more renderer-side game logic.

Goals:

- exercise Palworld and then other supported providers through the predefined read-only validation probes against real configured services;
- continue connecting and hardening module-specific provider transports behind the shared backend contract;
- keep destructive provider operations outside validation and preserve explicit capability/permission/confirmation boundaries;
- prove provider behavior against focused real/provider environments without reintroducing game logic into Electron or Discord handlers;
- preserve shared scheduler authority and avoid per-module duplicate schedulers;
- expand domain-level tests independent of Discord rendering;
- record explicit capability limitations when a provider or game cannot expose a requested live function safely or reliably.

### Then — Sentinal operational acceptance

Status: **PLANNED**

Goals:

- validate `/nexus setup` and reconciliation on a real guild;
- validate persistent module consoles, permissions, confirmations, degraded-backend behavior, and restart recovery;
- validate temporary lobby lifecycle and cleanup;
- verify common game workflows are discoverable without memorizing slash commands;
- validate Veyra/D&D presentation against the backend-first boundary.

### Release hardening

Status: **PLANNED**

Goals:

- establish one authoritative rebuild release identity and artifact naming policy;
- keep tested commit, installer artifact, updater metadata, release notes, and rollback target correlated;
- verify Windows installer behavior, protected configuration, diagnostics/recovery, and update paths;
- create owner-test artifacts only after exact-head automated validation;
- keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Direction:

- selectively port only legacy behavior that fits the backend/admin/Sentinal architecture;
- expand provider-backed game services and capability-driven Discord module consoles;
- thin or omit routine game dashboards from the desktop rather than rebuilding the old renderer surface;
- integrate Thora only through the approved private bridge; draft PR #292 is the current proposal for deeper owner-household Thora controls and must not be described as merged until it actually is;
- consider any future web/public surface only if it supports this architecture and does not become a second authority for protected machine operations.

The previous roadmap's self-hosted web + Windows Agent migration is not the immediate successor phase for Nexus 0.1 and must not be presented as the current next step.

## Historical stabilization record

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical and rollback evidence. They are not deleted or invalidated; they are superseded as the active implementation direction by the owner-approved clean Nexus 0.1 rebuild.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting 8 passed, 0 warnings, and 0 failures. It is historical evidence for the legacy line and is not validation of Nexus 0.1. No newer meaningful `[Owner Test …]` or `[Startup Diagnostics …]` failure was found during the 2026-08-23 roadmap synchronization.

Do not import legacy branches wholesale. Port specific behavior only after architectural fit and focused test coverage are established.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
