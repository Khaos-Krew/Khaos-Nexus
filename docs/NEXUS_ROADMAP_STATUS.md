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
- **Nexus Sentinal** — primary day-to-day Discord interface for game modules through persistent module consoles, setup/reconciliation, short module commands, interactive controls, self-role/rank surfaces, safety/reporting workflows, and deeper commands.
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
- household Accounts & Access from PR #288, guarded read-only provider validation from PRs #290/#291, staged in-app updating from PR #293, and Admin Operations / Owner Test Center from PR #294;
- backend-first Pokémon GO from PR #295, friendly per-module commands from PR #298, universal event/schedule posting from PR #299, Discord command-schema normalization from PR #300, and supporter-rank discovery from PR #301;
- self-reconciling module access roles from PR #304, warning diagnostics from PR #305, protected-role fallback from PR #307, hosted Sentinal pairing from PR #310, public health hardening from PR #312, recurring/durable Premium App SKU support from PR #313 when explicitly configured, administrator moderation from PR #314, and guided first-run Setup Center from PR #315;
- hosted provider configuration synchronization from PR #316 and persistent hosted-provider path alignment from PR #317;
- Discord Admin owner-acceptance client repairs from PRs #318/#319;
- Discord Server Shop authority correction from PR #320 and matching desktop presentation correction from PR #321;
- capability-driven module help from PR #323 and read-only Warframe Archon Hunt support from PR #325;
- ARK taming companion work evolved through PRs #324/#326/#327 into the merged interactive PR #328 flow: `/ark tame` is a private Discord wizard with creature browsing, level/server-rate input, KO/tranq planning for applicable tames, top food choices, approximate timing, passive-tame handling, and final posting to the dedicated `#ark-tame-info` channel; the implementation uses upstream ARK Smart Breeding/ARKStatsExtractor data and retains its third-party notice;
- unified Sentinal self-role ownership from PR #329: existing generic roles are adopted rather than duplicated, legacy/new role buttons are understood, name colors are mutually exclusive, color roles receive safe hierarchy priority below moderation boundaries, and old controls are retired only after a replacement menu is active;
- expanded legacy self-role discovery from PR #330: role/self-role/reaction/color/notification channels are scanned with bounded history paging and cached discovery state so older menus outside the current configured role channel can be located without repeated deep scans;
- private safe-space report/ticket workflow from PR #332: the Rules surface includes an **Open Private Report** path, reports use private case-ID channels and a modal, authorized staff receive claim/add/escalate/resolve/close controls, closed cases produce restricted transcripts, reporter identity is not exposed in channel names, and narrative/evidence content is kept out of routine Sentinal state/log persistence;
- current Thora sidecar integration from PR #306 while keeping Thora household data outside Nexus;
- staged-update publisher and CI hash hardening from PRs #309/#311;
- dedicated `docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md` checkpoint separating verified hosted/runtime evidence, observed Owner scan progress, and still-pending Owner interaction gates;
- dedicated Nexus Rebuild CI with Windows test, NSIS packaging, staged-update bundle construction/verification, and artifact upload.

PR #331, which proposes migration of older emoji reaction-role messages into Sentinal button menus, is **open and unmerged**. Do not describe emoji reaction-role migration/removal as part of the accepted rebuild baseline until that PR merges and is validated.

These are implementation facts, not release or final owner-acceptance claims. Code/tests do not establish successful household OAuth/pairing, live-provider correctness, successful hosted provider credential synchronization against the intended Railway instance, complete real-guild reconciliation, successful migration of the legacy emoji reaction-role system, report-ticket acceptance on the intended guild, updater apply/rollback success on the owner PC, Thora launch success on the owner PC, final Setup Center/Discord Admin acceptance, owner acceptance, or public/stable release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #332 head `9b1dcb994dbb629a9d21d8d74ef3762c71f76136`**. **Nexus Rebuild CI run #274 completed successfully on that exact SHA**, and PR #332 then merged into `rebuild/nexus-0.1`.

Important preceding exact-head evidence includes PR #330 head `55b3463d8d402b7e5323cebb130b8c4983e53536` with CI run #263 green and PR #328 head `a2bc8a15e85a5b57386d1439916f9c21733be040` with CI run #260 green. Earlier green implementation evidence remains preserved in repository history, including PR #325 run #251, PR #324 run #249, PR #323 run #247, PR #321 run #242, PR #320 run #240, PR #319 run #235, PR #318 run #233, PR #317 run #227, PR #316 run #225, PR #315 run #220, PR #314 run #218, and PR #313 run #213.

The current `Discord + Nexus Setup Acceptance` checkpoint records useful hosted/runtime evidence from the PR #316 deployment, including successful health, Discord login, persistent module feeds, command registration, and module-access reconciliation with 10 roles, 1 menu message, and 0 warnings. Owner acceptance testing on 2026-08-24 also exercised the desktop-hosted Discord admin path: the hosted `/v1/scan` completed successfully and PR #319 exposed the real per-section findings. The only surfaced red section was Rank / SKU discovery, which repository inspection established was a false Premium App SKU requirement for Discord Server Shop Premium Roles; PRs #320/#321 corrected that authority model and presentation.

