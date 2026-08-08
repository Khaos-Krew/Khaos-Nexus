# D&D Solo, Group, and AI-DM Implementation Roadmap

## Release boundary

The Owner authorized the D&D production release after v0.37.1 passed real-device AI Runtime verification. The campaign runtime, solo/combat foundation, and group coordination foundation are now the v0.38 production scope. Future expansion beyond that scope still requires the normal Khaos Nexus protected release gates before updater publication.

## Phase 0 — Runtime stabilization

Completed for v0.37.1. The shared runtime remains manual-start only, uses the real installed Windows resources directory, verifies both agent bundles, and preserves worker isolation.

## Phase 1 — Campaign runtime foundation

Production scope for v0.38:

- Owner-enabled runtime gate
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

## Phase 2 — Solo AI-DM foundation

Production scope for v0.38:

- Guided solo campaign setup
- One player character
- Optional AI companion foundation
- Exploration loop foundation
- Checks and saving throws
- Basic encounter resolution
- Memory ledger
- Correction and checkpoint controls

## Phase 3 — Deterministic combat foundation

Production scope for v0.38:

- Initiative controller
- Action economy foundation
- Attack and damage resolution
- Conditions and concentration foundations
- Spell-resource handling
- Death saves
- Checkpointed combat completion

Further combat expansion remains planned:

- Full movement and targeting validation
- Reactions
- Complete rest/resource rules
- Rich enemy intents
- Combat replay UX

## Phase 4 — Group AI-DM coordination foundation

Production scope for v0.38:

- Two to six participant seats
- Action submission and locking
- Readiness and deadlines
- Party decision policies
- Absent-player policies
- Private character knowledge separation
- Reviewed public/private delivery queue
- Duplicate interaction protection

Automatic Discord publication remains disabled; delivery remains review-controlled.

## Phase 5 — Live group sessions

Planned:

- Presence
- Fast action submission
- Initiative timers
- Reaction windows
- Pause and resume
- Reconnection
- Human override
- Live status panels

## Phase 6 — Human DM and hybrid handoff

Planned:

- Private Co-DM suggestions
- Delegated NPC and enemy control
- Approval-required narration
- Temporary Veyra takeover
- Human-to-AI and AI-to-human checkpoints
- Retcon and correction tools

## Phase 7 — Hardening and expansion

Planned:

- Long-campaign memory compression
- Export and import
- Support bundles
- Usage budgets
- Accessibility
- Performance
- Recovery testing
- Secret-leakage testing
- Original campaign templates
- Expanded owner-device solo/group acceptance testing

## Permanent production safeguards

- Khaos Nexus AI Runtime remains Owner-controlled and does not automatically start with the desktop.
- Veyra may narrate and propose validated narrative events but may not directly mutate mechanical state.
- Deterministic rules resolution remains authoritative for mechanical changes.
- Automatic Discord publication remains disabled unless separately designed, authorized, and released later.
- Nexus Sentinel remains isolated from D&D campaign content.
- Every future updater release still requires exact-head validation, dependency audit, complete tests, embedded AI verification, Windows packaging, clean-install checks, installed runtime integrity, updater verification, and rollback verification.
