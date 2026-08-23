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
- No public/stable Nexus 0.1 release is established by the rebuild branch or package version alone.

The version reset is intentional. Do not describe `0.1.0` as older than or superseded by `0.41.x`; the numbering restarted with the clean architecture rebuild.

## Architecture decision

Issue #286 records the owner-approved post-stabilization architecture change and its subsequent clean-rebuild decision.

The active target is now:

- **Nexus Backend** — game logic, provider integrations, shared module contracts, permissions, health, scheduling hooks, and backend service routing.
- **Nexus Sentinal** — primary day-to-day Discord interface for game modules through persistent module consoles, setup/reconciliation, interactive controls, and deeper commands.
- **Khaos Nexus Desktop** — privileged Admin Control Center for Discord/Sentinal administration, account/access linking, backend/module/service configuration, diagnostics, logs, recovery, updates, scheduler administration, integrations, and the private Thora bridge.
- **Veyra** — may remain the dedicated D&D presentation surface while D&D follows the same backend-first service rule.
- **Thora** — remains private/local and should be bridged from its canonical project rather than duplicated into Nexus.

The earlier incremental thinning strategy is superseded for the Nexus 0.1 line. Legacy code remains available as reference material and may be selectively ported only when it fits the new boundaries and has focused regression coverage.

## Current implementation evidence

Repository evidence on `rebuild/nexus-0.1` currently establishes:

- package identity `0.1.0` and an Electron Admin Control Center entrypoint;
- backend and Sentinal runtime scripts;
- a backend module catalog/registry direction covering ARK, Palworld, Minecraft, Warframe, The Division 2, Rust, Satisfactory, IdleOn, and D&D;
- a generic backend provider bridge for module-specific services;
- persistent Sentinal module-console rendering and interaction routing;
- `/nexus setup`, `/nexus repair`, `/nexus repair-all`, `/nexus modules`, `/nexus refresh`, and advanced `/nexus run` command surfaces;
- Discord module provisioning/reconciliation that can reuse or create module categories/channels;
- join-to-create temporary voice lobby behavior with persisted topology/lobby ownership;
- Administrator permission preflight for Sentinal provisioning while setup authorization remains separately restricted to configured owner or Discord Manage Server authority;
- private Thora launch/status bridge boundaries;
- dedicated rebuild CI and Windows build workflow definitions.

These are implementation facts, not release or owner-acceptance claims.

## Validation state

Status: **REBUILD VALIDATION REQUIRED**

The repository contains dedicated rebuild CI and Windows-build workflow definitions. At the time of this synchronization, no completed workflow-run evidence was found for the initial workflow commit that is sufficient to claim the current rebuild head is green.

Therefore:

- do not claim Nexus 0.1 has passed CI or Windows packaging unless exact-head workflow evidence is available;
- do not claim owner acceptance until an explicit owner-test result is recorded;
- do not carry the old 0.41.x twelve-gate numeric stabilization score into the 0.1 rebuild as if it were already applicable;
- define new acceptance gates around the clean rebuild rather than inheriting legacy scores by default.

## Active roadmap

### Now — Rebuild foundation

Status: **IN PROGRESS**

Goals:

- keep the desktop thin and admin-focused;
- stabilize the backend module contract and capability model;
- keep Sentinal as the primary game-module user surface;
- preserve safe permission, confirmation, redaction, audit, and secret-storage boundaries;
- maintain deterministic Discord provisioning/reconciliation without duplicate channels, consoles, or lobbies;
- obtain exact-head CI and Windows-package evidence for the rebuild.

### Next — Provider-backed game services

Status: **PLANNED / PARTIALLY IMPLEMENTED FOUNDATION**

Goals:

- connect module-specific provider transports behind the shared backend contract;
- prove the pattern with focused modules rather than reintroducing game logic into Electron or Discord handlers;
- preserve shared scheduler authority and avoid per-module duplicate schedulers;
- add domain-level tests independent of Discord rendering.

### Then — Sentinal operational acceptance

Status: **PLANNED**

Goals:

- validate `/nexus setup` and reconciliation on a real guild;
- validate persistent module consoles, permissions, confirmations, degraded-backend behavior, and restart recovery;
- validate temporary lobby lifecycle and cleanup;
- verify common game workflows are discoverable without memorizing slash commands;
- validate Veyra/D&D presentation against the backend-first boundary.

### Release hardening

Status: **PLANNED**

Goals:

- establish one authoritative rebuild release identity and artifact naming policy;
- keep tested commit, installer artifact, updater metadata, release notes, and rollback target correlated;
- verify Windows installer behavior, protected configuration, diagnostics/recovery, and update paths;
- create owner-test artifacts only after exact-head automated validation;
- keep public/stable publication a separate explicit owner decision.

### Later — Selective migration and expansion

Status: **DEFERRED UNTIL REBUILD FOUNDATION IS ACCEPTED**

Direction:

- selectively port only legacy behavior that fits the backend/admin/Sentinal architecture;
- expand provider-backed game services and capability-driven Discord module consoles;
- thin or omit routine game dashboards from the desktop rather than rebuilding the old renderer surface;
- integrate Thora only through the approved private bridge;
- consider any future web/public surface only if it supports this architecture and does not become a second authority for protected machine operations.

The previous roadmap's self-hosted web + Windows Agent migration is not the immediate successor phase for Nexus 0.1 and must not be presented as the current next step.

## Historical stabilization record

The `0.41.x` stabilization work, PR #266, owner-test `0.41.2.1` / internal `0.41.3-test.1` line, and associated diagnostics remain useful historical and rollback evidence. They are not deleted or invalidated; they are superseded as the active implementation direction by the owner-approved clean Nexus 0.1 rebuild.

Do not import legacy branches wholesale. Port specific behavior only after architectural fit and focused test coverage are established.

## README synchronization contract

Keep the public README concise with this structure:

- **Now — Rebuild foundation**
- **Next — Provider-backed game services**
- **Then — Sentinal operational acceptance**
- **Release hardening**
- **Later — Selective migration and expansion**

Update this document and README whenever the active rebuild branch, version, architecture boundary, validation state, owner-acceptance result, release readiness, rollback target, or major migration direction materially changes.
