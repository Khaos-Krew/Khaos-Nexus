# ADR-010: Embedded AI Source Authority

- **Status:** Accepted
- **Date:** 2026-08-05
- **Applies to:** Khaos Nexus desktop, D&D AI, Nexus AI Core

## Context

Khaos Nexus previously assembled production AI runtimes by checking out two separately versioned repositories during packaging. That kept service development isolated, but it also created a release-time dependency chain between external repository checkouts, bundle materialization, Electron `extraResources`, installer publication, and installed runtime discovery. A publisher path omission in v0.35.2 demonstrated that a separately passing bundle workflow was not sufficient evidence that the published installer contained the same resources.

## Decision

The `Khaos-Krew/Khaos-Nexus` repository is the authoritative production source for both desktop-shipped AI services.

Production snapshots live under:

- `packages/ai/dnd-ai`
- `packages/ai/ai-core`

The services remain separate Electron-embedded Node sidecar processes. This decision changes source ownership and build orchestration; it does not collapse either service into the Electron main process.

The isolated repositories remain active for focused bug reproduction, experiments, service-specific tests, and candidate fixes:

- `Khaos-Krew/Khaos-Nexus-AI`
- `Khaos-Krew/Khaos-Nexus-AI-Core`

A fix becomes production code only after its exact commit is pinned in `config/embedded-ai-sources.json`, synchronized into the desktop repository, hash-locked, reviewed, and validated by the desktop installer gates.

## Production invariants

1. Normal desktop start, pack, installer, and publisher commands build AI runtimes from `packages/ai`; they do not require an external AI repository checkout.
2. Every embedded snapshot carries fixed repository, commit, version, entrypoint, file count, byte count, and SHA-256 snapshot evidence.
3. Source drift, missing files, unexpected services, test/build directories, symbolic links, entrypoint changes, or provenance mismatches fail before Electron Builder runs.
4. Both services retain independent process lifecycle, localhost binding, readiness, credentials, logs, restart, and failure containment.
5. The packaged tree and a clean Windows installation are verified file-by-file using the generated runtime manifests.
6. Android Companion and Mobile Gateway remain excluded under ADR-008.

## Bug-fix flow

1. Reproduce and test the defect in the relevant isolated repository.
2. Land the isolated fix and identify the exact green commit.
3. Update the corresponding commit and version pin in `config/embedded-ai-sources.json`.
4. Let the guarded synchronization workflow replace the production snapshot and lock evidence.
5. Merge only after embedded source validation, desktop tests, Windows packaging, packaged startup, silent installation, and installed manifest verification pass.
6. Publish the desktop release from the merged, validated production source.

## Consequences

- Desktop and AI changes can ship atomically under one app version.
- Installer construction no longer depends on external source availability.
- Rollback is a normal desktop release rollback with the exact embedded AI snapshots included.
- The isolated repositories are no longer production deployment authorities; they are candidate-fix and test environments.
- AI crashes remain isolated from the Electron main process.
