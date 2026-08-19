# Khaos Nexus

**Khaos Nexus is a local-first Windows command center for Discord operations, game-server management, shared automation, D&D tooling, diagnostics, and related Nexus services.**

The Windows desktop application remains the current primary product. Khaos Nexus is presently undergoing a **stabilization reset** focused on restoring a dependable desktop baseline before feature expansion resumes.

## Current status

| Item | Status |
| --- | --- |
| Main desktop version line | `0.41.x` |
| Current stabilization candidate | `v0.41.2-B` |
| Known-good rollback target | `v0.41.1-B` |
| Active stabilization branch | [`stabilize/nexus-66-baseline`](../../tree/stabilize/nexus-66-baseline) |
| Initial stabilization PR | [PR #266 — stabilization: establish Nexus 66% golden baseline](../../pull/266) |
| Feature expansion | Frozen during stabilization |
| Self-hosted web migration | Deferred until the desktop baseline is accepted |

> **Version-line clarification:** Nexus Sentinel `0.33.0 RC1` was a temporary split-product integration candidate. It failed owner acceptance because of desktop shell/loading/navigation regressions and is **not** the successor to the Khaos Nexus `0.41.x` desktop line.

This default branch currently serves as the repository's public documentation landing area. The active stabilization application source is on `stabilize/nexus-66-baseline` and is being reviewed through PR #266.

## What Khaos Nexus is

Khaos Nexus is intended to centralize operational tools that would otherwise be spread across separate dashboards, scripts, bots, and server panels. The current desktop codebase includes established work for:

- desktop module controls, local configuration, recovery, diagnostics, backups, and updater infrastructure;
- Discord bot supervision, Discord automation, and server status/control surfaces;
- Palworld REST/RCON and ARK/generic RCON server operations;
- hosted-server control through the Pterodactyl Client API;
- a shared scheduler for server warnings, saves, shutdown/restart workflows, and recovery checks;
- D&D campaign tooling and Discord-connected campaign workflows;
- Veyra and Nexus Sentinel runtime/service work;
- additional game-adapter and monitoring work already present in the active source tree.

**Repository presence is not the same as current release acceptance.** The stabilization reset deliberately narrows the immediate acceptance target and requires core workflows to be revalidated before broad “production-ready” claims are made.

## Stabilization focus

The current stabilization contract evaluates 12 functional gates:

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

Owner-test builds require at least **8/12** gates, beta quality requires **10/12**, and release-candidate quality requires **12/12**. The desktop shell must also preserve the approved modern navigation/loading baseline.

Read the active contract: [`docs/NEXUS_STABILIZATION_RESET.md` on the stabilization branch](../../blob/stabilize/nexus-66-baseline/docs/NEXUS_STABILIZATION_RESET.md).

## Release terminology

Khaos Nexus keeps these concepts separate:

- **Development version** — the version currently represented by active source/package metadata.
- **Test/stabilization candidate** — a build identity being validated; this does not mean it is publicly released.
- **Published release** — an actual GitHub Release with available artifacts.
- **Rollback release/target** — the explicitly recorded known-good fallback.

The active stabilization metadata records `v0.41.2-B` as the candidate identity and `v0.41.1-B` as the rollback target. Check the [GitHub Releases page](../../releases) to determine what is actually published; do not infer release availability from a branch, PR, `package.json`, or release-note filename.

## Current architecture

The current product is a **Windows x64 Electron desktop application**, not a hosted web control panel. The active source tree separates privileged main-process services, renderer/UI code, Discord bot runtime code, shared contracts/policies, game adapters, and supporting assets.

Sensitive credentials are intended to remain outside renderer-visible state, and public Discord/diagnostic output is expected to use redacted or safe projections rather than raw operational secrets.

### Future direction

A future self-hosted architecture may evolve toward:

- Khaos Nexus Web
- Khaos Nexus Backend
- a lightweight Windows Nexus Agent

That is **future direction only**. The stabilization policy explicitly defers the web migration until the current desktop baseline is accepted.

## Source, setup, and contributor documentation

For the active desktop source and current documentation, start on the stabilization branch:

- [Active stabilization source](../../tree/stabilize/nexus-66-baseline)
- [Stabilization README](../../blob/stabilize/nexus-66-baseline/README.md)
- [Documentation index](../../blob/stabilize/nexus-66-baseline/docs/README.md)
- [Run from source](../../blob/stabilize/nexus-66-baseline/RUN_FROM_SOURCE.md)
- [Security policy](../../blob/stabilize/nexus-66-baseline/SECURITY.md)
- [Current release identity](../../blob/stabilize/nexus-66-baseline/config/release-identity.json)
- [Current candidate notes](../../blob/stabilize/nexus-66-baseline/release-notes/v0.41.2.md)

Historical architecture records, test-build notes, and old release documents are intentionally retained for regression analysis and project history. They should be treated as historical unless a current authority document explicitly adopts them.

## Documentation policy

Public project information should always distinguish **implemented**, **stabilization-validated**, **paused/deferred**, and **planned** functionality. Roadmaps, old branches, abandoned implementations, temporary split products, or previous release notes are not sufficient evidence that a feature is current or released.

During stabilization, documentation changes must not authorize a release, expand product scope, or describe the future web architecture as though it already exists.
