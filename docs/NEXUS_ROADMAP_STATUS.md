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
- household Accounts & Access, guarded read-only provider validation, staged updating, Admin Operations / Owner Test Center, backend-first Pokémon GO, friendly per-module commands, universal event/schedule feeds, command-schema normalization, supporter-rank discovery, module-access reconciliation, hierarchy/config diagnostics, protected-role fallback, hosted Sentinal pairing, hosted provider sync, Setup Center, administrator moderation, Discord Server Shop rank authority, capability-driven help, Warframe Archon Hunt reads, and the interactive ARK tame wizard;
- unified Sentinal self-role ownership and bounded legacy-menu discovery;
- legacy emoji reaction-role migration (#331), private safe-space report tickets (#332), milestone patch-note publishing (#333), and direct adoption of old bot-authored Nexus role-button menus (#335);
- **exact legacy-role diagnostics and false-positive filtering (#339)**: old button custom IDs and same-name role candidates are logged without mutating roles, the Community Rules private-report control is excluded from role migration, and the owner-testing reaction poll is excluded from role-menu detection;
- **deterministic renamed-panel migration (#341)**: five additional live legacy panels use strict title-scoped aliases to existing roles, duplicate same-name roles remain blocked, generic `LFG` remains intentionally unresolved rather than guessed, and the existing global Name Color exclusivity manager remains authoritative;
- **Name Color swatch restoration (#342)**: custom Discord emoji IDs/names/animation state now survive legacy-menu parse/normalize/render, so the rebuilt Name Color buttons retain their visible swatches while role hierarchy and exclusivity rules remain unchanged;
- current Thora sidecar integration, staged-update/hash hardening, dedicated `docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md`, and Nexus Rebuild CI with Windows tests, NSIS packaging, staged-update verification, and artifact upload.

Superseded or closed follow-up PRs are not active roadmap items. The earlier #334/#336/#337/#340 proposals were superseded by the merged #339/#341 path and should not be presented as pending implementation.

These are implementation facts, not release or final owner-acceptance claims. Code/tests do not establish successful household OAuth/pairing, live-provider correctness, complete real-guild reconciliation, live legacy-role migration/adoption success on the intended guild, report-ticket owner acceptance, updater apply/rollback success on the owner PC, Thora launch success on the owner PC, final Setup Center/Discord Admin acceptance, owner acceptance, or public/stable release readiness.

## Validation state

Status: **AUTOMATED REBUILD BASELINE GREEN — OWNER/LIVE VALIDATION IN PROGRESS**

The latest exact merged implementation head with completed rebuild validation is **PR #342 head `0702ca5c78faa156022ee45859ec0faf35fde5cb`**. **Nexus Rebuild CI run #296 completed successfully on that exact SHA**, and PR #342 then merged into `rebuild/nexus-0.1` as merge commit `8b4c847ed8995edfe74bbf9c101d0d0b23d09199`.

Important preceding exact-head evidence includes:

- PR #341 head `a2e20744a0dc320fb660a074563379332f663081` — Nexus Rebuild CI #294 green;
- PR #339 head `4762480c0d894ecf7eae3bcfa3f506d7d530f701` — Nexus Rebuild CI #291 green;
- PR #335 head `ab92b519e21466030f6c06e89267e9eb8c2c9c08` — Nexus Rebuild CI #282 green;
- PR #333 head `ab20274db953a5dd2b1dfa2d1825f8ae96d1568b` — Nexus Rebuild CI #279 green;
- PR #332 head `9b1dcb994dbb629a9d21d8d74ef3762c71f76136` — CI #274 green.

Earlier green implementation evidence remains preserved in repository history.

The `Discord + Nexus Setup Acceptance` checkpoint contains useful hosted/runtime evidence, but live self-role acceptance remains incomplete. Current implementation now safely distinguishes real role menus from the Community Rules report button and owner-testing poll, migrates more renamed panels through deterministic aliases, preserves duplicate-role refusal, leaves generic `LFG` unresolved until an authoritative target exists, and restores custom Name Color swatches. This materially improves the migration path, but it does **not** prove that every old control is retired in the intended guild.

CI and hosted-runtime evidence remain separate from owner/live acceptance. Therefore:

- do not claim owner acceptance until an explicit owner-test result is recorded;
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

Status: **IN PROGRESS — DETERMINISTIC LEGACY ROLE MIGRATION HARDENED; REAL-GUILD/RAILWAY ACCEPTANCE PENDING**

Merged implementation includes setup/repair, persistent module panels, friendly commands/help, moderation, Pokémon GO operations, event feeds, rank authority, module-access reconciliation, hierarchy diagnostics, protected-role fallback, unified self-role/color menus, legacy reaction-role migration (#331), direct old Nexus button-menu adoption (#335), exact target diagnostics/false-positive filtering (#339), deterministic renamed-panel aliases (#341), restored custom Name Color swatches (#342), private safe-space report tickets (#332), secure hosted pairing, hosted provider administration, and one-time roadmap milestone patch-note publishing (#333).

Goals:

- validate the real guild end-to-end, including the migrated deterministic panels, duplicate-role safety, the still-unresolved generic `LFG` decision, and actual Name Color switching/swatches;
- retire old reactions/buttons only after replacement controls are demonstrably active;
- validate the Rules/report lifecycle and restricted archive permissions end-to-end;
- complete the remaining Discord + Nexus Setup Acceptance gates, including fresh hosted pairing, live repair where needed, real provider sync/validation, and restart persistence;
- validate moderation, temporary lobby lifecycle, common workflow discoverability, and Veyra/D&D presentation boundaries.

### Release hardening

Status: **IN PROGRESS — STAGED UPDATER + HASH HARDENING + OWNER TEST CENTER MERGED; OWNER UPDATE/ROLLBACK ACCEPTANCE PENDING**

The staged updater, owner-test build tracking, and SHA-256 hardening are merged. The latest green rebuild CI confirms compatibility with the automated pipeline; it does not publish an update or release.

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

PR #266 remains open, draft, mergeable, and unmerged on `stabilize/nexus-66-baseline`; its current head is `6140a5e2c74582e11180136ca04c1257452947c1`. Its state does not supersede the active rebuild branch.

The historical stabilization release identity remains owner-test `0.41.2.1` / internal `0.41.3-test.1`, channel `owner-test`, with rollback `v0.41.2-B`.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. No newer meaningful `[Owner Test …]` or `[Startup Diagnostics …]` failure was found during the 2026-08-24 synchronization. That issue records installed-runtime health but does not include exact rebuild-branch correlation and is not validation of Nexus 0.1.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