Live self-role acceptance after PR #330 also established a useful fact: a broad scan of existing text-channel history found no legacy `kn-role` button menus, supporting the conclusion that the visible old role UI belongs to the earlier emoji reaction-role system. PR #331 is the proposed migration path for those legacy emoji menus and remains unmerged.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not claim Accounts & Access owner validation until browser OAuth and second-account pairing are exercised in the intended household environment;
- do not claim hosted Sentinal pairing owner validation until a fresh `/nexus-pair` → HTTPS exchange → protected credential storage → authenticated admin status flow is explicitly exercised and recorded;
- do not claim hosted provider synchronization owner validation until real configured provider settings/secrets are synchronized to the intended Railway Sentinal instance, survive restart/persistent-volume reload, remain redacted/protected, and successfully execute the predefined read-only validation probes;
- do not claim live-provider correctness until provider paths are exercised against real supported services/servers;
- do not claim real-guild Sentinal acceptance until setup, permissions, reconciliation, persistent panels, friendly commands, event feeds, restart behavior, rank authority, module-access roles, protected-role fallback, unified self-role menus, the legacy emoji-menu migration path where applicable, moderation, safety reporting, hosted pairing, and relevant hosted-provider flows are exercised on the intended Discord guild;
- do not treat missing Premium App SKUs as an acceptance failure when the intended paid-rank authority is Discord Server Shop Premium Roles;
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

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

Concrete provider implementations and regression coverage exist for several modules. Guarded read-only validation, universal Sentinal event/schedule feeds, authenticated desktop-to-hosted provider configuration synchronization, persistent hosted-provider path alignment, capability-driven module help, the interactive ARK taming workflow, and Warframe Archon Hunt reads are merged. The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths.

Goals:

- synchronize the intended real provider configuration from desktop protected storage to the paired Railway-hosted Sentinal instance and verify encrypted persistent storage/reload behavior;
- exercise Palworld and other supported providers against real configured services using predefined read-only probes through intended local/backend and hosted paths where applicable;
- validate Pokémon GO credential-free event/news ingestion against live public data and real Discord presentation;
- validate the interactive ARK taming wizard and Warframe Archon Hunt presentation in the intended Discord module surfaces without treating CI coverage as live-provider/owner acceptance;
- keep destructive provider operations outside validation and preserve explicit capability/permission/confirmation boundaries;
- preserve shared scheduler authority and avoid per-module duplicate schedulers;
- record explicit capability limitations when a provider/game cannot expose a requested live function safely or reliably.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — SELF-ROLE + SAFETY SYSTEMS MERGED; LEGACY EMOJI MIGRATION + REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation now includes setup/repair, permanent module panels, friendly per-module commands, capability-driven Commands / Help, Admin Operations controls, moderation, Pokémon GO operations, universal event feeds, supporter-rank discovery, module-access reconciliation, hierarchy diagnostics, protected-role fallback, unified self-role/color menus, broader old-menu discovery, private safe-space report tickets, secure hosted desktop-to-Sentinal pairing, minimized public health metadata, hosted provider configuration/validation routes, persistent hosted-provider storage alignment, the PR #318/#319 Discord Admin acceptance fixes, and the PR #320/#321 Discord Server Shop rank-authority corrections.

Goals:

- validate setup, reconciliation, permission checks, command synchronization, persistent panels, friendly module commands, capability-driven help, event feeds, degraded-backend behavior, and restart recovery on the real guild;
- validate moderation authorization, bounded clear amounts, and command-health behavior;
- validate temporary lobby lifecycle and cleanup;
- validate rank reconciliation against the real Discord hierarchy using the correct authority mode;
- validate module access-role reconciliation including protected-role fallback;
- validate unified self-role menus and name-color exclusivity/hierarchy on the intended guild;
- finish the legacy emoji reaction-role migration only through a merged, validated PR #331 or successor, and retire old reactions only after replacement controls are active;
- validate the Rules safe-space panel and private report lifecycle end-to-end, including reporter/staff permissions, claim/add/escalate/resolve/close behavior, restricted transcript archival, and privacy boundaries;
- re-run/complete the remaining Discord + Nexus Setup Acceptance gates, including rank-authority confirmation, fresh hosted pairing evidence, live repair where needed, real provider sync/validation, and restart persistence;
- verify common game workflows are discoverable without memorizing generic backend commands;
- validate Veyra/D&D presentation against the backend-first boundary.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

PR #293 provides the staged updater; PR #294 adds owner-test build tracking; PRs #309/#311 harden SHA-256 verification. PR #332's green rebuild CI confirms the current implementation remains compatible with the rebuild validation pipeline; this does not publish an update or release.

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
