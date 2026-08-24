# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Owner: Production / stabilization process  
Consumers: Nexus Doc Watch, repository documentation maintainers, release/status reporting  
Repository: `Khaos-Krew/Khaos-Nexus`

## Purpose

This file is the canonical roadmap/status handoff between production work and the **Nexus Doc Watch** documentation monitor.

The README roadmap must be updated from **repository reality plus this file**, not from chat memory, old release notes, abandoned branches, or rejected test builds.

The Doc Watch may update README roadmap/status content without owner approval when the change is a factual synchronization with GitHub reality.

## Current product line

- Main product line: **0.41.x**
- Active owner-test display version: **0.41.2.1**
- Internal Electron/npm updater identity: **0.41.3-test.1**
- Owner-test channel: **owner-test**
- Current rollback target for the owner-test line: **v0.41.2-B**
- Active stabilization branch: `stabilize/nexus-66-baseline`
- Active stabilization PR: **#266 — stabilization: establish Nexus 66% golden baseline**
- Merged owner-test implementation source: **#281 — owner-test: Nexus 0.41.2.1 versioned test line**
- Temporary `Nexus Sentinel 0.33.0 RC1`: **REJECTED / HISTORICAL ONLY**

`config/release-identity.json` is authoritative for the active build identity. The current owner-test identity has no public tag and must not be described as a published GitHub Release merely because artifacts or package metadata exist.

The 0.33.0 Sentinel RC1 line must never be presented as a successor to the main 0.41.x Khaos Nexus line.

## Current phase

**STABILIZATION RESET — OWNER TEST ACTIVE**

Feature expansion remains frozen while the desktop application is brought to a dependable baseline.

The planned self-hosted web/backend migration remains deferred until the desktop stabilization target is accepted.

Android Companion / Mobile Gateway **owner-test validation is explicitly resumed** for the active 0.41.x stabilization effort. PR #281 merged matched Windows + Android owner-test packaging and versioning into the stabilization branch. This does not authorize public/stable Android publication.

## Golden UI baseline

The approved modern desktop shell remains required.

Required invariants:

- `nexus-v8` branding layer is present.
- Desktop shell/sidebar remains approximately **286px** wide at the supported baseline viewport.
- Navigation labels are fully readable and not clipped to only a few characters.
- Approved navigation ordering is preserved.
- Modern Khaos Nexus loading/startup presentation is preserved.
- Old loading screens, legacy sidebar layouts, stale navigation shells, and fallback renderer presentation are regressions.

## Functional stability gates

The stabilization score is measured against these 12 gates:

| # | Gate | Current roadmap state |
|---|---|---|
| 1 | Startup/loading | Automated startup checks and packaged startup/clean-install smoke pass; installed owner-test startup health is clean; packaged visual/loading-presentation proof still required |
| 2 | Sidebar/navigation | Golden-shell source regression tests pass and the 0.41.2.1 owner-test line includes the sidebar-label regression repair; packaged visual/navigation-invariant proof still required |
| 3 | Settings persistence | Stabilization required |
| 4 | Discord login/bot supervision | Stabilization required |
| 5 | Discord status/control panel | Stabilization required |
| 6 | Palworld server configuration | Stabilization required |
| 7 | Palworld status/player reads | Stabilization required |
| 8 | Palworld command/action execution | Stabilization required |
| 9 | Shared scheduler | Stabilization required |
| 10 | Module enable/disable | Stabilization required |
| 11 | Updater/manual release detection | Owner-test version/artifact identity is enforced; public-release/manual updater acceptance still required |
| 12 | Backup/restore | Stabilization required |

Thresholds remain:

- **8/12** = minimum owner-test candidate
- **10/12** = beta quality
- **12/12** = release-candidate quality

The Doc Watch must not claim a numeric score unless repository and owner-test evidence establishes which gates pass.

## Active roadmap

### Phase S0 — Stabilization governance

Status: **IN PROGRESS**

Goals:

- Freeze feature expansion.
- Maintain one active stabilization branch.
- Maintain one authoritative version identity.
- Prevent rejected/legacy product branches from becoming release ancestry.
- Convert owner-reported regressions into permanent automated guards.

### Phase S1 — Golden desktop shell

Status: **IN PROGRESS**

Current evidence:

