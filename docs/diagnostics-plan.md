# Khaos Nexus installer diagnostics and production plan

## Objective

Keep the Windows installer as the primary Owner-test build while automatically retaining enough redacted evidence to diagnose startup, renderer, configuration, storage, and unexpected-shutdown failures. Allow diagnostics to be repaired and improved independently of the full desktop release.

## Implemented architecture

- The installed executable accepts `--diagnostics` and launches an independent Diagnostics window without taking the normal application single-instance lock.
- The updateable runtime is maintained in `Khaos-Krew/Khaos-Nexus-Diagnostics` and distributed through immutable GitHub Release assets.
- The desktop app checks the pinned repository, enforces runtime API and desktop-version compatibility, verifies archive size and SHA-256, verifies every extracted file, then activates the runtime from AppData.
- Runtime updates are staged atomically and take effect on the next diagnostic launch or desktop restart.
- The last verified runtime is retained, and the installer always contains an embedded fallback for offline use or failed updates.
- Normal desktop sessions keep a rolling breadcrumb log and automatically capture main-process exceptions, rejected promises, renderer exits, failed interface loads, unresponsive windows, and unclean prior sessions.
- A one-time post-install/update baseline is retained per application and diagnostics-runtime version.
- Reports and bundles are stored below the normal Electron user-data directory.
- Known credentials are redacted locally and `secrets.bin` contents are never copied into reports or support bundles.
- Automatic uploads remain disabled by default. The optional client requires an explicitly configured HTTPS endpoint and queues failed deliveries locally.
- Local capture, report review, and support-bundle creation do not depend on a backend or internet connection.

## Repository ownership boundary

The diagnostics repository owns:

- the standalone diagnostic window and preload bridge
- the report, session, breadcrumb, redaction, packaging, and optional upload engine
- diagnostics-specific tests and compatibility metadata
- deterministic ZIP and manifest generation
- publishing versioned runtime releases

The main application owns:

- the Start Menu launcher and `--diagnostics` entry point
- repository pinning and release discovery
- compatibility checks, hash validation, extraction, caching, rollback, and fallback
- attaching the selected diagnostic service to desktop crash and renderer events

## Owner validation

1. Install over the current working v0.22.1 release and verify servers, modules, Discord configuration, and protected credential indicators are preserved.
2. Confirm the Start Menu contains both Khaos Nexus and Khaos Nexus Diagnostics.
3. Launch Diagnostics while the main app is closed and while it is running.
4. Confirm the first launch retrieves a compatible verified runtime when internet access is available, or uses the embedded fallback when offline.
5. Run the health check and create a support bundle.
6. Verify the report identifies both the desktop version and diagnostics-runtime version and that the bundle excludes `secrets.bin`.
7. Force-close the main app, relaunch it, and confirm one unexpected-shutdown report is retained without repeating on every launch.
8. Confirm a normal shutdown clears the active-session marker.
9. Leave upload settings disabled unless a trusted HTTPS diagnostics backend is deployed.

## Runtime release process

1. Modify the diagnostics repository payload and tests.
2. Bump both `package.json` and `payload/runtime.json` to the same semantic version.
3. Push to `main`.
4. GitHub Actions runs the independent runtime tests.
5. The workflow creates a deterministic ZIP, hashes every file and the final archive, and publishes an immutable `v<version>` release.
6. Compatible desktop installations discover and stage the release automatically.

A published version is never replaced. A correction requires a new runtime version, preserving rollback and auditability.

## Production assessment

This phase consolidates several previously separate safety systems—crash reports, startup health, renderer action errors, interface watchdog evidence, and portable sidecars—into one installer-focused workflow while separating the repairable diagnostic runtime from the main application. It also corrects the inherited Satisfactory capability mismatch where the adapter advertised `saves` while the client and UI invoked `backup`, and it updates stale renderer regression coverage to the current shared Game Adapter architecture.

The stable release identity remains v0.22.1 until automated workflows and Owner installation tests pass.

## Next production sequence

1. Pass Linux CI and Windows installer/portable packaging for the external-runtime branch.
2. Validate retrieval, checksum verification, cached-runtime startup, offline fallback, and rejection of a tampered runtime on Windows.
3. Validate the Satisfactory HTTPS API against a live dedicated server, including certificate trust, loading-state handling, status, player count, options, save enumeration, save creation, raw-command confirmation, and save-first shutdown.
4. Run the complete installer upgrade scenario and inspect the first automatic baseline report.
5. Test Android Phase 1 against the installed gateway: QR and code pairing, matching certificate fingerprint, approval, persistence after restart, read-only data loading, and immediate revocation.
6. Promote the validated combined source to a numbered release candidate.
7. Deploy a diagnostics backend only after local capture has proven reliable; keep upload opt-in and preserve offline operation.

## Current limitation

The desktop API client and report contract are implemented, but no central diagnostics ingestion service is deployed in this phase. The backend is intentionally not required for diagnostics to function. The external runtime is Windows-first because extraction currently uses the Windows PowerShell archive service; non-Windows desktop support can be added later without changing the runtime contract.
