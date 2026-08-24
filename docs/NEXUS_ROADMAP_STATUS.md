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
- strict module channel visibility reconciliation (#344), where `@everyone` is denied, the matching module access role is allowed, supporter/rank and nonmatching module visibility grants are neutralized, and existing staff/admin overrides plus non-`View Channel` bits are preserved.

Community Safety & Reporting (#332) and one-time 66%/100% milestone patch-note publishing (#333) are merged implementation slices. Live report-ticket acceptance remains separate from implementation completion.

Superseded #334/#336/#337/#340 role-migration proposals are not active roadmap items; their relevant intent was overtaken by the merged #339/#341 path.

These are implementation facts, not final owner-acceptance or release claims.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #344 head `da9237a3c2634c39a87921e4cbcd586d50cfbda0`**. **Nexus Rebuild CI run #305 completed successfully on that exact SHA**, and PR #344 then merged into `rebuild/nexus-0.1` as `8070ec1c102ac1fcd901f82de3cc2bf60762b791`.

Recent exact-head evidence:

- PR #343 head `12e11736015172b40868b337d0e95da3bc26c63f` — Nexus Rebuild CI #299 green; merged as `3cd84cdf617619dffea9ffdd83ddb288356f2f3a`;
- PR #342 head `0702ca5c78faa156022ee45859ec0faf35fde5cb` — Nexus Rebuild CI #296 green;
- PR #341 head `a2e20744a0dc320fb660a074563379332f663081` — Nexus Rebuild CI #294 green;
- PR #339 head `4762480c0d894ecf7eae3bcfa3f506d7d530f701` — Nexus Rebuild CI #291 green.

### Live acceptance state

PR #343 resolved the previously documented restart-recovery implementation defect and is no longer an open blocker. Current self-role menus can be reconstructed after Sentinal restart only when every live button maps safely to exactly one existing role, and Name Color swatches can be recovered deterministically or generated from the already-configured role color.

PR #344 addresses a separate live permission defect discovered after the role-menu work: game categories/channels were not consistently enforcing their matching module access roles, allowing legacy/rank visibility to leak across module chats. The merged policy now reconciles module category and child-channel `View Channel` behavior while preserving staff/admin overrides and refusing to lock a category when the matching module role cannot be resolved.

These merges remove two implementation blockers, but they do **not** establish real-guild acceptance by themselves. Restart recovery, actual role assignment, Name Color switching/swatches, module visibility isolation, hierarchy behavior, and legacy-control retirement still require live verification on the intended guild. Generic `LFG` remains intentionally unresolved until an authoritative target exists.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Do not claim:

- owner acceptance without an explicit owner-test result;
- live-provider correctness without real-provider execution;
- real-guild Sentinal acceptance until setup, permissions, reconciliation, panels, commands, event feeds, restart behavior, rank authority, module-access roles/channel visibility, self-role reconstruction/migration, moderation, safety reporting, hosted pairing, and relevant hosted-provider flows are exercised on the intended guild;
- updater owner validation until a real installed owner-test update stages/applies/starts and rollback behavior is exercised where appropriate;
- Thora owner validation until discovery/readiness and allowlisted launch behavior is exercised on the intended machine;
- public/stable release status from CI, packaging, deployment, PR merge state, or package version alone.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Owner-test the packaged Admin Control Center, Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, module controls, safe Repair Nexus flow, and current Thora bridge while preserving permission, redaction, audit, secret-storage, and exact commit/artifact boundaries.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

The next factual gate is live/provider evidence, beginning with Palworld status and then other supported provider paths. Validate Pokémon GO presentation, ARK tame presentation, and Warframe Archon Hunt reads in intended Discord surfaces without treating CI as live acceptance.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — RESTART RECOVERY + MODULE CHANNEL ACCESS POLICY MERGED; REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation includes setup/repair, persistent module panels, friendly commands/help, moderation, Pokémon GO operations, event feeds, rank authority, module-access reconciliation, hierarchy diagnostics, protected-role fallback, unified self-role/color menus, reaction-role migration (#331), old button-menu adoption (#335), exact target diagnostics/false-positive filtering (#339), deterministic renamed-panel aliases (#341), custom Name Color swatch preservation (#342), restart menu/swatch reconstruction (#343), strict module category/channel visibility policy (#344), private safe-space report tickets (#332), secure hosted pairing, hosted provider administration, and milestone patch-note publishing (#333).

Goals:

- validate the intended guild end-to-end across restart, including migrated/reconstructed panels, actual button assignment, duplicate-role safety, remaining `LFG`, and actual Name Color switching/swatches;
- verify module access-role visibility isolation across game categories/channels, including Shadow Recruit/supporter-role neutrality and staff/admin preservation;
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

PR #266 remains **open, draft, mergeable, and unmerged** on `stabilize/nexus-66-baseline`, currently at head `6140a5e2c74582e11180136ca04c1257452947c1`.

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