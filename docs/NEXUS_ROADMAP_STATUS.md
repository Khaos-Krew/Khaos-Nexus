# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Repository: `Khaos-Krew/Khaos-Nexus`  
Active implementation branch: `rebuild/nexus-0.1`

## Purpose

This file is the canonical roadmap/status handoff for the active Nexus rebuild. README roadmap claims must be synchronized from repository reality plus this document, not from the superseded `0.41.x` stabilization plan, old release notes, rejected test builds, or chat memory.

Do not describe a capability as complete, validated, released, or production-ready merely because code exists. Verify implementation, exact-head tests/workflows, owner/live evidence, and actual release state separately.

## Current product line

- Active implementation line: **Nexus 0.1 rebuild**
- Current package version: **0.1.0**
- Active branch: `rebuild/nexus-0.1`
- Previous `0.41.x` stabilization line: **preserved legacy / rollback / reference only**
- PR #266 / `stabilize/nexus-66-baseline`: **historical stabilization work; open/draft and not the active implementation target**
- No public/stable Nexus 0.1 release is established by package version, CI, deployment, merge state, or hosted-service availability alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved backend-first rebuild direction.

- **Nexus Backend** owns game logic, provider integrations, shared module contracts, permissions, health, scheduling hooks, and backend service routing.
- **Nexus Sentinal** is the primary day-to-day Discord interface for game modules through persistent consoles, setup/reconciliation, friendly commands, interactive controls, self-role/rank surfaces, safety/reporting workflows, and deeper commands.
- **Khaos Nexus Desktop** is the privileged Admin Control Center for Discord/Sentinal administration, accounts/access, backend/module/service configuration, diagnostics, recovery, updates, scheduler administration, integrations, owner testing, and the private Thora bridge.
- **Veyra** may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- **Thora** remains private/local and is bridged from its canonical project rather than duplicated into Nexus.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` establishes the thin Electron Admin Control Center, Windows NSIS packaging/shortcuts, backend and Sentinal runtimes, shared scheduler, persistent module consoles, ARK/Palworld/Minecraft/Warframe/Division 2/Rust/Satisfactory/IdleOn/D&D/Pokémon GO module registrations, provider-backed game services, household Accounts & Access, read-only provider validation, staged updating, Owner Test Center/Admin Operations, hosted pairing/provider sync, Setup Center, administrator moderation, Discord Server Shop rank authority, capability-driven help, Warframe Archon Hunt reads, and the interactive ARK tame wizard.

Sentinal role/self-role work now includes:

- unified generic self-role and global Name Color ownership (#329);
- bounded legacy-menu discovery (#330);
- legacy emoji reaction-role migration (#331);
- direct adoption of old bot-authored Nexus role-button menus (#335);
- exact old-button target diagnostics and false-positive filtering (#339), including exclusion of the Community Rules private-report control and owner-testing reaction poll from role migration;
- deterministic title-scoped aliases for renamed live panels (#341), while duplicate same-name roles remain blocked and generic `LFG` remains intentionally unresolved rather than guessed;
- preservation/rendering of custom Discord color-swatch emoji during legacy migration (#342);
- restart reconstruction of current `nexus:self-role:*` menus plus deterministic recovery/creation of missing visual-only Name Color swatches (#343);
- strict module channel visibility reconciliation (#344), where `@everyone` is denied, the matching module access role is allowed, supporter/rank and nonmatching module visibility grants are neutralized, and existing staff/admin overrides plus non-`View Channel` bits are preserved;
- application-owned generated Name Color swatches (#345), avoiding Discord guild custom-emoji capacity as the limiting resource while preserving original non-generated custom emoji;
- live-role-hex swatch rendering (#346), preserving Discord role `color` / `hexColor` across alias augmentation, replacing fallback-gray generated swatches with deterministic `nexus_swatch_<hex>_<label>` application emoji, and refreshing automatically if the live role color later changes.

Sentinal persistent-panel hardening now also includes:

- deployment-idempotent managed module hubs and persistent live feeds (#347): recover bot-owned panels from Discord when saved message pointers are missing/stale, edit the surviving panel instead of sending duplicates, remove redundant Sentinal-owned copies, persist the surviving canonical message ID, and leave unrelated/foreign-authored messages untouched;
- first-pass live-feed reconciliation telemetry (#349): emit one bounded per-feed status line after process startup showing reused/updated/created/unavailable/error, recovery source, surviving message ID, and duplicates removed while keeping normal recurring polls quiet.

Community Safety & Reporting (#332) and one-time 66%/100% milestone patch-note publishing (#333) are merged implementation slices. Live report-ticket acceptance remains separate from implementation completion.

Superseded #334/#336/#337/#340 role-migration proposals are not active roadmap items; their relevant intent was overtaken by the merged #339/#341 path.

These are implementation facts, not final owner-acceptance or release claims.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #349 head `0d300731bf3d8c5c55fb8651cd5e4657416aa4e2`**. **Nexus Rebuild CI run #322 completed successfully on that exact SHA**, and PR #349 then merged into `rebuild/nexus-0.1` as `48db224b4a8937a1d8ea248cd9cc599a97c5a046`.

Recent exact-head evidence:

- PR #347 head `c3bd6e652f930c443b99ff474eea049e3a692da0` — Nexus Rebuild CI #320 green; merged as `8ce043ef1b3f6e1159bd9e439fca2208981b84a6`;
- PR #346 head `174ffa1d08edaf2bdb1eabc34d933cfe2a1e7768` — Nexus Rebuild CI #314 green; merged as `6180f99818508b4096e3ba4c87a39e7e5b144d2e`;
- PR #345 head `28e80eda28ad41d125d96f85c40f87d60b22b5c9` — Nexus Rebuild CI #311 green; merged as `f2b7d1dccb5a725bb8be77642358064a800fa403`;
- PR #344 head `da9237a3c2634c39a87921e4cbcd586d50cfbda0` — Nexus Rebuild CI #305 green; merged as `8070ec1c102ac1fcd901f82de3cc2bf60762b791`.

### Live acceptance state

PR #343 resolved the previously documented restart-recovery implementation defect. PR #344 addressed the separate module-category visibility leak.

Live Name Color acceptance then exposed two additional defects. PR #345 moved generated color swatches from guild custom emoji to Sentinal application emoji after the guild reached its custom-emoji limit. PR #346 fixed the follow-up rendering defect where those generated swatches were all gray because the alias layer did not reliably retain discord.js Role color getters. Both fixes are merged and exact-head green.

PR #347 addresses a separate hosted Discord acceptance problem where Sentinal could duplicate module hubs or persistent live-feed panels after deployments or stale/lost message-ledger state. PR #349 adds bounded startup telemetry specifically so the next Railway deployment can prove whether each configured feed recovered/updated the existing canonical panel versus creating a new one, and whether any duplicates were removed. These changes are merged and exact-head green, but **live deployment idempotency is still pending confirmation from the intended Railway/Discord environment**. A successful acceptance result should show existing hubs/feeds reused or updated, stable surviving message IDs, and `duplicatesRemoved=0` on subsequent clean deployments after the first cleanup pass.

These merges remove implementation blockers, but they do **not** establish real-guild acceptance by themselves. The next Name Color acceptance result must show both pages with distinct application-owned color blocks matching their live Discord role colors, while actual role assignment, global color exclusivity, role hierarchy, restart persistence, module visibility isolation, persistent hub/feed idempotency, and legacy-control retirement still require live verification on the intended guild. Generic `LFG` remains intentionally unresolved until an authoritative target exists.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Do not claim:

- owner acceptance without an explicit owner-test result;
- live-provider correctness without real-provider execution;
- real-guild Sentinal acceptance until setup, permissions, reconciliation, panels, commands, event feeds, restart behavior, rank authority, module-access roles/channel visibility, self-role reconstruction/migration, moderation, safety reporting, hosted pairing, persistent hub/feed reconciliation, and relevant hosted-provider flows are exercised on the intended guild;
- updater owner validation until a real installed owner-test update stages/applies/starts and rollback behavior is exercised where appropriate;
- Thora owner validation until discovery/readiness and allowlisted launch behavior is exercised on the intended machine;
- public/stable release status from CI, packaging, deployment, PR merge state, or package version alone.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Owner-test the packaged Admin Control Center, Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, module controls, safe Repair Nexus flow, and current Thora bridge while preserving permission, redaction, audit, secret-storage, and exact commit/artifact boundaries.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths. Validate Pokémon GO presentation, ARK tame presentation, Warframe Archon Hunt reads, and persistent event/news-feed reconciliation in intended Discord surfaces without treating CI as live acceptance.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — ROLE/COLOR FIXES + MODULE ACCESS + IDEMPOTENT HUB/FEED RECONCILIATION MERGED; REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation includes setup/repair, persistent module panels, friendly commands/help, moderation, Pokémon GO operations, event feeds, rank authority, module-access reconciliation, hierarchy diagnostics, protected-role fallback, unified self-role/color menus, reaction-role migration (#331), old button-menu adoption (#335), exact target diagnostics/false-positive filtering (#339), deterministic renamed-panel aliases (#341), custom Name Color swatch preservation (#342), restart menu/swatch reconstruction (#343), strict module category/channel visibility policy (#344), application-owned generated color swatches (#345), live-role-hex color swatches (#346), deployment-idempotent module hubs/live feeds (#347), startup feed-reconciliation acceptance telemetry (#349), private safe-space report tickets (#332), secure hosted pairing, hosted provider administration, and milestone patch-note publishing (#333).

Goals:

- validate the intended guild end-to-end across restart, including migrated/reconstructed panels, actual button assignment, duplicate-role safety, remaining `LFG`, and actual Name Color switching;
- confirm both Name Color pages render distinct application-owned swatches that match the live Discord role colors after #346, with no guild emoji-capacity dependency or fallback-gray regression;
- verify module access-role visibility isolation across game categories/channels, including Shadow Recruit/supporter-role neutrality and staff/admin preservation;
- verify repeated Railway deployments recover/update one canonical module hub and one message per persistent feed action, with no recurring duplicate creation after #347/#349;
- retire old reactions/buttons only after replacement controls are demonstrably active;
- validate Rules/report lifecycle and restricted archive permissions;
- complete remaining Discord + Nexus Setup Acceptance gates, including hosted pairing, live repair where needed, provider sync/validation, and restart persistence;
- validate moderation, temporary lobby lifecycle, discoverability, and Veyra/D&D boundaries.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

Automated packaging/update verification is evidence only. Establish one authoritative rebuild release identity/artifact policy, correlate tested commit/install/update artifacts with feedback and rollback, validate a real installed update/rollback cycle, and keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Selectively port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and capability-driven Discord consoles, keep routine game dashboards out of the desktop, keep Thora bridged from its canonical private project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

The previous self-hosted web + Windows Agent roadmap is not the immediate successor phase for Nexus 0.1.

## Historical stabilization record

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical/rollback evidence. They are superseded as the active implementation direction by Nexus 0.1 but remain preserved.

PR #266 remains **open, draft, mergeable, and unmerged** on `stabilize/nexus-66-baseline`.

Its historical release identity remains display `0.41.2.1`, internal/updater `0.41.3-test.1`, channel `owner-test`, rollback `v0.41.2-B`.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. No newer meaningful `[Owner Test …]` or `[Startup Diagnostics …]` failure was found during this 2026-08-24 synchronization. That issue is historical stabilization evidence and is not Nexus 0.1 validation.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
