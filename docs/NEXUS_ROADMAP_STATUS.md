# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Repository: `Khaos-Krew/Khaos-Nexus`  
Active implementation branch: `rebuild/nexus-0.1`

## Purpose

This file is the canonical roadmap/status handoff for the active Nexus rebuild. README roadmap claims must be synchronized from repository reality plus this document, not from the superseded 0.41.x stabilization plan, old release notes, rejected test builds, or chat memory.

Do not describe a capability as complete, validated, released, or production-ready merely because code exists. Verify implementation, exact-head tests/workflows, owner-test evidence, and actual release state separately.

## Current product line

- Active implementation line: **Nexus 0.1 rebuild**
- Current package version: **0.1.0**
- Active branch: `rebuild/nexus-0.1`
- Previous `0.41.x` stabilization line: **preserved legacy / rollback / reference only for this rebuild direction**
- PR #266 / `stabilize/nexus-66-baseline`: **historical stabilization work; open/draft and not the active implementation target for Nexus 0.1**
- No public/stable Nexus 0.1 release is established by the rebuild branch, package version, CI, deployment, PR merge state, or hosted-service availability alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved backend-first rebuild direction.

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
- persistent Sentinal module consoles, Discord provisioning/reconciliation, temporary voice lobbies, Administrator permission preflight, setup/repair flows, friendly module commands, and universal event/schedule feeds;
- household Accounts & Access from PR #288, including Owner/Co-Owner roles, Discord OAuth linking, one-time pairing codes, Sentinal account commands, and protected credential handling;
- guarded read-only provider validation from PRs #290/#291 with predefined non-destructive viewer probes, redacted PASS/SKIPPED/FAIL results, and Palworld as the first recommended real-provider acceptance target;
- staged in-app updater from PR #293 with approved-channel checks, SHA-256/manifest verification, staged full-payload updates, explicit Owner restart/apply, startup confirmation, and rollback behavior without rerunning NSIS for normal updates;
- Admin Operations from PR #294: Owner Test Center, Sentinal health/admin client, rank/entitlement sync, Discord permission/layout inspection and repair, module enable/config controls enforced by backend runtime, persistent panel refresh, command synchronization, safe Repair Nexus orchestration, and startup-health/loading state;
- backend-first Pokémon GO from PR #295, friendly per-module commands from PR #298, universal event/schedule posting from PR #299, Discord command-schema normalization from PR #300, and supporter-rank/SKU discovery from PRs #301/#313;
- self-reconciling module access roles from PR #304, warning diagnostics from PR #305, protected-role fallback from PR #307, administrator moderation from PR #314, and guided first-run Setup Center from PR #315;
- current Thora sidecar integration from PR #306 while keeping Thora household data outside Nexus;
- hosted Sentinal pairing from PR #310 and public-surface hardening from PR #312;
- staged-update publisher and CI hash hardening from PRs #309/#311;
- hosted provider configuration synchronization from PR #316: the desktop main process can send sanitized provider configuration plus approved protected secrets over the existing paired HTTPS admin channel; hosted provider secrets are encrypted at rest on the persistent Railway volume; the renderer never receives provider credentials; hosted providers can be replaced live and exercised through the existing predefined read-only validation probes; Setup Center can use hosted sync/validation evidence;
- persistent hosted-provider storage alignment from PR #317: hosted provider state honors `NEXUS_DATA_DIR`, matching Sentinal state persistence so alternate hosts do not split Discord state and provider state between persistent and ephemeral directories;
- Discord owner-acceptance client repairs from PRs #318/#319: hosted aggregate scans have operation-specific deadlines and Nexus-specific timeout classification, and completed read-only scans with acceptance findings now render their per-section results instead of being collapsed into a generic action failure; rank/Premium SKU and hosted-provider status findings are visible on the Discord Admin surface;
- dedicated `docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md` checkpoint separating verified hosted/runtime evidence, observed Owner scan progress, and still-pending Owner interaction gates;
- dedicated Nexus Rebuild CI with Windows test, NSIS packaging, staged-update bundle construction/verification, and artifact upload.