- PR #281 was merged into `stabilize/nexus-66-baseline` as merge commit `614e3179794ff659fefa24122b4ee02157b0dee2`;
- CI, Windows Build, Diagnostics Runtime Integration, and Bundled AI Runtimes all passed on that exact merge head;
- the merged 0.41.2.1 owner-test line includes the sidebar-label regression repair, visible four-part build identity, matched Windows/Android owner-test artifact identity, and owner-test version enforcement;
- the golden-shell regression tests continue to verify the `nexus-v8` branding layer and 286px sidebar invariant;
- a new installed owner-test startup diagnostic created on 2026-08-22 reports application `0.41.3-test.1` with **8 passed, 0 warnings, 0 failures**, responsive desktop windows, writable application data, configuration present, protected storage present, and no unclean previous session;
- that startup diagnostic confirms a healthy installed owner-test session but does not record an exact Git commit/branch identity, so it is supporting runtime evidence rather than proof that the exact PR #266 head passed owner acceptance;
- packaged startup smokes and startup diagnostics verify readiness/responsiveness, but do not yet prove the exact packaged visual/sidebar/loading invariants required to exit S1.

Goals:

- Preserve the modern Khaos Nexus startup/loading presentation.
- Preserve the current sidebar width and navigation ordering.
- Guarantee full readable navigation labels.
- Add packaged-app UI/visual regression checks.
- Reject any candidate that falls back to a legacy shell.

Exit condition: startup/loading and sidebar/navigation gates are proven by automated packaged-app checks and owner acceptance does not reveal a shell regression.

### Phase S1A — Nexus Sentinel Staff/Admin Console & Staff Workspace Rebuild

Status: **PLANNED — IMMEDIATELY AFTER CURRENT ACTIVE STABILIZATION WORK**

Scheduling rule:

- Do not interrupt the stabilization work already in progress.
- Begin this phase immediately after the current active stabilization task reaches its acceptance point, before moving on to the remaining lower-priority planned Discord usability work.
- Implement behind existing Sentinel/Discord boundaries so the feature does not destabilize the accepted desktop shell.

Staff workspace goals:

- Replace the crowded single STAFF category with a cleaner **Staff Hub**, **Staff Operations**, and private case/ticket structure.
- Keep normal staff conversation separate from bot telemetry, moderation records, administrative audit data, and developer/build feeds.
- Consolidate redundant operational channels where practical, including sync/module activity into a Sentinel operations feed.
- Keep moderation logs, administrative audit logs, and error alerts separated by purpose and permissions.
- Move GitHub/build/deployment activity into a dedicated development/operations feed rather than normal staff chat.
- Support private report/case channels with reporter + authorized staff visibility only and restricted archival handling.

Temporary staff office goals:

- Replace permanent per-staff-member office voice channels with a single **Create Office** join-to-create voice channel.
- Create `🔒 <Display Name>'s Office` automatically when an authorized staff member joins the creator channel and move them into the new room.
- Allow the office owner to lock/unlock the room, invite/remove users, set a user limit, and optionally rename the temporary office within safe naming rules.
- Limit each staff member to one temporary office at a time.
- Automatically delete temporary offices after they remain empty for the configured cleanup period.
- Preserve one permanent Staff Lounge and one permanent Staff Meeting room.

Administrator console goals:

- Publish one persistent **Nexus Sentinel — Administration Console** embed in the designated admin-console channel.
- Keep the embed synchronized with the currently enabled administrator actions rather than relying on a manually maintained command list.
- Attach user-friendly buttons for **Save World**, **Broadcast**, **Kick Player**, **Ban Player**, **Unban**, **Shutdown**, **Force Stop**, **RCON Console**, and **Restart Sentinel**.
- Use select menus for configured server selection wherever Discord component limits allow, avoiding exact server-name typing.
- Filter or disable actions according to the selected server adapter's supported capabilities.
- Open ephemeral forms/modals for the parameters needed by the selected action, such as player/account ID, reason, broadcast text, shutdown delay/message, or console command.
- Use explicit confirmation steps for destructive actions such as bans, shutdowns, force stops, and other actions where accidental execution could affect players or server availability.
- Require stronger typed confirmation for emergency force-stop behavior.
- Return private/ephemeral execution receipts containing the target server, action summary, actor, outcome, and audit/case identifier where applicable.
- Write protected administrative actions to the Nexus audit pipeline without leaking passwords, tokens, raw secrets, or other protected connection data.
- Keep existing slash commands as the advanced/fallback interface so button UI failure does not remove administrative authority.
- Preserve the existing security rule that raw RCON execution is restricted to the configured **Khaos Nexus Owner**, even when other users have Discord Administrator permission.

Privacy and edition boundary:

- Public, community, staff, moderator, and administrator command/reference surfaces must **never mention, reference, hint at, enumerate, or expose Thora or private-edition-only functionality**.
- Command/reference generation must filter private-edition actions at the data/model layer rather than relying only on manually removing text from an embed.
- Audit output visible to normal staff must not leak private-edition command names, private configuration, secrets, or private account data.

Validation requirements:

