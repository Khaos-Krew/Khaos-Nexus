# D&D Solo, Group, and AI-DM Implementation Roadmap

## Release boundary

This roadmap is implementation work only. The Owner explicitly prohibited releasing the D&D update until a later direct release command. Do not create or modify tags, updater metadata, publisher workflows, release notes, or public assets for these phases.

## Phase 0 — Current runtime stabilization

Complete and merge the v0.37.0 Veyra/Nexus Sentinel cold-start repair. The shared runtime host must start promptly, both agent bundles must verify concurrently, and each worker must remain isolated.

## Phase 1 — Campaign runtime foundation

Implemented on `feature/dnd-campaign-runtime-foundation`:

- Development-only runtime gate
- Play profiles
- Player seats
- Campaign runs
- Scenes
- Turn cycles
- Event journal
- Checkpoints
- Knowledge records
- Runtime inventory
- Deterministic dice helpers
- Veyra context and proposal validation
- Existing AI-GM session bridge

## Phase 2 — Solo AI-DM vertical slice

- Guided solo campaign setup
- One player character
- Optional AI companion
- Exploration loop
- Checks and saving throws
- Basic encounter resolution
- Inventory and quest progression
- Memory ledger
- Correction and rewind controls

## Phase 3 — Complete deterministic combat

- Initiative controller
- Legal action validation
- Movement and targeting
- Attack, damage, healing, and temporary HP
- Conditions and concentration
- Reactions
- Spell slots and rests
- Death saves
- Enemy intents
- Combat replay

## Phase 4 — Asynchronous group AI-DM play

- Two to six human player seats
- Discord identity binding
- Action submission and locking
- Readiness and deadlines
- Party decision policies
- Absent-player policies
- Private character knowledge
- Public and private recap delivery
- Duplicate interaction protection

## Phase 5 — Live group sessions

- Presence
- Fast action submission
- Initiative timers
- Reaction windows
- Pause and resume
- Reconnection
- Human override
- Live status panels

## Phase 6 — Human DM and hybrid handoff

- Private Co-DM suggestions
- Delegated NPC and enemy control
- Approval-required narration
- Temporary Veyra takeover
- Human-to-AI and AI-to-human checkpoints
- Retcon and correction tools

## Phase 7 — Beta hardening

- Long-campaign memory compression
- Export and import
- Support bundles
- Usage budgets
- Accessibility
- Performance
- Recovery testing
- Secret-leakage testing
- Original campaign templates
- Owner-device acceptance testing

## Required production gate before any future release

A future Owner release command must still be followed by exact-head validation, complete tests, dependency audit, D&D AI integration, Nexus Sentinel isolation checks, diagnostics integration, Windows packaging, clean installation, installed runtime integrity, updater verification, rollback verification, and real-device solo/group campaign acceptance testing.
