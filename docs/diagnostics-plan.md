# Khaos Nexus installer diagnostics and production plan

## Objective

Keep the Windows installer as the primary Owner-test build while automatically retaining enough redacted evidence to diagnose startup, renderer, configuration, storage, and unexpected-shutdown failures.

## Implemented architecture

- The installed executable accepts `--diagnostics` and launches an independent Diagnostics window without taking the normal application single-instance lock.
- Normal desktop sessions keep a rolling breadcrumb log and automatically capture main-process exceptions, rejected promises, renderer exits, failed interface loads, unresponsive windows, and unclean prior sessions.
- A one-time post-install/update baseline is retained per application version.
- Reports and bundles are stored below the normal Electron user-data directory.
- Known credentials are redacted locally and `secrets.bin` contents are never copied into reports or support bundles.
- Automatic uploads remain disabled by default. The optional client requires an explicitly configured HTTPS endpoint and queues failed deliveries locally.
- Local capture, report review, and support-bundle creation do not depend on a backend or internet connection.

## Owner validation

1. Install over the current working v0.22.1 release and verify servers, modules, Discord configuration, and protected credential indicators are preserved.
2. Confirm the Start Menu contains both Khaos Nexus and Khaos Nexus Diagnostics.
3. Launch Diagnostics while the main app is closed and while it is running.
4. Run the health check and create a support bundle.
5. Verify the report identifies the build as installed and the bundle excludes `secrets.bin`.
6. Force-close the main app, relaunch it, and confirm one unexpected-shutdown report is retained without repeating on every launch.
7. Confirm a normal shutdown clears the active-session marker.
8. Leave upload settings disabled unless a trusted HTTPS diagnostics backend is deployed.

## Production assessment

This phase consolidates several previously separate safety systems—crash reports, startup health, renderer action errors, interface watchdog evidence, and portable sidecars—into one installer-focused workflow. It also corrects the inherited Satisfactory capability mismatch where the adapter advertised `saves` while the client and UI invoked `backup`, and it updates stale renderer regression coverage to the current shared Game Adapter architecture.

The stable release identity remains v0.22.1 until automated workflows and Owner installation tests pass.

## Next production sequence

1. Pass Linux CI and Windows installer/portable packaging for this branch.
2. Validate the Satisfactory HTTPS API against a live dedicated server, including certificate trust, loading-state handling, status, player count, options, save enumeration, save creation, raw-command confirmation, and save-first shutdown.
3. Run the complete installer upgrade scenario and inspect the first automatic baseline report.
4. Test Android Phase 1 against the installed gateway: QR and code pairing, matching certificate fingerprint, approval, persistence after restart, read-only data loading, and immediate revocation.
5. Promote the validated combined source to a numbered release candidate.
6. Deploy a diagnostics backend only after local capture has proven reliable; keep upload opt-in and preserve offline operation.

## Current limitation

The desktop API client and report contract are implemented, but no central diagnostics ingestion service is deployed in this phase. The backend is intentionally not required for diagnostics to function.