- Automated tests for button routing, modal validation, select-menu server targeting, permission enforcement, capability filtering, destructive-action confirmations, ephemeral response behavior, and audit emission.
- Regression tests proving slash-command fallback remains functional.
- Regression tests proving non-owner administrators cannot execute raw RCON through either slash commands or buttons/modals.
- Regression tests proving private-edition/Thora-related actions cannot appear in generated staff/admin command references or interaction components.
- Owner acceptance of the final Discord layout and mobile usability before this phase is marked complete.

Exit condition: staff/admin Discord organization is visibly cleaner, temporary offices work without orphan channels, the button-driven administration console can safely perform every currently supported admin action, slash commands remain a functioning fallback, security/audit behavior passes tests, and no private-edition functionality is exposed.

### Phase S2 — Core persistence and module stability

Status: **PLANNED / NEXT**

Goals:

- Verify settings persistence.
- Verify module enable/disable behavior.
- Verify shared scheduler authority and recovery.
- Verify backup/restore behavior.
- Remove obsolete compatibility paths that conflict with the current baseline.

### Phase S3 — Discord operational baseline

Status: **PLANNED**

Goals:

- Verify Discord login/auth flow.
- Verify supervised bot startup/recovery.
- Verify status/control panels.
- Verify critical Discord actions without duplicate authority paths.

### Phase S4 — Palworld operational baseline

Status: **PLANNED**

Goals:

- Verify Palworld configuration persistence.
- Verify REST/status/player reads.
- Verify guarded command/action execution.
- Verify server-control behavior without regressing the shared desktop shell.

### Phase S5 — Release and updater reliability

Status: **IN PROGRESS / OWNER-TEST HARDENING**

Current evidence:

- `config/release-identity.json` now owns the active owner-test identity `0.41.2.1` / internal `0.41.3-test.1` / rollback `v0.41.2-B`;
- the active owner-test identity intentionally has an empty public tag and channel `owner-test`;
- Windows installer and portable artifact names carry visible version `0.41.2.1`;
- Android `versionName`/`versionCode` and owner-test artifact naming are tied to the same visible identity;
- CI, Windows Build, Diagnostics Runtime Integration, and Bundled AI Runtimes all passed on merge head `614e3179794ff659fefa24122b4ee02157b0dee2`;
- PR #281 records that the owner-test pair is not a public Android or stable release.

This is partial release-hardening evidence only. It does **not** establish public publication, stable release readiness, manual release detection acceptance, in-app updater acceptance, or final owner release approval.

Goals:

- Use one authoritative release identity.
- Keep package version, display version, updater version, artifact names, notes, and rollback target synchronized.
- Ensure the artifact delivered to the owner is the same packaged build that passed CI.
- Verify manual release detection/download path.
- Repair and validate the in-app updater separately from owner-test artifact readiness.
- Keep owner-test artifacts clearly separated from public/stable release publication.

### Phase S6 — Owner acceptance

Status: **IN PROGRESS — OWNER TEST ACTIVE**

Current evidence:

- the 0.41.2.1 owner-test line is merged into the active stabilization branch;
- exact merge-head CI/Windows/Diagnostics/Bundled-AI validation is green;
- an installed `0.41.3-test.1` startup session produced a healthy automatic diagnostic with 8/8 startup health checks passing;
- no final owner acceptance result is recorded by this evidence alone.

Rules:

- Owner testing should focus on real-world behavior automation cannot prove.
- A major shell/loading/navigation regression automatically fails the candidate regardless of numeric score.
- Do not infer a final stabilization score from the owner-test version or from a healthy startup diagnostic.
- Do not mark owner acceptance complete until an explicit acceptance result is recorded.

### Phase W1 — Self-hosted web migration

Status: **DEFERRED**

Direction:

- Khaos Nexus Web
- Khaos Nexus Backend/API
- lightweight Windows Nexus Agent for local-machine authority

This phase does not begin until the desktop baseline is accepted.

### Phase G1 — Backend-first game module expansion

Status: **PLANNED / DEFERRED UNTIL STABILIZATION ACCEPTANCE**

Direction:

- Game modules move toward backend-first services with Nexus Sentinel as the primary Discord-facing interface.
- The Windows desktop remains the administrative, configuration, diagnostics, and recovery surface rather than carrying game-specific user workflows.
- Each game module should use a manifest/adapter boundary so external data providers can be replaced without rewriting Sentinel interactions.
- Prefer official APIs first, then stable documented third-party APIs with explicit usage permission. Do not depend on private gameplay endpoints, credential replay, client reverse engineering, or automation that violates a game's service rules.

#### Planned Pokémon GO Sentinel module

First usable release scope:

- Module manifest and automatic Pokémon GO access-role registration.
- External Pokémon GO data adapter with validation, normalization, caching, health checks, and provider-fallback boundaries.
- Pokédex, moves, types, forms, evolutions, shiny availability, and related reference data.
- Current raids and raid-boss presentation.
- Current Max Battles.
- Current Field Research.
- Current events.
- Raid/counter recommendation engine.
- Permanent Discord Pokémon GO Hub using buttons, select menus, modals, and ephemeral interaction responses where appropriate.
- Short fallback commands such as `/pogo`, `/pogo pokemon`, `/pogo raids`, `/pogo max`, `/pogo research`, `/pogo events`, and `/pogo counters`.

Follow-on scope:

- Nexus-managed trainer profiles using user-entered data rather than Pokémon GO private-account access.
- Friend-code registry.
- Community raid groups and host/join controls.
- Notification preferences for raids/events.
- Shiny/wishlist tracking with event/raid matches.
- Community trade board and trade-match suggestions.
- Nexus Admin controls for module status, data-source health, cache state, synchronization, Discord panel repair, alert configuration, and diagnostics.

Safety/compatibility constraints:

- Do not authenticate into Pokémon GO player accounts through undocumented/private endpoints.
- Do not automate catches, spins, trades, gifts, raids, movement, or other in-game actions.
- Do not build around archived/reverse-engineered Pokémon GO client APIs.
- Keep external-provider calls behind the Nexus backend adapter/cache rather than issuing provider requests directly from Discord interactions.

Exit condition: after stabilization acceptance and authorization to resume feature expansion, the first usable Pokémon GO scope passes backend adapter tests, cache/provider-failure tests, Discord interaction tests, access-role tests, and owner acceptance without destabilizing the desktop baseline.

## Mobile owner-test validation

Status: **ACTIVE FOR OWNER TEST / PUBLIC-STABLE RELEASE NOT AUTHORIZED**

Current evidence:

- PR #281 merged the resumed owner-test Android workflow and matched Windows/Android build identity into the stabilization branch;
- active tests cover Android owner-test security policy, Mobile Gateway HTTPS/TLS health, QR pairing, read-only module promotion, version identity, and combined Windows/Android owner-test guidance;
- the owner-test Android workflow builds and verifies signed/checksummed APK artifacts for the authorized owner-test scope;
- this does not establish public/stable Android publication or production exposure acceptance.

## Recently rejected direction

### Nexus Sentinel 0.33.0 RC1

Status: **FAILED OWNER ACCEPTANCE**

Reason:

- old loading presentation returned;
- sidebar behavior/order regressed;
- navigation labels were clipped;
- older renderer behavior reached the packaged artifact.

Useful Sentinel/Discord/Palworld implementation may be ported selectively, but its product shell and version line are not accepted baselines.

## README synchronization contract

The Nexus Doc Watch should keep a concise roadmap section in `README.md` synchronized with this file.

When updating the README:

1. Read this file.
2. Inspect the active stabilization PR and branch.
3. Inspect `config/release-identity.json` when present.
4. Inspect current GitHub Actions and actual published releases when release status is mentioned.
5. Update only facts supported by repository evidence.
6. Keep rejected/historical lines clearly labeled.
7. Do not claim a roadmap phase is complete merely because code exists.
8. Do not claim a build is published unless a real GitHub Release exists.
9. Do not change the roadmap direction based only on chat text when repository state disagrees.
10. If production materially changes phase/status, update this file first or in the same change set, then synchronize README.

## Recommended README roadmap format

The README should keep the roadmap compact:

- **Now — Stabilization Reset / Owner Test:** golden shell + active 0.41.2.1 owner-test baseline.
- **Immediate next — Sentinel Staff/Admin Console:** clean staff workspace, temporary staff offices, button/modal-driven admin controls, protected audit flow, and slash-command fallback.
- **Next — Core reliability:** persistence, modules, scheduler, backup/recovery.
- **Then — Discord + Palworld acceptance:** real operational flows.
- **Release hardening:** immutable tested artifact, version/updater consistency, owner-test/public-release separation.
- **Later — Self-hosted web + Windows agent:** deferred until desktop stability is accepted.
- **Post-stabilization — Backend-first game modules:** expand Sentinel-facing game services through replaceable API adapters, beginning with the planned Pokémon GO module.

Detailed gate status belongs in this file; the README should summarize rather than duplicate every implementation detail.

## Change discipline

Update this document whenever one of these materially changes:

- current development/owner-test version;
- rollback target;
- stabilization branch/PR;
- active phase;
- functional gate status;
- owner acceptance result;
- release readiness;
- web migration status;
- a roadmap phase is completed, rejected, deferred, or replaced.

Routine commits that do not change roadmap meaning do not require an edit here.
