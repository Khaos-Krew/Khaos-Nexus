# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Repository: `Khaos-Krew/Khaos-Nexus`  
Active implementation branch: `rebuild/nexus-0.1`

## Purpose

This file is the canonical roadmap/status handoff for the active Nexus rebuild. README roadmap claims must be synchronized from repository reality plus this document, not from the superseded `0.41.x` stabilization plan, old release notes, rejected test builds, or chat memory.

Do not describe a capability as complete, validated, released, or production-ready merely because code exists. Verify implementation, exact-head tests/workflows, owner-test evidence, and actual release state separately.

## Current product line

- Active implementation line: **Nexus 0.1 rebuild**
- Current package version: **0.1.0**
- Active branch: `rebuild/nexus-0.1`
- Previous `0.41.x` stabilization line: **preserved legacy / rollback / reference only for this rebuild direction**
- PR #266 / `stabilize/nexus-66-baseline`: **historical stabilization work; open/draft and not the active implementation target for Nexus 0.1**
- `config/release-identity.json` is not present on the rebuild branch; package identity currently comes from `package.json` and rebuild packaging/update contracts.
- No public/stable Nexus 0.1 release is established by the rebuild branch, package version, CI, deployment, PR merge state, or hosted-service availability alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved backend-first rebuild direction.

- **Nexus Backend** owns game logic, provider integrations, shared module contracts, permissions, health, scheduling hooks, and backend service routing.
- **Nexus Sentinal** is the primary day-to-day Discord interface for game modules through persistent consoles, setup/reconciliation, friendly commands, interactive controls, self-role/rank surfaces, safety/reporting workflows, and deeper commands.
- **Khaos Nexus Desktop** is the privileged Admin Control Center for Discord/Sentinal administration, account/access linking, backend/module/service configuration, diagnostics, logs, recovery, updates, scheduler administration, integrations, owner testing, and the private Thora bridge.
- **Veyra** may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- **Thora** remains private/local and is bridged from its canonical project rather than duplicated into Nexus.

