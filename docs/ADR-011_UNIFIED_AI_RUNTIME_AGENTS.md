# ADR-011: Unified AI Runtime with Isolated Named Agents

- **Status:** Accepted
- **Date:** 2026-08-05
- **Decision owner:** Khaos Nexus Owner
- **Applies to:** Khaos Nexus desktop, Veyra, Nexus Sentinel, Windows packaging, updater publication
- **Supersedes:** the two independent desktop sidecar lifecycle described by the initial v0.36.0 implementation
- **Preserves:** ADR-008 mobile production hold, ADR-009 desktop Discord authority, ADR-010 embedded AI source authority

## Context

The desktop previously launched the embedded D&D AI and Nexus AI Core as two unrelated top-level sidecars. That preserved data isolation, but duplicated supervision, startup contracts, readiness handling, process cleanup, and owner-machine failure paths. The v0.36.1 publisher demonstrated that a clean package could still fail at the installed owner-environment launch boundary.

The Owner approved one local AI runtime with two dedicated identities:

- **Veyra — D&D Lorewarden and Co-DM**
- **Nexus Sentinel — System Health and Assistance AI**

The names are user-facing identities. Existing internal protocol names, capability namespaces, embedded repository pins, and API contracts remain compatible where changing them would create unnecessary migration risk.

## Decision

Khaos Nexus will launch one **Khaos Nexus AI Runtime** host from Electron embedded Node. The host supervises two separate worker processes:

1. **Veyra** runs the embedded D&D AI source and owns campaign assistance, Co-DM guidance, encounters, homebrew, maps, and explicit AI Game Master sessions.
2. **Nexus Sentinel** runs the embedded Nexus AI Core sidecar and owns application health, diagnostics, update intelligence, module assistance, Discord-safe drafts, and advisory maintenance proposals.

The desktop supervises one host lifecycle. The host retains individual worker start, stop, restart, readiness, logging, and failure containment. A worker failure may degrade the runtime, but it must not automatically terminate the other worker.

## Shared infrastructure

The agents share only infrastructure that is safe to centralize:

- one Electron-owned runtime host
- one parent/host authenticated IPC contract
- common environment sanitization
- common lifecycle commands and status projection
- common packaging and installed-resource verification
- common audit and desktop-control surfaces

## Mandatory isolation

Veyra and Nexus Sentinel retain separate:

- worker processes
- prompts and capability namespaces
- memory and data directories
- endpoints and readiness contracts
- protected service tokens
- logs and diagnostics
- tool permissions and authority policies
- restart and failure boundaries

Veyra is the only agent allowed to receive explicitly approved D&D campaign context. Nexus Sentinel must reject the D&D namespace and must never receive campaign records. Nexus Sentinel remains advisory-only and cannot directly execute game-server, Discord, scheduler, updater, permission, or maintenance actions. Veyra cannot receive application credentials, diagnostics authority, or system-control tools.

## Runtime profiles

The host and Nexus Sentinel use the hardened production environment. Veyra uses the embedded loopback-local profile required by its pinned mock-provider and JSON-store contract. This exception is explicit and bounded: the worker remains loopback-only, packaged, hash-verified, process-isolated, and without provider credentials or external network authority.

## Source authority and isolated repositories

ADR-010 remains authoritative. Production source snapshots stay in the Khaos Nexus desktop repository under `packages/ai`. The dedicated D&D AI and AI Core repositories remain focused bug-reproduction, testing, experiment, and candidate-fix lanes. A candidate fix enters production only after its exact isolated commit is green, pinned, synchronized, verified, and reviewed in the desktop repository.

## Compatibility

Desktop IPC lifecycle channels and the `dnd`/`core` internal keys remain available for existing renderer and module consumers. User-facing surfaces use **Veyra**, **Nexus Sentinel**, and **Khaos Nexus AI Runtime**. The existing `coreConnection()` boundary remains private to the main process and does not expose the per-launch service token to renderer or bot state.

## Release and rollback

This architectural change is not a workflow-only v0.36.1 hotfix. The blocked v0.36.1 publisher is superseded. Publication requires a new protected release that verifies:

- exact embedded source pins and manifests
- full desktop tests and checks
- one host spawning two isolated workers
- both agent readiness contracts
- individual worker recovery and degraded-host behavior
- hostile inherited Windows environment sanitization
- packaged startup
- clean silent installation
- installed file size and SHA-256 integrity
- installed runtime startup and shutdown
- updater identity and post-publication latest-release state

Until that publication succeeds, v0.36.0 remains the latest release and v0.35.3 remains the rollback release.

## Consequences

### Positive

- one owner-visible runtime lifecycle instead of two unrelated service lifecycles
- fewer top-level startup, updater, and single-instance failure paths
- clearer agent identities and responsibilities
- individual worker recovery without combining private data or authority
- stronger installed-runtime verification against the real pinned service contracts

### Tradeoffs

- the runtime host becomes shared infrastructure and must be treated as a critical supervised component
- host failure affects both agents even though worker failure remains isolated
- compatibility aliases must remain until all existing consumers migrate to agent terminology
