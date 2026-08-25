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
- **Veyra** is the authoritative owner of D&D domain state, campaign truth, permissions, and gameplay contracts. Nexus may expose only a bounded authenticated gateway, health/diagnostic evidence, and account/Discord identity context; it must not persist competing D&D state.
- Private/local assistant functionality remains bridged from its canonical private project rather than duplicated into public Sentinal surfaces.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` establishes the thin Electron Admin Control Center, Windows NSIS packaging/shortcuts, backend and Sentinal runtimes, shared scheduler, persistent module consoles, household Accounts & Access, read-only provider validation, staged updating, Owner Test Center/Admin Operations, hosted pairing/provider sync, Setup Center, administrator moderation, Discord Server Shop rank authority, managed ranks presentation, capability-driven help, private safe-space reporting, Community Suggestions voting and protected Owner review, milestone patch-note publishing, managed Community About & Sharing, backend-first game services, and the repository-present Sentinal Shield security layer.

Current game-module registrations documented by the accepted baseline include ARK, Palworld, Minecraft, Warframe, Division 2, Rust, Satisfactory, IdleOn, Nexus D&D, Pokémon GO, **Call of Duty, Dead by Daylight, and Diablo IV**. Newer branch-tip module work must be separately verified and validated before this accepted-baseline list is expanded.

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
- required public 100% milestone publishing for the accepted role-authority section (#356);
- read-only staff Name Color presentation preview (#360) and display-aware conflict diagnostics (#361).

Live evidence records the **Sentinal Discord Role Authority section as accepted at 100%** with 11 current self-role menus, 120 active role options, duplicate platform roles removed, zero legacy reaction candidates remaining, and moderation hierarchy preserved.

The expanded module-access surface reconciles at **13 roles / 1 menu / 0 warnings** after the Call of Duty, Dead by Daylight, and Diablo IV additions.

PR #356 is merged. Railway deployment of merge commit `1832bcc34dfb454f42d6a89b11a3d858d890da2a` posted `sentinal-role-authority:100` exactly once to `#patch-notes`, reported `posted=1 adopted=0 skipped=1 warnings=0`, and therefore satisfies the required public 100% milestone publication for this section.

Issue #350 is now resolved by live evidence rather than a role mutation. PRs #360/#361 proved the protected staff/admin roles above the selectable Name Color block are color-neutral, so Discord's display-color rule does not override the selected Nexus color. Live evidence reported `selectable=32 candidates=0 blocked=0`, `displaySafe=true conflicts=0`, and unified self-role reconciliation at 11 menus / 120 roles / 0 warnings. No staff role color or hierarchy change is required.

### Sentinal persistent-panel and Discord hardening

Merged persistent-panel hardening includes:

- deployment-idempotent managed module hubs and persistent live feeds (#347);
- first-pass live-feed reconciliation telemetry (#349);
- alphabetical game-category reconciliation above Staff/Hidden boundaries plus three new module hubs (#357);
- correction of category insertion order plus automatic creation/self-healing of missing managed hub embeds (#358).

Live Railway evidence after #357/#358/#356 confirms:

- module access startup reconciliation: **13 roles / 1 menu / 0 warnings**;
- managed hub sweep: **12 panels / 0 created / 0 duplicates removed / 0 pins added**;
- Call of Duty, Dead by Daylight, and Diablo IV hubs reuse their existing categories with no duplicate channels;
- module channel access reconciliation: **12 modules / 0 permission changes / 0 blocked**;
- game categories reconcile above the protected Staff boundary in alphabetical module order;
- periodic managed-hub sweeps remain idempotent with **12 panels / 0 created / 0 duplicates removed**;
- persistent feed actions recover/update existing Discord messages with **0 duplicates removed**;
- friendly command registration includes `/nexus`, `/market`, `/ark`, `/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon` without replacing unrelated guild commands.

This live evidence closes the expanded game-category provisioning/order and managed-hub/feed idempotency evidence gates. It does **not** replace real interaction testing of buttons, commands, provider credentials, reports, moderation actions, desktop pairing, or installed updater behavior.

Community Safety & Reporting (#332) and one-time 66%/100% milestone patch-note publishing (#333) remain merged implementation slices. The current runtime reports the private safety-report system ready with three staff roles, the Rules panel ready, and the restricted archive ready; end-to-end report-ticket lifecycle acceptance remains separate.

### INFORMATION category automation

The INFORMATION category now has additional managed-service work:

- PR #366 added the persistent **Nexus Status** panel for Nexus Sentinal gateway/backend health plus Veyra — Lore Master API/Discord gateway health;
- live Railway evidence showed the canonical status panel created/pinned, reused on periodic refresh, and reported `sentinal=online veyra=online` without duplicates;
- PR #367 removed the false-positive EventEmitter listener warning by applying a bounded Sentinal client listener budget rather than disabling warnings;
- PR #369 added event-driven `#welcome` automation using the existing Guild Members intent, scoped mentions to the joining member, ignored bot joins, and linked available onboarding channels;
- PR #371 queued the required public-safe `nexus-service-status:100` milestone note after its exact-head CI passed;
- the current `#game-servers` implementation slice moves server inventory authority to Nexus Backend, permits dynamic ARK/Minecraft tracked-server arrays, and makes Sentinal maintain a pinned `#game-servers` registry from safe backend metadata. Hosted/live acceptance of this newest registry slice must still be recorded after merge/deployment;
- PR #384 merged a managed **Community About & Sharing** surface: Sentinal adopts/reconciles a canonical pinned `#about` panel with a permanent Sentinal invite/share link, safe-space copy, bounded duplicate cleanup, and targeted permission updates;
- PR #385 merged the public-safe `community-about-sharing:100` milestone publisher. Its presence and green CI establish the publisher implementation, not proof that the milestone has posted live.

The `#game-servers` registry intentionally excludes network addresses, ports, RCON passwords, tokens, TLS fingerprints, and other protected connection data from the Discord-facing contract.

### Managed ranks presentation

PR #386 merged a Sentinal-managed canonical ranks panel. It can adopt the existing rank embed, preserve Discord Server Shop as paid-rank authority, add the approved Nexus maintenance/funding disclosure, pin one canonical panel, and retire only high-confidence legacy rank panels. The implementation deliberately makes no paid-role mutation. Exact-head CI is green; real-guild adoption/reconciliation remains separate acceptance evidence.

### Community Suggestions

PR #387 merged the persistent Community Suggestions core with durable `SUG-####` identifiers, managed Discord intake, self-vote prevention, one changeable vote per member, configurable voting thresholds, persistent vote state, and a fail-safe GitHub development queue. Passed suggestions remain recoverable as GitHub Pending when GitHub delivery is unavailable; community passage does not authorize implementation.

PR #389 merged the protected Owner review stage in Staff `#suggestion-review`. Community-passed/GitHub-pending suggestions receive persistent review cards, and configured Nexus Owners/guild Owner can approve implementation or deny with a required reason; public suggestion status is updated from that decision. PR #390 merged the public-safe **Community Suggestions 66%** milestone publisher.

Exact-head CI is green for #387/#389/#390. The 66% milestone establishes the merged core and Owner-review path only; it does **not** establish live end-to-end Discord voting, GitHub handoff, Owner decision, implementation-plan approval, or a 100% completion state.

### Sentinal Shield security

The active rebuild branch now contains a repository-present **Sentinal Shield** security layer. Current code establishes private Shield cases/alerts, conservative scam/phishing/suspicious-link/spam/raid risk handling, staff/owner fail-safe protection against automatic containment, reversible timeout/quarantine controls, evidence-preserving staff review, and a verification-help path. The isolation runtime is wired into Sentinal startup and regression coverage verifies that Shield restores only permission bits it owns, preserves the original baseline across restart/reconciliation, excludes INFORMATION and Staff from quarantine isolation, and targets Nexus/community/game surfaces rather than globally stripping a member's normal roles.

Current branch head `ba5ff1449dff69159084dcd071314af9352ae26e` adds a `sentinel-shield:100` public milestone note to the patch-note publisher. This establishes the **publisher implementation only**. A successful hosted deployment status exists for the current head, but no exact-head Nexus Rebuild CI result or live evidence that the Shield milestone posted/adopted exactly once was located in this check. Therefore **Sentinal Shield is not recorded here as owner/live accepted at 100% yet**, despite the milestone label in code.

Superseded #334/#336/#337/#340 role-migration proposals are historical only; their relevant intent was overtaken by later merged work.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

Recent exact-head automated evidence includes:

- PR #390 head `d90b6c78a87a93bfafa06dfa2d93a7936bef55da` — Nexus Rebuild CI #419 green; adds the public-safe Community Suggestions 66% milestone publisher without establishing live publication or 100% completion;
- PR #389 head `bff497d4774befe39fc3d61ccf22f088af2ab97f` — Nexus Rebuild CI #418 green; adds the protected Owner review queue and approval/required-reason denial path for community-passed suggestions;
- PR #387 head `f01b704ab124ede2cd138e2e0a7753dfad78081b` — Nexus Rebuild CI #415 green; adds persistent Community Suggestions intake/voting, self-vote prevention, configurable gates, and fail-safe GitHub queueing;
- PR #386 head `70a058972610d1cb3112d695790395eed52db7f4` — Nexus Rebuild CI #410 green; adds the managed canonical ranks panel while preserving Server Shop authority and avoiding paid-role mutations;
- PR #385 head `f3c1dd542930f729881ef5a607c0d9b490568149` — Nexus Rebuild CI #407 green; adds the public-safe Community About & Sharing 100% milestone publisher without establishing live publication;
- PR #384 head `d56bf1ed32d66dabfb9e953658aad0239d1bbe3d` — Nexus Rebuild CI #405 green; adds the managed canonical About/share panel and safe reconciliation behavior;
- PR #381 head `5aaf15f914a598a4aa16e700ece348fbffe5966e` — Nexus Rebuild CI #401 green; removes bulk Discord member fetches from the module-access preflight after live Railway startup exposed a rate-limit collision;
- PR #379 head `1f3b12b3e6d1ea463d507492a52c9e0cd3145dc3` — Nexus Rebuild CI #399 green; adds the read-only live module-access acceptance preflight, but its first live deployment exposed the member-fetch collision corrected by #381;
- PR #377 head `ef0a18a085a624aba49f59e608b0e18bed24e4e1` — Nexus Rebuild CI #395 green; makes `staff-offices` a real Discord Forum, preserves the legacy text channel, and adds managed `#roadmap` status presentation;
- PR #373 head `70ea4347c62284d3a2703148180999adfb26b693` — Nexus Rebuild CI #391 green; adds backend-first community XP/leveling with explicit authority separation and keeps 100% acceptance gated on live member/voice/admin/restart testing;
- PR #371 head `70c9bb71ac0b9a58437a1e5e1ed2472068d7cc8f` — Nexus Rebuild CI #385 green before merge; queues the public-safe Nexus Service Status 100% milestone;
- PR #370 head `eae3b1768aa18487d771f99d2f04f82393717280` — full Nexus Rebuild CI green; preserves release-hardening assertions without requiring repository-only docs inside the production Sentinal image;
- PR #369 head `fe38b5680088c45eb152a7be5e42c7a6fd5cbf8d` — welcome automation tests/checks green before merge;
- PR #368 head `9f063d12a208ece6a9f62ca5749e71d48d4ae0e2` — Nexus Rebuild CI green with signing policy, package-content audit, staged update, clean install/upgrade smoke, evidence validation, and artifact upload;
- PR #366 head `af046f29a1f8e9db57c6da0894e00d378eed75e6` — Linux/Windows tests, installer build, staged update, clean-install/upgrade smoke, manifest verification, and artifact upload green before merge;
- PR #364 head `ce62a70715cc1aae59cb6c477aba242ba21c8e65` — Windows CI isolated clean NSIS install, packaged startup/backend-health validation, production staged-upgrade apply, post-update startup confirmation, payload SHA-256 match, and redacted smoke evidence;
- PR #363 head `3ec4a49699dc6961b7f0c9e822e9c1eb61448cbf` — deterministic dependency installs with `package-lock.json`, `npm ci`, and keyed caches;
- PR #362 head `2f9b7559c7595d1ed2461a38b466afc96cdb70b4` — exact validated-artifact promotion with release provenance.

The active rebuild branch has advanced materially beyond the latest exact-head green PR evidence. Current branch-tip work includes Sentinal Shield security/review/isolation, the shared Poll Engine and Discord UI, Suggestions migration onto that engine, managed events with RSVP/scheduling/completion, Content Creator application/review/status/roster infrastructure, normalized managed-panel comparisons, cache-only Staff Workspace discovery, and a bounded Veyra D&D gateway. Local exact-head verification passes **537 tests with 0 failures** plus the repository structure check. Railway deployment `be362e66-7564-4de4-802f-13f7bc106c8a` successfully ran commit `40e54b8`; public health reports Sentinal and backend ready. This is strong automated and hosted-runtime evidence, but the remaining real-member, owner-device, credential-backed, and representational-action gates still require direct acceptance.

Release hardening now also includes an Authenticode policy and packaged-content audit. Owner-test artifacts may remain intentionally unsigned; stable validation must fail closed unless protected Windows signing credentials are configured and the packaged app/installer signatures independently validate.

Automated CI, packaging, smoke validation, and hosted startup evidence do not replace owner/live interaction acceptance.

## Live acceptance state

The Sentinal role-authority subsection is live-accepted at 100%. Expanded game-module provisioning, alphabetical placement, access-policy reconciliation, managed-hub idempotency, persistent-feed recovery, staff-compatible Name Color display safety, and Nexus Sentinal/Veyra service-status visibility also have live evidence.

Late-August operational acceptance work now additionally establishes:

- Poll Engine Phase 2 is wired into Sentinal with persistent Discord controls, reminders, protected audit, and shared Suggestions voting semantics; Suggestions no longer maintains a second vote engine;
- Event Management provides managed Discord event surfaces, durable RSVPs, adoption of scheduling-poll winners, and automatic completion for bounded events;
- Content Creator infrastructure provides durable applications, protected review, managed role provisioning, drift-aware panels, creator status, and an approved roster command;
- `#about`, `#game-servers`, Staff Workspace, and creator panel comparisons normalize Discord response-only decoration so correct messages no longer receive timestamp-only or payload-shape edits;
- Staff Workspace member discovery is cache-only. On deployment `be362e66-7564-4de4-802f-13f7bc106c8a`, startup found four staff members, performed zero structural or panel writes, and the latest 500 runtime entries contain no member-fetch/opcode rate-limit error;
- D&D remains explicitly delegated to Veyra. Nexus advertises `authority: veyra`, validates only Veyra health during provider checks, requires linked actor identity for delegated actions, bounds request time and response size, and persists no campaign truth;

- PR #372 merged the backend-backed `#game-servers` registry and makes **Nexus D&D production/community beta** the explicit final planned continuation rather than an indefinite backlog item;
- PR #373 merged the backend-first Community XP/Leveling system, but its 100% milestone remains gated on live member, voice, admin, badge, restart-persistence, and authority-isolation acceptance;
- PRs #376–#378 merged the protected Staff workspace, real `staff-offices` Forum migration, managed `#roadmap`, and legacy Staff Hub panel adoption without deleting historical staff-office content;
- PR #379 merged a read-only module-access acceptance preflight that checks menu bindings, category/channel permission isolation, and staff visibility without assigning roles or changing permissions;
- the first live #379 deployment revealed a **Discord gateway member-request rate-limit collision** because the preflight performed a bulk member fetch while Staff Workspace was also reconciling members;
- PR #381 merged the corrective snapshot-only audit, reports `bulkMemberFetches=0`, and leaves authoritative current-staff discovery to Staff Workspace. This fixes the audit collision; it does **not** by itself complete the normal-member button/visibility acceptance gate;
- PRs #384/#385 establish the Community About & Sharing implementation and public-safe milestone-publisher path at exact-head CI level. Live confirmation that the canonical About panel/share link is correct and that the milestone is posted/adopted exactly once remains separate acceptance evidence;
- PR #386 establishes the managed ranks panel at exact-head CI level after its initial feature head exposed a missing required funding-disclosure assertion. The corrected head passed CI #410 and merged; real-guild canonical-panel adoption and safe legacy-panel retirement still require live confirmation;
- PRs #387/#389/#390 establish the Community Suggestions core, protected Owner review, and public-safe 66% milestone publisher at exact-head CI level. Live Discord vote behavior, GitHub handoff/retry behavior, Owner decision reflection, and the final implementation-plan approval path remain separate acceptance evidence;
- Sentinal Shield security/review/isolation is repository-present on the current branch and deployed at infrastructure-status level, but its `sentinel-shield:100` publisher, containment behavior, verification-help path, and staff review controls still require exact-head rebuild validation and live acceptance before a 100% accepted status is recorded here.

Remaining live/owner gates include:

- perform the real normal-member module-access button test and confirm the selected module becomes visible while unrelated game modules stay hidden and staff/admin visibility remains intact; use the #381 snapshot-only preflight as supporting evidence, not as a substitute for that interaction;
- validate Staff workspace live acceptance, including non-staff invisibility, Forum office access/privacy, roadmap/admin panels, restart idempotency, and safe treatment of preserved legacy office content;
- validate Community XP/Leveling live message, voice, admin, milestone-role, restart-persistence, and authority-isolation behavior before any 100% claim;
- validate the canonical Community About & Sharing panel/share link in the real guild and confirm the #385 100% milestone publisher posts or adopts exactly once before calling that surface live-accepted;
- validate the canonical managed ranks panel in the real guild, including Server Shop authority wording, funding disclosure, pinning/adoption, and safe retirement of only high-confidence legacy panels;
- validate Community Suggestions end to end with real submitter self-vote rejection, vote changes/tally, timed closure, GitHub handoff/retry, protected Owner approve/deny flow, public status synchronization, and final development-plan approval before any 100% claim;
- validate Sentinal Shield end to end with benign/malicious test cases, staff/owner protection, reversible quarantine, verification-help recovery, restart persistence, staff case controls, and exactly-once milestone publication before accepting its 100% label;
- validate the complete Rules/report ticket lifecycle, evidence flow, close/archive behavior, and restricted archive permissions;
- complete remaining Discord + Nexus Setup Acceptance gates, including fresh hosted pairing, desktop confirmation scan, live Repair Nexus only where needed, provider sync/validation, and desktop/hosted restart persistence;
- validate moderation actions, temporary lobby lifecycle, discoverability, and Veyra/D&D boundaries;
- validate at least one real provider-backed game path with actual credentials/data where required;
- validate the backend-backed `#game-servers` registry against a real tracked-server addition/removal after deployment;
- validate updater apply/startup/rollback on an installed owner-test machine despite the now-green isolated Windows CI smoke path;
- validate the private assistant discovery/readiness and allowlisted launch behavior on the intended machine.

Do not claim public/stable release status from CI, packaging, deployment, PR merge state, package version, or hosted-service availability alone.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS — AUTOMATED BASELINE GREEN; OWNER ACCEPTANCE PENDING**

Owner-test the packaged Admin Control Center, Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, module controls, safe Repair Nexus flow, and current private assistant bridge while preserving permission, redaction, audit, secret-storage, and exact commit/artifact boundaries.

### Next — Provider-backed game services

Status: **IN PROGRESS — PROVIDERS + HOSTED SYNC + READ-ONLY VALIDATION + EVENT FEEDS + COMPANION FLOWS MERGED; LIVE/OWNER VALIDATION REQUIRED**

Validate Palworld and other provider-backed paths in real use. Include Pokémon GO, ARK taming, Warframe Archon Hunt, Dead by Daylight public/community reads, Call of Duty safe/local companion surfaces, Diablo IV safe/local companion surfaces, persistent event/news feeds, and the backend-backed tracked-server registry without treating CI as live interaction acceptance.

### Then — Sentinal operational acceptance

Status: **IN PROGRESS — ROLE AUTHORITY + MODULE LAYOUT/IDEMPOTENCY + NAME-COLOR DISPLAY + SERVICE STATUS LIVE-EVIDENCED; STAFF/MODULE/COMMUNITY/SHIELD INTERACTION ACCEPTANCE PENDING**

The self-role/role-authority subsection is live-accepted at 100%. Expanded module layout, access reconciliation, category order, hub idempotency, feed recovery, staff-compatible Name Color display safety, Nexus service status, and new-member welcome automation now have implementation/live evidence at their respective levels. The protected Staff workspace, Forum/roadmap migration, Community XP/Leveling, Community About & Sharing, managed ranks presentation, Community Suggestions core/Owner review, read-only module-access preflight, and Sentinal Shield security/review/isolation layer are implemented at their respective evidence levels. Broader Sentinal operational acceptance still requires real-member module interaction, Staff workspace privacy/idempotency checks, Community XP live acceptance, About/ranks live acceptance, Community Suggestions end-to-end acceptance, Shield exact-head/live acceptance, reporting lifecycle, moderation, pairing, provider flows, Setup Acceptance, and restart behavior.

### Release hardening

Status: **IN PROGRESS — DETERMINISTIC INSTALLS + EXACT-ARTIFACT PROMOTION + WINDOWS INSTALL/UPGRADE SMOKE + PACKAGE AUDIT/SIGNING GATES MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

The rebuild now has deterministic `npm ci` dependency installs, exact validated-artifact promotion with provenance, Windows CI that exercises a real isolated NSIS install plus staged update/apply/startup verification, packaged-content auditing, and a fail-closed stable Authenticode policy. This is strong automated release evidence, not public/stable release authorization. The remaining primary release-hardening gate is an actual installed owner-machine update/startup/rollback cycle correlated to the tested artifact and feedback; stable signing credentials remain an explicit protected prerequisite for a signed stable artifact.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Selectively port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and capability-driven Discord consoles, keep routine game dashboards out of the desktop, keep private assistant functionality bridged from its canonical project, and consider future web/public surfaces only when they support rather than duplicate protected authority.

The previous self-hosted web + Windows Agent roadmap is not the immediate successor phase for Nexus 0.1.

### Final planned continuation — Nexus D&D production and community beta

Status: **QUEUED SUCCESSOR PHASE — MUST TRANSITION INTO ACTIVE PRODUCTION AFTER THE NEXUS 0.1 CORE/DISCORD ROADMAP IS STABLE ENOUGH**

Nexus D&D is the planned continuation at the end of the current roadmap, not an unscheduled future idea. The detailed production handoff is [`NEXUS_DND_PRODUCTION_CONTINUATION.md`](NEXUS_DND_PRODUCTION_CONTINUATION.md).

The D&D continuation will:

1. establish canonical/versioned rules, character-creation, map/world, and Khaos Nexus homebrew content assets;
2. complete Veyra-owned campaign, character, session, encounter, content/homebrew, map, and permission contracts;
3. migrate the strongest validated Co-DM, homebrew-proposal, procedural-map, and explicit AI Game Master behaviors into Veyra without restoring the old monolithic architecture or creating a Nexus-owned campaign database;
4. build a normal-player character/campaign client and a DM world/campaign builder;
5. implement the intended exploration-to-tactical-combat transition and complete encounter lifecycle;
6. keep Discord as the lightweight campaign coordination/access bridge rather than a second campaign database;
7. move to a closed community beta as soon as the core campaign loop is safe and usable;
8. complete multi-user, permission, migration, recovery, installer/updater, privacy, security, and source-provenance hardening before broader release.

The first active D&D checkpoint after handoff is **DND-01 content inventory plus DND-02 Veyra contract/repository inventory and gap analysis**, followed immediately by a beta-critical-path implementation sequence in the Veyra-owned codebase. The roadmap must not silently return D&D to an indefinite backlog after Nexus acceptance.

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
- **Final planned continuation — Nexus D&D production and community beta**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, major migration direction, or D&D production handoff materially changes.
