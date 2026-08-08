# ADR-011: Authoritative D&D Campaign Runtime

- Status: Accepted for private development
- Date: 2026-08-06
- Owner: Khaos Nexus Owner
- Release authorization: Not granted

## Context

Khaos Nexus already supports campaigns, members, characters, sessions, encounters, maps, homebrew, Discord bindings, Co-DM drafts, procedural map proposals, and explicit AI Game Master sessions through Veyra.

The existing AI Game Master workflow is intentionally review-only. Veyra may propose narration, dialogue, checks, and campaign updates, but it does not roll dice, publish to Discord, or mutate campaign state automatically.

Solo and group AI-DM campaigns require a persistent execution layer that can collect player actions, validate AI output, apply deterministic rules, preserve secrets, recover after crashes, and hand control between Veyra and a human DM.

## Decision

Khaos Nexus will add an event-based D&D Campaign Runtime inside the existing Windows desktop application.

The desktop remains authoritative. Veyra narrates and proposes; the Campaign Runtime validates and applies. Nexus Sentinel receives no D&D context.

Every meaningful campaign mutation is represented by an idempotent state event. Campaign checkpoints contain campaign-scoped state with a SHA-256 integrity hash. Player actions are stored exactly as declared and must be locked before Veyra can resolve a group turn.

## Runtime boundaries

- Veyra cannot directly write character HP, inventory, conditions, quests, scenes, maps, or campaign records.
- Veyra cannot invent player-character dialogue, thoughts, consent, choices, or irreversible actions.
- AI-proposed mechanical events are rejected by the runtime foundation.
- Discord publication remains disabled in this development slice.
- Mechanical automation remains disabled in this development slice.
- The primary supervised Nexus Bot remains the only Discord authority.
- The existing shared scheduler remains the only scheduler.
- Campaigns continue to bind to existing Discord resources.
- Android Companion and Mobile Gateway remain paused.
- No updater tag, release asset, public release, or release note is created by this work.

## Development gate

The runtime starts in `development_only` state. Local Owner preview requires the exact phrase:

`ENABLE D&D RUNTIME PREVIEW`

Enabling local preview does not authorize release. The stored runtime gate always reports `releaseAuthorized: false` in this implementation.

## Initial implemented capabilities

- Campaign play profiles for solo AI DM, group AI DM, human DM, human DM with Veyra, and hybrid play
- Live, asynchronous, and mixed pace configuration
- Player and AI-companion seats
- Campaign runs and scenes
- Group turn collection, action locking, and resolution state
- Idempotent state-event journal
- Campaign checkpoints and restore
- Character HP and condition events
- Runtime inventory events
- Quest, scene, world-time, and knowledge events
- Per-character and DM-only knowledge records
- Exact bounded Veyra context preview
- Player-agency validation
- Rejection of AI-proposed mechanical mutations
- Deterministic ability-check and damage dice helpers
- Explicit bridge from locked runtime turns to existing AI Game Master sessions
- Automatic post-turn checkpoint after validated Veyra resolution

## Consequences

The runtime can be expanded incrementally without replacing current D&D storage, Discord authority, AI worker isolation, or release controls.

Additional work is still required for complete combat automation, player-facing Discord commands, private delivery, absence handling, live presence, human/AI handoff controls, long-campaign memory maintenance, and production hardening.
