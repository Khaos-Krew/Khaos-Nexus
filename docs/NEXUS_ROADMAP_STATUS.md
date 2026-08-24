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
- **Khaos Nexus Desktop** is the privileged Admin Control Center for Discord/Sentinal administration, accounts/access, backend/module/service configuration, diagnostics, recovery, updates, scheduler administration, integrations, owner testing, and the private-edition assistant bridge.
- **Veyra** may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- Private/local assistant functionality remains bridged from its canonical private project rather than duplicated into public Sentinal surfaces.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` establishes the thin Electron Admin Control Center, Windows NSIS packaging/shortcuts, backend and Sentinal runtimes, shared scheduler, persistent module consoles, household Accounts & Access, read-only provider validation, staged updating, Owner Test Center/Admin Operations, hosted pairing/provider sync, Setup Center, administrator moderation, Discord Server Shop rank authority, capability-driven help, private safe-space reporting, milestone patch-note publishing, and backend-first game services.

Current game-module registrations include ARK, Palworld, Minecraft, Warframe, Division 2, Rust, Satisfactory, IdleOn, Nexus D&D, Pokémon GO, **Call of Duty, Dead by Daylight, and Diablo IV**.

Provider/companion evidence includes:

- interactive ARK taming guidance and `#ark-tame-info` presentation;
- read-only Warframe Archon Hunt data;
- Pokémon GO backend-first operations and event surfaces;
- Dead by Daylight public/community provider routing through Tricky/NightLight surfaces;
- Call of Duty safe/local loadout, LFG, official patch-notes, and API-safety surfaces without protected/undocumented player-stat scraping;
- Diablo IV class/build/LFG/news/API-safety surfaces without claiming a Blizzard live character/inventory API that does not exist.

### Sentinal role/self-role authority

Merged role/self-role work includes:

- unified generic self-role and global Name Color ownership (#329);
- bounded legacy-menu discovery (#330);
- legacy emoji reaction-role migration (#331);
- direct adoption of old bot-authored Nexus role-button menus (#335);
- exact old-button target diagnostics and false-positive filtering (#339);
- deterministic title-scoped aliases for renamed live panels (#341);
- preservation/rendering of custom Discord color-swatch emoji (#342);
- restart reconstruction of current self-role menus (#343);
- strict module channel visibility reconciliation (#344);
- application-owned generated Name Color swatches (#345);
- live-role-hex swatch rendering (#346);
- owner-approved duplicate platform-role consolidation, generic `LFG` retirement, old gray-swatch cleanup, old-panel cleanup, and canonical module-hub pinning (#351);
- safe Guild Members intent preflight/construction fixes (#352–#354);
- serialized/coalesced role reconciliation after live duplicate-role cleanup (#355);
- required public 100% milestone publishing for the accepted role-authority section (#356).

Live evidence records the **Sentinal Discord Role Authority section as accepted at 100%** with 11 current self-role menus, 120 active role options, duplicate platform roles removed, zero legacy reaction candidates remaining, and moderation hierarchy preserved.

The expanded module-access surface now reconciles at **13 roles / 1 menu / 0 warnings** after the Call of Duty, Dead by Daylight, and Diablo IV additions.

PR #356 is merged. Railway deployment of merge commit `1832bcc34dfb454f42d6a89b11a3d858d890da2a` posted `sentinal-role-authority:100` exactly once to `#patch-notes`, reported `posted=1 adopted=0 skipped=1 warnings=0`, and therefore satisfies the required public 100% milestone publication for this section.

Selectable Name Color roles remain below protected moderation/admin roles. The live reconciler correctly refuses to weaken that hierarchy and emits a bounded warning for staff-visible color priority. Issue #350 tracks the already-approved follow-up design for staff-compatible selectable colors without moving shared selectable roles above moderation authority.

### Sentinal persistent-panel and Discord hardening

Merged persistent-panel hardening includes:

- deployment-idempotent managed module hubs and persistent live feeds (#347);
- first-pass live-feed reconciliation telemetry (#349);
- alphabetical game-category reconciliation above Staff/Hidden boundaries plus three new module hubs (#357);
- correction of category insertion order plus automatic creation/self-healing of missing managed hub embeds (#358).

Live Railway evidence after #357/#358/#356 now confirms:

- module access startup reconciliation: **13 roles / 1 menu / 0 warnings**;
- managed hub sweep: **12 panels / 0 created / 0 duplicates removed / 0 pins added**;
- Call of Duty hub: existing category reused, `created=false`, `channelsAdded=0`;
- Dead by Daylight hub: existing category reused, `created=false`, `channelsAdded=0`;
- Diablo IV hub: existing category reused, `created=false`, `channelsAdded=0`;
- module channel access reconciliation: **12 modules / 0 permission changes / 0 blocked**;
- game categories reconciled above the protected Staff boundary in the order `ARK Survival Ascended > Call of Duty > Dead by Daylight > Diablo IV > Legends of IdleOn > Minecraft > Palworld > Pokémon GO > Rust > Satisfactory > The Division 2 > Warframe`;
- the periodic managed-hub sweep remains idempotent with **12 panels / 0 created / 0 duplicates removed**;
- persistent feed actions recovered or updated their existing Discord messages with **0 duplicates removed**, including Palworld, Satisfactory, Rust, Minecraft, ARK, Pokémon GO, Division 2, and Warframe feeds;
- friendly command registration includes `/nexus`, `/market`, `/ark`, `/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon` without replacing unrelated guild commands.

This live evidence closes the expanded game-category provisioning/order and managed-hub/feed idempotency evidence gates. It does **not** replace real interaction testing of buttons, commands, provider credentials, reports, moderation actions, desktop pairing, or installed updater behavior.

Community Safety & Reporting (#332) and one-time 66%/100% milestone patch-note publishing (#333) remain merged implementation slices. The current runtime reports the private safety-report system ready with three staff roles, the Rules panel ready, and the restricted archive ready; end-to-end report-ticket lifecycle acceptance remains separate.

Superseded #334/#336/#337/#340 role-migration proposals are historical only; their relevant intent was overtaken by later merged work.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

Recent exact-head automated evidence:

- PR #358 head `e2c7e89e355b1ec103292afa975f4715237fd20c` — Nexus Rebuild CI #344 green; merged;
- PR #357 head `e5fae99ccb859792253e6233db3d3af2fcf4ed99` — Nexus Rebuild CI #342 green; merged;
- PR #356 head `e10b31abf95d00505105eff1ba5c54329414a37a` — Nexus Rebuild CI #338 green; merged after that validation;
- PR #355 head `26faed57e8015354cec88fd4e89efaf67b80649d` — green before merge;
- PR #349 head `0d300731bf3d8c5c55fb8651cd5e4657416aa4e2` — Nexus Rebuild CI #322 green; merged;
- PR #347 head `c3bd6e652f930c443b99ff474eea049e3a692da0` — Nexus Rebuild CI #320 green; merged.

The merged production-test branch then deployed successfully on Railway at merge commit `1832bcc34dfb454f42d6a89b11a3d858d890da2a`, where the live evidence above was recorded.

Automated CI and hosted startup evidence do not replace owner/live interaction acceptance.

## Live acceptance state

The Sentinal role-authority subsection is live-accepted at 100%. Expanded game-module provisioning, alphabetical placement, access-policy reconciliation, managed-hub idempotency, and persistent-feed recovery now also have live Railway evidence.

Remaining live/owner gates include:

- validate real module button/command usage and module access-role visibility isolation from a normal member account without breaking staff/admin visibility;
- validate the complete Rules/report ticket lifecycle, evidence flow, close/archive behavior, and restricted archive permissions;
- complete remaining Discord + Nexus Setup Acceptance gates, including fresh hosted pairing, desktop confirmation scan, live Repair Nexus only where needed, provider sync/validation, and desktop/hosted restart persistence;
- validate moderation actions, temporary lobby lifecycle, discoverability, and Veyra/D&D boundaries;
- validate at least one real provider-backed game path with actual credentials/data where required;
- validate updater apply/startup/rollback on an installed owner-test build;
- validate the private assistant discovery/readiness and allowlisted launch behavior on the intended machine;
- preview and explicitly approve any live staff-presentation migration required by issue #350 before changing staff role appearance.

Do not claim public/stable release status from CI, packaging, deployment, PR merge state, package version, or hosted-service availability alone.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Owner-test the packaged Admin Control Center, Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, module controls, safe Repair Nexus flow, and current private assistant bridge while preserving permission, redaction, audit, secret-storage, and exact commit/artifact boundaries.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

Validate Palworld and other provider-backed paths in real use. Include Pokémon GO, ARK taming, Warframe Archon Hunt, Dead by Daylight public/community reads, Call of Duty safe/local companion surfaces, Diablo IV safe/local companion surfaces, and persistent event/news feeds without treating CI as live interaction acceptance.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — ROLE AUTHORITY + MODULE LAYOUT/IDEMPOTENCY LIVE-EVIDENCED; INTERACTION ACCEPTANCE PENDING**

The self-role/role-authority subsection is live-accepted at 100%. Expanded module layout, access reconciliation, category order, hub idempotency, and feed recovery now have live Railway evidence. Broader Sentinal operational acceptance still requires real-member interaction testing, reporting lifecycle, moderation, pairing, provider flows, Setup Acceptance, and restart behavior.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

Automated packaging/update verification is evidence only. Establish one authoritative rebuild release identity/artifact policy, correlate tested commit/install/update artifacts with feedback and rollback, validate a real installed update/rollback cycle, and keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Selectively port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and capability-driven Discord consoles, keep routine game dashboards out of the desktop, keep private assistant functionality bridged from its canonical project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

The previous self-hosted web + Windows Agent roadmap is not the immediate successor phase for Nexus 0.1.

## Historical stabilization record

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical/rollback evidence. They are superseded as the active implementation direction by Nexus 0.1 but remain preserved.

PR #266 remains **open, draft, and unmerged** on `stabilize/nexus-66-baseline`.

Its historical release identity remains display `0.41.2.1`, internal/updater `0.41.3-test.1`, channel `owner-test`, rollback `v0.41.2-B`.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. That issue is historical stabilization evidence and is not Nexus 0.1 validation.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.