Legacy code remains available as reference material and may be selectively ported only when it fits these boundaries and has focused regression coverage.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` currently establishes:

- package identity `0.1.0`, Electron Admin Control Center entrypoint, Windows NSIS packaging, and desktop/Start Menu shortcuts;
- backend and Sentinal runtimes, shared scheduler, module registry, capability/permission boundaries, health/configuration services, provider foundations, and persistent Sentinal module consoles;
- module registrations for ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn, D&D, and Pokémon GO;
- concrete provider implementations for Division 2, Palworld, Warframe, Rust, Satisfactory, IdleOn, and Pokémon GO;
- household Accounts & Access (#288), guarded read-only provider validation (#290/#291), staged updating (#293), Admin Operations / Owner Test Center (#294), backend-first Pokémon GO (#295), friendly per-module commands (#298), universal event/schedule feeds (#299), command-schema normalization (#300), and supporter-rank discovery (#301);
- self-reconciling module access roles (#304), hierarchy/config warnings (#305), protected-role fallback (#307), hosted Sentinal pairing (#310), public-health hardening (#312), explicit Premium App recurring/durable SKU mode (#313), administrator moderation (#314), guided Setup Center (#315), hosted provider sync (#316), persistent hosted-provider path alignment (#317), Discord Admin acceptance repairs (#318/#319), and Discord Server Shop rank-authority corrections (#320/#321);
- capability-driven module help (#323), Warframe Archon Hunt reads (#325), and the merged interactive ARK tame wizard evolved through #324/#326/#327/#328;
- unified Sentinal self-role ownership (#329) and wider bounded legacy-menu discovery (#330);
- **legacy emoji reaction-role migration (#331) is now merged and validated**: safely mapped reaction-role messages can be converted to Sentinal button menus, color menus retain exclusivity, and old reactions are retired only after replacement controls are active;
- private safe-space report tickets (#332), including the Rules report entrypoint, private case channels, staff controls, restricted transcripts, and privacy-preserving persistence boundaries;
- **roadmap milestone patch-note publishing (#333) is merged and validated**: only 66%/100% milestones are valid, publication is idempotent, missing channels remain pending rather than falsely marked posted, and restricted private-edition content is blocked from public milestone notes;
- **legacy visible Nexus role-button adoption (#335) is merged and validated**: bot-authored old Khaos Nexus button menus with older custom IDs can be adopted by exact role-label mapping, existing role/message IDs are reused, duplicate generic roles are avoided, and Name Color pages share one global exclusive color pool;
- current Thora sidecar integration (#306), staged-update/hash hardening (#309/#311), dedicated `docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md`, and Nexus Rebuild CI with Windows tests, NSIS packaging, staged-update verification, and artifact upload.

Open follow-up hardening is not part of the accepted baseline until merged and validated. In particular, PR #334 narrows reaction-role candidate detection to avoid ordinary reaction polls, and PR #336 proposes a deeper one-time legacy-role history scan plus negative-result caching to avoid repeated guild-wide scans.

These are implementation facts, not release or final owner-acceptance claims. Code/tests do not establish successful household OAuth/pairing, live-provider correctness, successful hosted provider credential synchronization against the intended Railway instance, complete real-guild reconciliation, live legacy-role migration/adoption success on the intended guild, report-ticket owner acceptance, updater apply/rollback success on the owner PC, Thora launch success on the owner PC, final Setup Center/Discord Admin acceptance, owner acceptance, or public/stable release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #335 head `ab92b519e21466030f6c06e89267e9eb8c2c9c08`**. **Nexus Rebuild CI run #282 completed successfully on that exact SHA**, and PR #335 then merged into `rebuild/nexus-0.1`.

Important preceding exact-head evidence includes:

- PR #333 head `ab20274db953a5dd2b1dfa2d1825f8ae96d1568b` — Nexus Rebuild CI #279 green;
- PR #332 head `9b1dcb994dbb629a9d21d8d74ef3762c71f76136` — CI #274 green;
- PR #331 head `0e46e0b85944ce9c048c0c78d65659f680f537b7` — CI #265 green;
- PR #330 head `55b3463d8d402b7e5323cebb130b8c4983e53536` — CI #263 green;
- PR #328 head `a2bc8a15e85a5b57386d1439916f9c21733be040` — CI #260 green.

Earlier green implementation evidence remains preserved in repository history.

The `Discord + Nexus Setup Acceptance` checkpoint contains useful hosted/runtime evidence from the PR #316 deployment, including successful health, Discord login, persistent module feeds, command registration, and module-access reconciliation with 10 roles, 1 menu message, and 0 warnings. Owner acceptance testing on 2026-08-24 exercised the desktop-hosted Discord admin path; PRs #318/#319 repaired scan timeout/presentation defects, and PRs #320/#321 corrected the false Premium App SKU gate for Discord Server Shop Premium Roles.

Self-role acceptance then changed materially. The initial broad scan after #330 did not find legacy `kn-role` menus. PR #331 added safe reaction-role migration, but later live screenshots established that the visible old Khaos Nexus role UI is bot-authored button menus using older custom IDs. PR #335 now provides that direct adoption path and supersedes the earlier assumption that the remaining visible role UI was necessarily reaction-only. Live guild acceptance is still required before declaring the old controls fully migrated/retired.

PR #333 records **Community Safety & Reporting — 100%** as an implementation milestone eligible for one-time public patch-note publication. That milestone does not by itself prove live report-ticket owner acceptance or complete the broader Sentinal operational-acceptance phase.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not claim hosted Sentinal pairing owner validation until a fresh `/nexus-pair` → HTTPS exchange → protected credential storage → authenticated admin status flow is explicitly exercised and recorded;
- do not claim hosted provider synchronization owner validation until real provider settings/secrets are synchronized to the intended Railway instance, survive restart/persistent-volume reload, remain protected/redacted, and pass predefined read-only probes;
- do not claim live-provider correctness until provider paths are exercised against real supported services/servers;
- do not claim real-guild Sentinal acceptance until setup, permissions, reconciliation, panels, commands, event feeds, restart behavior, rank authority, module-access roles, protected-role fallback, self-role migration/adoption, moderation, safety reporting, hosted pairing, and relevant hosted-provider flows are exercised on the intended guild;
- do not claim updater owner validation until an installed owner-test build successfully stages, applies, confirms startup, and exercises rollback behavior where appropriate;
- do not claim Thora owner validation until discovery/readiness and allowlisted launch targets are exercised against the intended installed Thora build;
- do not claim public/stable release status from CI, packaging, deployment, PR merge state, or package version alone;
- do not carry the old `0.41.x` twelve-gate numeric stabilization score into the 0.1 rebuild.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Goals:

- keep the desktop thin and admin-focused;
- owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing, hosted provider synchronization, module enable/config controls, safe Repair Nexus flow, and current Thora bridge;
- preserve permission, confirmation, redaction, audit, secret-storage, and exact commit/artifact boundaries;
- preserve deterministic Discord provisioning/reconciliation without duplicates.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths. Validate Pokémon GO public-data presentation, ARK tame presentation, and Warframe Archon Hunt reads in intended Discord surfaces without treating CI coverage as live acceptance.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — SELF-ROLE MIGRATION/ADOPTION + SAFETY SYSTEMS MERGED; REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation includes setup/repair, persistent module panels, friendly commands/help, moderation, Pokémon GO operations, event feeds, rank authority, module-access reconciliation, hierarchy diagnostics, protected-role fallback, unified self-role/color menus, bounded old-menu discovery, legacy reaction-role migration (#331), direct old Nexus button-menu adoption (#335), private safe-space report tickets (#332), secure hosted pairing, hosted provider administration, and one-time roadmap milestone patch-note publishing (#333).

Goals:

- validate the real guild end-to-end, including the actual legacy role menus and Name Color switching;
- retire old reactions/buttons only after replacement controls are demonstrably active;
- validate the Rules/report lifecycle and restricted archive permissions end-to-end;
- complete the remaining Discord + Nexus Setup Acceptance gates, including fresh hosted pairing, live repair where needed, real provider sync/validation, and restart persistence;
- validate moderation, temporary lobby lifecycle, common workflow discoverability, and Veyra/D&D presentation boundaries.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

PR #293 provides the staged updater, PR #294 adds owner-test build tracking, and PRs #309/#311 harden SHA-256 verification. The latest green rebuild CI confirms compatibility with the automated pipeline; it does not publish an update or release.

Goals:

- establish one authoritative rebuild release identity/artifact policy beyond package version alone;
- correlate tested commit, installer, update ZIP/manifest, owner-test feedback, release notes, and rollback target;
- validate a real installed owner-test update cycle and rollback;
- keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Direction:

- selectively port only legacy behavior that fits the backend/admin/Sentinal architecture;
- expand provider-backed game services and capability-driven Discord consoles;
- keep routine game dashboards out of the desktop;
- keep Thora bridged from its canonical private project;
- consider future web/public surfaces only when they support rather than duplicate protected authority.

The previous self-hosted web + Windows Agent roadmap is not the immediate successor phase for Nexus 0.1.

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
