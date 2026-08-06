# ADR-012: Private Solo Play and Deterministic Combat

- Status: Accepted for private development
- Date: 2026-08-06
- Depends on: ADR-011
- Release authorization: Not granted

## Context

The D&D Campaign Runtime provides campaigns, player seats, runs, scenes, turns, state events, checkpoints, knowledge filtering, and a validated Veyra narration boundary. A playable solo experience also requires deterministic mechanical resolution that cannot be controlled directly by the AI.

## Decision

Khaos Nexus will provide a local Solo Play and Combat Engine as a stacked private development slice.

The engine owns initiative, turn order, action economy, attack rolls, damage, concentration checks, spell-slot expenditure, death saves, combat logs, character HP synchronization, and post-combat checkpoints.

Veyra may narrate validated results but receives no direct mechanical mutation authority.

## Implemented boundaries

- Solo play requires an enabled `solo_ai_dm` or `hybrid` play profile.
- A player character is assigned to an authoritative player seat.
- Optional AI companions use explicit seats and behavior policies.
- Combat requires an active campaign run and scene.
- Initiative and rolls are recorded deterministically.
- Natural 1 attacks miss and natural 20 attacks hit and double damage dice.
- One action, one bonus action, one reaction, and movement are tracked per turn.
- Damage synchronizes player-character HP through the campaign event journal.
- Concentration checks use a deterministic Constitution save.
- Death saves are recorded and idempotent.
- Ending combat creates an integrity-checked campaign checkpoint.
- Campaign memories are inspectable and may be marked correct, incorrect, outdated, or forgotten.
- No automatic Discord publication is introduced.
- No updater, tag, release asset, deployment, or publisher workflow is introduced.
- `releaseAuthorized` remains permanently false in this slice.

## Deferred work

- Complete spell-effect automation
- Area templates and tactical movement grids
- Reactions triggered by specific rules
- Full monster action libraries
- Encounter balancing
- Player-facing Discord combat commands
- Live multiplayer presence and timers
- Production release hardening
