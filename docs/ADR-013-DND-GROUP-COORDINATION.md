# ADR-013: Private Group Coordination and Reviewed Delivery

- Status: Accepted for private development
- Date: 2026-08-06
- Depends on: ADR-011 and ADR-012
- Release authorization: Not granted

## Decision

Khaos Nexus will add a local group-session coordinator for two to six participants. It supports live, asynchronous, and mixed play; action locking; absence policies; decision voting; private declarations; and reviewed delivery drafts.

The Windows desktop remains authoritative. The existing supervised Nexus Bot remains the only Discord authority. This slice does not send Discord messages automatically and does not create a second Discord client, webhook, scheduler, or hosted service.

## Privacy and AI boundaries

- Shared Veyra narration receives party-visible actions only.
- DM-only declarations are counted but their content is not included in the shared narration request.
- Character-specific knowledge is excluded from shared narration.
- Private outcomes require a separate private-resolution path in a later slice.
- Every generated public or private message enters a local review queue.
- Approval does not publish to Discord in this slice.
- Delivery records always retain `automatic: false`, `discordPublished: false`, and `releaseAuthorized: false`.

## Implemented coordination

- Two to six participant sessions
- Live, asynchronous, and mixed pace
- All-required, majority, party-leader, deadline, and human-DM resolution
- Background, conservative AI, temporary controller, leave-scene, and pause absence policies
- One active group round per session
- One declaration per participant per round
- Public and DM-only declarations
- Idempotent actions, rounds, votes, and delivery drafts
- Majority, unanimous, and party-leader decisions
- Review-only public narration and private-review notices
- Post-round campaign checkpoints

## Release boundary

No release tag, updater metadata, package version, publisher workflow, release note, deployment, or public build is changed. The Owner must issue a later explicit release command before release planning may begin.
