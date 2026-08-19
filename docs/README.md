# Khaos Nexus Documentation Index

This directory contains both current architecture/operations records and historical development records. **Do not assume that an older ADR, test-build note, release note, roadmap, or audit describes the current product state simply because it remains in the repository.**

## Current authority during stabilization

Use these sources first when determining current product direction or release identity:

1. [`NEXUS_STABILIZATION_RESET.md`](NEXUS_STABILIZATION_RESET.md) — active stabilization rules, golden desktop baseline, functional gates, release gates, and exit criteria.
2. [`../config/release-identity.json`](../config/release-identity.json) — current stabilization version identity, public tag target, channel, release-note file, and rollback target.
3. [`../package.json`](../package.json) — application/package metadata. During stabilization it must remain synchronized with the release-identity file.
4. [`../release-notes/v0.41.2.md`](../release-notes/v0.41.2.md) — notes for the current `v0.41.2-B` stability candidate.
5. [`../README.md`](../README.md) — public project overview and contributor orientation.

The current desktop development line is `0.41.x`. `v0.41.2-B` is the stabilization candidate identity and `v0.41.1-B` is the recorded rollback target. A version appearing in these files does **not** prove that a GitHub Release/artifact has been published.

## Operational and developer setup

- [`../RUN_FROM_SOURCE.md`](../RUN_FROM_SOURCE.md) — run and validate the Windows desktop application from source.
- [`../SECURITY.md`](../SECURITY.md) — credential/reporting rules and security boundaries.
- [`../SERVER_SCHEDULER_SETUP.md`](../SERVER_SCHEDULER_SETUP.md) — shared server-scheduler setup and safety.
- [`../PTERODACTYL_SETUP.md`](../PTERODACTYL_SETUP.md) — Pterodactyl Client API setup and guarded power controls.
- [`../APPLICATION_MONITOR_SETUP.md`](../APPLICATION_MONITOR_SETUP.md) — application-monitor configuration and diagnostics guidance.
- [`../DISCORD_LOGIN_SETUP.md`](../DISCORD_LOGIN_SETUP.md) — Discord desktop login/setup guidance.
- [`../DISCORD_AUTOMATION_SETUP.md`](../DISCORD_AUTOMATION_SETUP.md) — Discord automation setup guidance.

Some operational guides were originally written when the product had narrower scope. A version number in a guide generally identifies when that capability was introduced; it should not be read as the current Khaos Nexus version.

## Historical records

The repository intentionally preserves prior owner-test checkpoints, audits, implementation plans, and architecture records because they are useful for regression analysis and design history.

Examples include:

- [`../TEST_BUILDS.md`](../TEST_BUILDS.md)
- older `AUDIT_*`, `BUILD_CHECKPOINT_*`, and `BUILD_PLAN*` documents
- prior release notes
- older ADRs and superseded architecture decisions
- temporary split-product work such as the Nexus Sentinel `0.33.0 RC1` integration line

These records are **historical unless a current authority document explicitly adopts them**.

### ADR naming note

The repository contains more than one historical ADR sequence, including reused numeric identifiers. Treat the **full filename, title, scope, branch context, and any superseding decision** as the identifier; the ADR number alone is not globally unique across the entire project history.

## Current stabilization interpretation rules

When documenting Khaos Nexus during the reset:

- **Implemented/present** means working code or an established subsystem exists in the active desktop source tree.
- **Stabilization-validated** means the capability is covered by the current acceptance process and has passed the applicable gate(s).
- **Candidate** means development/test identity only; it is not synonymous with a published release.
- **Published release** requires an actual GitHub Release and its associated artifacts.
- **Rollback target** is the explicitly recorded known-good fallback, currently `v0.41.1-B`.
- **Paused/deferred** functionality must not be marketed as current release functionality.
- **Planned** functionality must not be described as implemented merely because it appears in a roadmap or issue.

## The 0.33 Sentinel line

`Nexus Sentinel 0.33.0 RC1` was a temporary split-product/integration candidate focused on Discord + Palworld. It is not the continuation of the main Khaos Nexus desktop version sequence. Owner testing exposed desktop shell/loading/navigation regressions, so the current stabilization work returned to the `0.41.x` line and ports useful Sentinel/Discord/Palworld behavior only in narrow slices that preserve the approved desktop baseline.

## Future architecture

A self-hosted web/backend architecture with a lightweight Windows Nexus Agent may be explored later. It is not the current runtime architecture and must remain documented as future direction until repository implementation and an approved architecture decision say otherwise. The active stabilization policy explicitly defers that migration.

## Documentation maintenance checklist

Before updating public project information:

1. Inspect the active branch and relevant PRs.
2. Check `config/release-identity.json` and `package.json` together.
3. Confirm whether a capability is merely present, currently validated, paused, or planned.
4. Keep candidate, published-release, and rollback terminology separate.
5. Prefer current authority documents over old test-build or roadmap language.
6. Preserve useful history, but label historical records so they cannot be mistaken for current instructions.
