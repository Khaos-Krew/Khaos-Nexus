# Khaos Nexus Stabilization Reset

Status: ACTIVE
Branch: `stabilize/nexus-66-baseline`
Baseline: `fix/v0.40.2-renderer-refresh`

## Goal

Stop feature expansion until Khaos Nexus is predictably usable. The next owner-facing build must be a stability candidate, not another feature candidate.

## Freeze rules

- No new product features during stabilization.
- No web migration during stabilization.
- No new modules during stabilization.
- No release-identity rewrites after validation.
- No split-product renderer ancestry may replace the approved desktop shell.
- Every owner-reported regression becomes a permanent automated guard where practical.
- The artifact offered to the owner must be the same packaged application that passed the release gates.

## Golden UI baseline

The approved modern desktop shell from `fix/v0.40.2-renderer-refresh` is the golden UI baseline.

Required invariants:

- `body.nexus-v8` branding layer is active.
- desktop shell sidebar is 286 px at the standard desktop layout.
- navigation labels remain readable and are not character-wrapped or clipped to the first few letters.
- navigation order does not silently revert to a legacy shell.
- legacy loading/splash presentation must not replace the current loading presentation.
- current Khaos Nexus branding and crest remain present.
- renderer state refreshes must not rebuild the navigation shell on heartbeat updates.

## Functional stability score

A test candidate is not owner-ready until at least 8 of these 12 gates pass. Beta quality requires 10/12. Release-candidate quality requires 12/12.

1. Startup and loading presentation
2. Sidebar and navigation
3. Settings persistence
4. Discord login/bot supervision
5. Discord status/control panel
6. Palworld server configuration
7. Palworld status/player reads
8. Palworld command/action execution
9. Shared scheduler
10. Module enable/disable
11. Updater/manual release detection
12. Backup/restore

## Release gates

Before an owner build is offered:

- repository tests pass
- Windows checks pass
- packaged startup smoke passes
- clean install smoke passes
- Golden UI invariants pass against packaged output
- version, artifact, updater metadata, release tag, notes, and rollback target agree
- required secrets remain redacted
- no legacy shell/loading markers are active
- functional stability score is recorded

## Owner testing boundary

Owner testing should be reserved for behavior automation cannot prove, especially real Discord and real Palworld connectivity. The owner should not be the first person to discover shell regressions, old loading screens, broken navigation width, stale version identity, missing artifacts, or packaging mistakes.

## Migration rule

Sentinel/Palworld/Discord functionality may be brought into this branch only in narrow, reviewable slices. Each slice must preserve the Golden UI baseline and pass the stability gates before the next slice lands.

## Exit criteria

Stabilization ends only after a candidate reaches at least 10/12 gates with no major UI regression and survives one full owner acceptance pass. The self-hosted web migration starts only after that stable baseline exists.
