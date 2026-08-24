# Nexus D&D — Production Continuation Plan

Status: **QUEUED SUCCESSOR PHASE — BEGIN AFTER NEXUS 0.1 CORE/DISCORD ACCEPTANCE IS STABLE ENOUGH TO PROTECT D&D WORK**

This phase is the planned continuation of the Nexus D&D application. It is not an indefinite backlog item. Community interest already exists, so the production plan prioritizes reaching a safe, usable multiplayer beta before polishing every optional future feature.

## Product direction

Nexus D&D remains backend-first:

- **Nexus Backend** owns durable D&D domain state, permissions, validation, rules/content adapters, sessions, encounters, campaign data, and service contracts.
- **Veyra — Lore Master** owns the dedicated D&D AI/presentation intelligence boundary and may remain the primary D&D-facing assistant surface.
- **Discord** provides campaign access, notifications, lightweight commands/panels, account linking, and session/community coordination rather than becoming the full tabletop UI.
- **The D&D application/client** provides the rich player/DM experience: character building, campaign/world management, maps, encounters, live session play, and tactical combat.
- **Khaos Nexus Desktop** stays focused on privileged administration/diagnostics rather than absorbing normal D&D gameplay.

Existing validated D&D work from historical candidate lines is reference/migration material, not an instruction to restore the old application architecture wholesale.

## Entry criteria

Start active D&D production when the current Nexus 0.1 line has enough stability that D&D work will not be repeatedly invalidated by core Discord/backend/release regressions. At minimum:

1. Discord + Nexus Setup Acceptance has no unresolved architecture-breaking defect.
2. Sentinal/backend service boundaries are stable and restart-safe.
3. Account/linking and permission contracts are stable enough for campaign membership.
4. Windows/update/recovery testing has a dependable owner-test path.
5. Veyra hosted health and service boundaries remain independently observable.

These are stability gates, not a requirement that every unrelated Nexus feature be finished first.

## Phase DND-01 — Canonical content and asset foundation

Build the repository-backed content layer before expanding UI behavior.

- canonical open/SRD/reference content with source/provenance metadata;
- character-creation data: species/races, classes, subclasses, backgrounds, feats, spells, equipment, progression tables, and validation rules;
- Nexus homebrew content from **Khaos Nexus: Codex of the Shattered Realms** as a separately identifiable source set;
- campaign/world asset manifests for maps, locations, encounters, NPCs, factions, quests, loot, and session resources;
- clear copyright/license boundaries so protected commercial text is never reconstructed or silently bundled;
- stable IDs/versioning so Veyra and clients reference the same content objects.

**Exit:** a fresh character/campaign can be constructed from canonical versioned data without hard-coded UI lists.

## Phase DND-02 — Backend D&D domain completion

Complete the backend contracts required by both Veyra and the player/DM client.

Core domains:

- campaigns and memberships;
- campaign source enablement;
- characters and progression;
- content/homebrew library and approvals;
- sessions and recaps;
- dice/roll records and visibility;
- initiative and encounters;
- quests, NPCs, locations, factions, loot, and calendar/events;
- map metadata, scene state, and encounter bindings;
- DM/player permissions and campaign-scoped authorization;
- import/export and backup-safe serialization.

Migrate useful behavior incrementally from validated historical D&D candidates while preserving the current backend-first rule.

**Exit:** all core gameplay state can be exercised through tested backend APIs without requiring Electron-specific state.

## Phase DND-03 — Veyra production integration

Teach Veyra to consume the canonical D&D contracts and content rather than duplicating campaign truth.

Preserve and migrate the strongest previously validated behaviors:

- campaign readiness checks;
- Co-DM prep/recap/encounter/NPC/world/rules assistance;
- homebrew proposal generation with explicit review/approval;
- procedural map proposals with safe structured import;
- explicit AI Game Master session mode;
- player-character agency protections;
- lines/veils/pause-word safety state;
- unresolved checks instead of silent dice/outcome resolution;
- scoped campaign memory and bounded context;
- no automatic publication or irreversible campaign mutation without the appropriate user action/authority.

**Exit:** Veyra can support a real campaign through stable service contracts without becoming the source of truth for campaign state.

## Phase DND-04 — Player-ready character and campaign client

Build the normal-player experience first enough to support a closed beta.

Required beta surfaces:

- account sign-in/linking and Discord identity connection;
- campaign join/invite flow;
- guided character creation with validation and progression;
- character sheet, inventory/equipment, abilities/spells/features, notes, resources, and leveling;
- campaign dashboard with party/session/quest information;
- dice roller and visible roll history;
- session-ready notifications and reconnect/resume behavior;
- responsive layouts and accessibility/reduced-motion support;
- connection/initialization shown as a proper loading/connection screen rather than scattered setup cards.

**Exit:** a non-admin player can install/open the client, join a campaign, create/manage a character, and participate without needing Nexus admin tooling.

## Phase DND-05 — DM world and campaign builder

Provide the DM with a structured world-authoring workspace.

- world/region/location hierarchy;
- map library and scene bindings;
- NPC/faction/quest/loot authoring;
- encounter builder and reusable encounter templates;
- session planning and recap tools;
- source/homebrew controls per campaign;
- campaign import/export and reusable Nexus content packs;
- optional Veyra assistance that always previews proposals before campaign mutation.

**Exit:** a DM can prepare and run a campaign without maintaining critical state in external notes.

## Phase DND-06 — Live play and tactical combat mode

Implement the intended live-session transition between exploration and combat.

- exploration/map scene remains the normal campaign view;
- when combat begins, the map can fade/transition into a dedicated tactical combat presentation;
- party members and hostile/neutral combatants become the primary combat actors;
- initiative, HP, temporary HP, conditions, resources, concentration, death saves, effects, and turn state are synchronized from backend truth;
- rolls/checks/saves/attacks remain explicit and auditable;
- encounter completion restores/updates the campaign scene cleanly;
- spectator/DM controls are separated from player authority;
- visual direction may take inspiration from classic party-based RPG combat presentation while remaining mechanically tabletop-first.

**Exit:** one complete encounter can run start-to-finish without manual duplicate tracking outside Nexus D&D.

## Phase DND-07 — Discord campaign bridge

Expose only the lightweight Discord actions that improve campaign coordination.

- campaign access roles and channel bindings;
- session reminders and RSVP/status;
- persistent campaign summary/party panel where appropriate;
- safe dice/initiative/session notifications where the campaign enables them;
- Veyra commands for bounded D&D assistance;
- no leakage of DM-only notes, blind rolls, protected source text, private AI drafts, or hidden map information.

**Exit:** Discord and the D&D client stay synchronized without Discord becoming a second conflicting campaign database.

## Phase DND-08 — Closed community beta

Ship a limited beta as soon as the core loop is usable rather than waiting for every stretch feature.

Beta acceptance requires:

1. new user account/link flow works;
2. campaign creation/join works;
3. character creation and persistence work;
4. at least one full planned session can be run;
5. at least one tactical encounter completes cleanly;
6. Veyra can assist without breaking player agency or campaign state;
7. disconnect/restart recovery is safe;
8. permissions prevent players from seeing DM-only data;
9. backup/export exists before real campaign data is trusted;
10. defects and feedback have a clear reporting path.

Early users should be treated as a **closed beta cohort**, not as proof that the application is already production-complete.

## Phase DND-09 — Production release hardening

Before broader release:

- automated unit/integration/end-to-end regression suite;
- multi-user concurrency and reconnect testing;
- migration tests for campaign data schema changes;
- permission/RLS/authorization review;
- backup/restore and corruption recovery;
- installer/updater validation for the D&D client delivery model;
- performance profiling on campaign/map/combat-heavy sessions;
- privacy/security review for Discord/account/AI boundaries;
- copyright/source provenance audit;
- telemetry only where explicitly appropriate and privacy-safe;
- release notes, rollback plan, and support documentation.

**Exit:** a versioned Nexus D&D build is suitable for broader community use with a tested rollback/recovery path.

## Explicit non-goals for the first beta

Do not block the first usable beta on:

- every possible rules expansion/sourcebook;
- every planned Khaos Nexus homebrew supplement;
- cinematic polish for every encounter type;
- a marketplace/store;
- public web parity with every desktop screen;
- autonomous AI control of player characters;
- rebuilding old architecture merely because a legacy implementation exists.

## Roadmap handoff rule

When the current Nexus 0.1 roadmap reaches its final acceptance/expansion boundary, active planning must transition into this D&D production continuation rather than dropping Nexus D&D back into an unscheduled backlog.

The first D&D production checkpoint should be **DND-01 + DND-02 inventory/gap analysis against the current repository**, followed immediately by a beta-critical-path issue/PR sequence.
