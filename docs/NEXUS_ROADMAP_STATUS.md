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
- No public/stable Nexus 0.1 release is established by the rebuild branch, package version, CI, deployment, or merge state alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; the numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved clean-rebuild direction.

The active target is:

- **Nexus Backend** — game logic, provider integrations, shared module contracts, permissions, health, scheduling hooks, and backend service routing.
- **Nexus Sentinal** — primary day-to-day Discord interface for game modules through persistent module consoles, setup/reconciliation, short module commands, interactive controls, and deeper commands.
- **Khaos Nexus Desktop** — privileged Admin Control Center for Discord/Sentinal administration, account/access linking, backend/module/service configuration, diagnostics, logs, recovery, updates, scheduler administration, integrations, owner testing, and the private Thora bridge.
- **Veyra** — may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- **Thora** — remains private/local and should be bridged from its canonical project rather than duplicated into Nexus.

Legacy code remains available as reference material and may be selectively ported only when it fits these boundaries and has focused regression coverage.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` currently establishes:

- package identity `0.1.0`, Electron Admin Control Center entrypoint, and Windows NSIS packaging with desktop/Start Menu shortcuts;
- backend and Sentinal runtime scripts, shared backend scheduler, module registry, capability/permission boundaries, health and configuration services;
- module registrations for ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn, D&D, and Pokémon GO;
- concrete backend provider implementations for Division 2, Palworld, Warframe, Rust, Satisfactory, IdleOn, and Pokémon GO, plus shared HTTP, Source RCON, server-provider, and native-provider foundations;
- persistent Sentinal module consoles, Discord provisioning/reconciliation, temporary voice lobbies, and Administrator permission preflight;
- `/nexus setup`, `/nexus repair`, `/nexus repair-all`, `/nexus modules`, `/nexus refresh`, advanced `/nexus run`, and friendly per-module slash-command surfaces while retaining the generic backend route for compatibility;
- merged household Accounts & Access from PR #288, including Owner/Co-Owner roles, Discord OAuth linking, one-time pairing codes, Sentinal `/nexus link` and `/nexus account`, and protected credential handling;
- merged read-only provider validation from PRs #290/#291 with predefined non-destructive viewer probes, redacted PASS/SKIPPED/FAIL results, and Palworld as the first recommended real-provider acceptance target;
- merged staged in-app updater from PR #293 with approved-channel checks, SHA-256/manifest verification, staged full-payload updates, explicit Owner restart/apply, startup confirmation, and rollback helper behavior without rerunning NSIS for normal updates;
- merged Admin Operations wave from PR #294: Owner Test Center, Sentinal health/admin client, rank/entitlement synchronization, Discord permission/layout inspection and repair, module enable/config controls enforced by the backend runtime, persistent panel refresh, command synchronization, safe Repair Nexus orchestration, and startup-health/loading state;
- merged backend-first Pokémon GO module from PR #295 with trainer/friend-code, raid RSVP, trade matching, Vivillon, collection/showcase, meetup/event, raid-counter, PvP weakness, persistent panel, and safe credential-free provider behavior;
- merged friendly Sentinal module commands from PR #298 and the Discord command-schema normalization fix from PR #300;
- merged universal Sentinal event/schedule posting from PR #299, including Discord-local absolute timestamps, persistent deduplicated feeds, official credential-free Pokémon GO news/event ingestion, and feed routing for Warframe, Division 2, ARK, Palworld, Minecraft, Rust, and Satisfactory where dated data exists;
- merged Discord supporter-rank/SKU discovery from PR #301, followed by PR #313's correction so recurring subscription SKUs (type 5) and durable one-time purchase SKUs (type 2) can both map to the same persistent Nexus rank while subscription-group and consumable SKUs remain excluded;
- merged self-reconciling module access roles from PR #304, replacing the superseded PR #297 line and adding conservative rules-link cleanup while preserving unrelated Discord content;
- merged live Sentinal role-reconciliation warning diagnostics from PR #305 so hierarchy/configuration blockers are visible without exposing secrets;
- merged current Thora sidecar integration from PR #306, replacing the superseded PR #292 line with current/future executable discovery, component readiness, and allowlisted launch-protocol support while keeping Thora data outside Nexus;
- merged protected-role fallback from PR #307: when an existing module-named role is above Sentinal in the Discord hierarchy, Nexus preserves that protected role and creates/reuses a manageable `<Module> Access` self-role instead;
- merged staged-update publisher hash hardening from PR #309 and rebuild-CI hash unification from PR #311, removing remaining `Get-FileHash` dependencies from those verification paths in favor of direct .NET SHA-256 computation;
- merged secure hosted-Sentinal pairing from PR #310: `/nexus-pair` issues a short-lived one-use code; the Electron main process exchanges it over HTTPS and stores the long-lived Sentinal admin credential in protected storage, while earlier pairing PRs #302/#308 remain superseded;
- merged hosted-Sentinal public-surface hardening from PR #312: unauthenticated `/health` exposes readiness only, authenticated `/v1/status` retains detailed diagnostics, and non-loopback binding requires a 32+ character non-whitespace admin token;
- merged administrator-only Sentinal moderation command from PR #314 with bounded message-clear amounts, runtime authorization, command-health integration, regression coverage, and dedicated moderation documentation;
- merged guided first-run Setup Center from PR #315, reporting readiness for backend, hosted Sentinal pairing, household Owner access, rank/SKU discovery, Discord acceptance, provider configuration, and read-only provider validation while routing into the existing canonical admin screens rather than duplicating configuration or secrets;
- dedicated rebuild CI and Windows packaging/update-bundle validation paths.

These are implementation facts, not release or owner-acceptance claims. Code/tests do not establish successful household OAuth/pairing, live-provider correctness, real-guild reconciliation, hosted-Sentinal owner pairing, updater apply/rollback success on the owner PC, Thora launch success on the owner PC, Setup Center owner usability, moderation behavior on the intended guild, owner acceptance, or public/stable release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION STILL REQUIRED**

The latest exact merged implementation head with completed rebuild validation is PR #315 head `af46077b7ca885e7c5297923095b9c47da49844a`. **Nexus Rebuild CI run #220 completed successfully on that exact SHA.**

Immediately preceding merged implementation heads also have exact-head green validation:

- PR #314 head `7d356b7ca4cfe0876e0307c266b33f5d53563a0c` — Nexus Rebuild CI run #218 passed;
- PR #313 head `2cb228b8c3ed1ff4233719ba25b24334bc64ecc3` — Nexus Rebuild CI run #213 passed;
- PR #312 head `a74846e591065d13fff9e2249a0d539bc33b4e8a` — Nexus Rebuild CI run #211 passed;
- PR #311 head `837eecc441df5c5005eb2e0a119fc8a114e7662d` — Nexus Rebuild CI run #208 passed;
- PR #310 head `40e598a8cc93b4ddd425813b6f91327156c3122d` — Nexus Rebuild CI run #204 passed before merge;
- PR #309 and earlier validated implementation evidence remains preserved in repository history.

CI evidence remains separate from owner/live acceptance. Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not claim Accounts & Access owner validation until browser OAuth and second-account pairing are exercised in the intended household environment;
- do not claim hosted Sentinal pairing owner validation until `/nexus-pair` → HTTPS exchange → protected credential storage → authenticated admin status is exercised against the intended hosted Sentinal instance;
- do not claim live-provider correctness until provider paths are exercised against real supported services/servers;
- do not claim real-guild Sentinal acceptance until setup, permissions, reconciliation, persistent panels, friendly commands, event feeds, restart behavior, rank/SKU discovery, module-access roles, protected-role fallback, administrator moderation, and hosted pairing are exercised on the intended Discord guild;
- do not claim Setup Center owner acceptance until its readiness states and navigation are exercised against the intended owner configuration;
- do not claim updater owner validation until an installed owner-test build successfully stages, applies, confirms startup, and exercises rollback behavior where appropriate;
- do not claim Thora owner validation until discovery/readiness and allowlisted launch targets are exercised against the intended installed Thora build;
- do not claim public/stable release status from CI, packaging, deployment, PR merge state, or package version alone;
- do not carry the old 0.41.x twelve-gate numeric stabilization score into the 0.1 rebuild.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Goals:

- keep the desktop thin and admin-focused;
- owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, module enable/config controls, safe Repair Nexus flow, and current Thora sidecar bridge;
- preserve capability, permission, confirmation, redaction, audit, secret-storage, and exact commit/artifact boundaries;
- maintain deterministic Discord provisioning/reconciliation without duplicate channels, consoles, roles, or lobbies;
- preserve exact commit/artifact correlation for each owner-test build.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + READ-ONLY VALIDATION + EVENT FEEDS MERGED; LIVE/OWNER VALIDATION REQUIRED**

Concrete provider implementations and regression coverage exist for several modules, including the backend-first Pokémon GO provider. The guarded read-only validation endpoint/UI and universal Sentinal event/schedule feeds are merged. The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths.

Goals:

- exercise Palworld and other supported providers against real configured services using predefined read-only probes;
- validate Pokémon GO's credential-free official event/news ingestion against live public data and real Discord presentation;
- keep destructive provider operations outside validation and preserve explicit capability/permission/confirmation boundaries;
- preserve shared scheduler authority and avoid per-module duplicate schedulers;
- record explicit capability limitations when a provider/game cannot expose a requested live function safely or reliably.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — HOSTED PAIRING + ACCESS-ROLE RECONCILIATION + PROTECTED-ROLE FALLBACK + ADMIN MODERATION MERGED; REAL-GUILD ACCEPTANCE PENDING**

Merged implementation now includes setup/repair, permanent module panels, friendly per-module commands, Admin Operations controls, administrator moderation, Pokémon GO operations, universal event feeds, supporter-rank/SKU discovery including recurring + durable entitlement matching, self-reconciling module access roles, role-reconciliation warning diagnostics, protected-role fallback, and secure hosted desktop-to-Sentinal pairing with a minimized public health surface.

Goals:

- validate `/nexus setup`, reconciliation, permission checks, command synchronization, persistent panels, friendly module commands, event feeds, degraded-backend behavior, and restart recovery on the real guild;
- validate administrator moderation authorization, bounded clear amounts, and command-health behavior on the intended guild;
- validate temporary lobby lifecycle and cleanup;
- validate rank/entitlement reconciliation and discovery against real Discord hierarchy and Premium App recurring/durable SKU mappings;
- validate module access-role self-reconciliation on the live guild, including the merged protected-role fallback for existing roles above Sentinal;
- validate hosted pairing against the intended Railway Sentinal instance without exposing the long-lived admin credential to the renderer;
- verify common game workflows are discoverable without memorizing generic backend commands;
- validate Veyra/D&D presentation against the backend-first boundary.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

PR #293 provides the staged updater; PR #294 adds owner-test build tracking and per-build feedback inside the Admin Control Center; PR #309 hardens staged-update publisher SHA-256 verification; PR #311 aligns rebuild-CI update-bundle verification to the same direct .NET SHA-256 path. None of those changes publishes an update or release by itself.

Goals:

- establish one authoritative rebuild release identity and artifact naming policy beyond package version alone;
- keep tested commit, installer artifact, update ZIP/manifest, owner-test feedback, release notes, and rollback target correlated;
- validate a real installed owner-test update cycle: check, download, verification, staging, explicit restart/apply, startup confirmation, and rollback behavior;
- verify Windows installer behavior, protected configuration, diagnostics/recovery, and startup-health reporting;
- keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Direction:

- selectively port only legacy behavior that fits the backend/admin/Sentinal architecture;
- expand provider-backed game services and capability-driven Discord module consoles;
- thin or omit routine game dashboards from the desktop rather than rebuilding the old renderer surface;
- keep Thora bridged from its canonical private project rather than copying household data into Nexus;
- consider future web/public surfaces only if they support this architecture and do not become a second authority for protected machine operations.

The previous roadmap's self-hosted web + Windows Agent migration is not the immediate successor phase for Nexus 0.1.

## Historical stabilization record

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical and rollback evidence. They are superseded as the active implementation direction by Nexus 0.1 but should not be deleted.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. No newer meaningful `[Owner Test …]` or `[Startup Diagnostics …]` failure was found during the 2026-08-23 synchronization. This is historical evidence for the legacy line and is not validation of Nexus 0.1.

The historical stabilization release identity remains owner-test `0.41.2.1` / internal `0.41.3-test.1`, channel `owner-test`, with rollback `v0.41.2-B`; that identity does not replace the active Nexus 0.1 package identity.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