These are implementation facts, not release or final owner-acceptance claims. Code/tests do not establish successful household OAuth/pairing, live-provider correctness, successful hosted provider credential synchronization against the intended Railway instance, complete real-guild reconciliation, updater apply/rollback success on the owner PC, Thora launch success on the owner PC, final Setup Center/Discord Admin acceptance, moderation behavior on the intended guild, owner acceptance, or public/stable release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #319 head `298baec7b1800e0170f2f6ac94e03fd961fc4128`**. **Nexus Rebuild CI run #235 completed successfully on that exact SHA.** PR #319 then merged into `rebuild/nexus-0.1` as merge commit `124d8c7b333b819c7ba3f0c22e88a1122e7d8455`.

Immediately preceding exact-head green implementation evidence remains preserved in repository history, including PR #318 head `f23ea665e7453d21f47bc7c3ba93c3bdb16745ee` (run #233), PR #317 head `f5ce0835e846aa50b2557f5470bb9a927851e8e4` (run #227), PR #316 head `66bbed2f1d3aa6b74722aa2f13dfdfc4b10bf9f9` (run #225), PR #315 head `af46077b7ca885e7c5297923095b9c47da49844a` (run #220), PR #314 head `7d356b7ca4cfe0876e0307c266b33f5d53563a0c` (run #218), and PR #313 head `2cb228b8c3ed1ff4233719ba25b24334bc64ecc3` (run #213).

The current `Discord + Nexus Setup Acceptance` checkpoint records useful hosted/runtime evidence from the PR #316 deployment, including successful health, Discord login, persistent module feeds, command registration, and module-access reconciliation with 10 roles, 1 menu message, and 0 warnings. Owner acceptance testing on 2026-08-24 additionally exercised the desktop-hosted Discord admin path: the Discord Admin surface reported Sentinal online with 5/5 permissions and other readiness data, and after PR #318 the hosted `/v1/scan` request completed HTTP 200 in roughly 3 seconds. That test exposed a second presentation defect, repaired by PR #319, where valid read-only findings had been rendered as `Operation failed.`. This is meaningful Owner-test progress, not final acceptance. The PR #319 implementation still needs to be exercised so the actual findings can be reviewed and genuine red sections can be separated from transport/UI defects.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not claim Accounts & Access owner validation until browser OAuth and second-account pairing are exercised in the intended household environment;
- do not claim hosted Sentinal pairing owner validation until a fresh `/nexus-pair` → HTTPS exchange → protected credential storage → authenticated admin status flow is explicitly exercised and recorded; successful authenticated hosted scans are supporting evidence but not complete proof of the fresh-code pairing ceremony;
- do not claim hosted provider synchronization owner validation until real configured provider settings/secrets are synchronized to the intended Railway Sentinal instance, survive restart/persistent-volume reload, remain redacted/protected, and successfully execute the predefined read-only validation probes;
- do not claim live-provider correctness until provider paths are exercised against real supported services/servers;
- do not claim real-guild Sentinal acceptance until setup, permissions, reconciliation, persistent panels, friendly commands, event feeds, restart behavior, rank/SKU discovery, module-access roles, protected-role fallback, moderation, hosted pairing, relevant hosted-provider flows, and the PR #319 findings UI are exercised on the intended Discord guild;
- do not claim Setup Center owner acceptance until its readiness states, findings, and navigation are exercised against the intended owner configuration;
- do not claim updater owner validation until an installed owner-test build successfully stages, applies, confirms startup, and exercises rollback behavior where appropriate;
- do not claim Thora owner validation until discovery/readiness and allowlisted launch targets are exercised against the intended installed Thora build;
- do not claim public/stable release status from CI, packaging, deployment, PR merge state, or package version alone;
- do not carry the old 0.41.x twelve-gate numeric stabilization score into the 0.1 rebuild.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Goals:

- keep the desktop thin and admin-focused;
- owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, hosted provider synchronization, module enable/config controls, safe Repair Nexus flow, and current Thora sidecar bridge;
- preserve capability, permission, confirmation, redaction, audit, secret-storage, and exact commit/artifact boundaries;
- maintain deterministic Discord provisioning/reconciliation without duplicate channels, consoles, roles, or lobbies;
- preserve exact commit/artifact correlation for each owner-test build.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS MERGED; LIVE/OWNER VALIDATION REQUIRED**

Concrete provider implementations and regression coverage exist for several modules. Guarded read-only validation, universal Sentinal event/schedule feeds, authenticated desktop-to-hosted provider configuration synchronization, and persistent hosted-provider path alignment are merged. The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths.

Goals:

- synchronize the intended real provider configuration from desktop protected storage to the paired Railway-hosted Sentinal instance and verify encrypted persistent storage/reload behavior;
- exercise Palworld and other supported providers against real configured services using predefined read-only probes through both intended local/backend and hosted paths where applicable;
- validate Pokémon GO's credential-free official event/news ingestion against live public data and real Discord presentation;
- keep destructive provider operations outside validation and preserve explicit capability/permission/confirmation boundaries;
- preserve shared scheduler authority and avoid per-module duplicate schedulers;
- record explicit capability limitations when a provider/game cannot expose a requested live function safely or reliably.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — OWNER SCAN PATH EXERCISED; FINDINGS REVIEW + REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation now includes setup/repair, permanent module panels, friendly per-module commands, Admin Operations controls, moderation, Pokémon GO operations, universal event feeds, supporter-rank/SKU discovery, self-reconciling module access roles, hierarchy diagnostics, protected-role fallback, secure hosted desktop-to-Sentinal pairing, minimized public health metadata, hosted provider configuration/validation routes, persistent hosted-provider storage alignment, and the PR #318/#319 Discord Admin acceptance fixes. Owner testing has confirmed the hosted scan transport can complete successfully; final per-section acceptance is still pending on the PR #319 implementation.

Goals:

- validate setup, reconciliation, permission checks, command synchronization, persistent panels, friendly module commands, event feeds, degraded-backend behavior, and restart recovery on the real guild;
- validate moderation authorization, bounded clear amounts, and command-health behavior;
- validate temporary lobby lifecycle and cleanup;
- validate rank/entitlement reconciliation against the real Discord hierarchy and Premium App recurring/durable SKU mappings;
- validate module access-role reconciliation including protected-role fallback;
- re-run the hosted Discord scan on the PR #319 implementation, review the actual acceptance findings, and repair only genuine red sections;
- validate hosted pairing and provider synchronization against the intended Railway Sentinal instance without exposing long-lived admin or provider credentials to the renderer/public surfaces;
- complete the remaining Owner interaction gates in `docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md`, including explicit fresh-code pairing evidence, live repair where needed, real provider sync/validation, and restart persistence;
- verify common game workflows are discoverable without memorizing generic backend commands;
- validate Veyra/D&D presentation against the backend-first boundary.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

PR #293 provides the staged updater; PR #294 adds owner-test build tracking; PRs #309/#311 harden SHA-256 verification. PR #319's green rebuild CI confirms the current implementation remains compatible with the rebuild validation pipeline; this does not publish an update or release.

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

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical and rollback evidence. They are superseded as the active implementation direction by Nexus 0.1 but should not be deleted or presented as the active rebuild roadmap.

PR #266 remains open, draft, mergeable, and unmerged on `stabilize/nexus-66-baseline`; its state does not supersede the active rebuild branch.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. No newer meaningful `[Owner Test …]` or `[Startup Diagnostics …]` failure was found during the 2026-08-24 synchronization. This is historical evidence for the legacy line and is not validation of Nexus 0.1.

The historical stabilization release identity remains owner-test `0.41.2.1` / internal `0.41.3-test.1`, channel `owner-test`, with rollback `v0.41.2-B`; that identity does not replace the active Nexus 0.1 package identity.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
