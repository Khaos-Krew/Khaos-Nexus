# ADR-014 — D&D Production Release Boundary

## Status

Accepted for Khaos Nexus v0.38.0.

## Decision

Following successful real-device verification of the v0.37.1 shared AI Runtime, the Owner authorized the D&D campaign update for production release.

v0.38.0 promotes the existing D&D campaign runtime foundation, solo/combat foundation, and group coordination foundation from private development status to production-authorized application features.

## Included production scope

- Owner-enabled campaign runtime.
- Solo AI-DM campaign foundation.
- Deterministic combat foundation.
- Group sessions with participant seats, action collection, locking, readiness/deadline coordination, voting, absence policies, and reviewed delivery drafts.
- Veyra narration and Co-DM integration.
- Campaign event journal, memory, checkpoints, and recovery controls.

## Permanent boundaries retained

1. The shared Khaos Nexus AI Runtime remains manually started by the Owner. Desktop startup does not automatically launch Veyra or Nexus Sentinel.
2. Veyra must preserve player agency and may not decide player-character actions, thoughts, or dialogue.
3. Veyra may not directly apply mechanical campaign state changes. Mechanical changes remain deterministic and rules-engine controlled.
4. Automatic Discord publication remains disabled. Group delivery output remains review-controlled.
5. Private character knowledge must not enter party-visible Veyra context unless the intended audience explicitly includes that character.
6. Nexus Sentinel remains isolated from D&D campaign content.
7. Existing Discord channels remain the preferred binding model; D&D must not create duplicate campaign channels as a default behavior.

## Release requirements

The v0.38.0 application source must pass CI, dependency audit, D&D campaign/solo/group tests, embedded Veyra and Nexus Sentinel verification, Windows packaging, and protected updater publication. The publisher must additionally prove clean installed desktop startup keeps the AI Runtime stopped until Owner action and that the installed shared host can make both agents ready.

## Future work

Live-session enhancements, expanded combat rules, richer hybrid DM handoff, Discord delivery automation, and other post-v0.38 capabilities require separate implementation and release authorization. This ADR does not authorize automatic Discord publishing or broader AI mechanical control.
