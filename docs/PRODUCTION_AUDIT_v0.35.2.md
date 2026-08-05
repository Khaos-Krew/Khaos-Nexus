# Khaos Nexus Production Audit — v0.35.2

## Baseline

- Application source audited: `146dd861be3f40ed32a9f8386901e2d12c8baa8f`
- Installed/updater baseline: `v0.35.1`
- Scope: active Windows desktop production line
- Android Companion and Mobile Gateway: preserved, paused, and excluded under ADR-008

## Audit result

The installed v0.35.1 application reported healthy startup diagnostics, writable application data, available Windows protected storage, a responsive desktop window, and no unclean prior shutdown. CI, Windows packaging, and the protected v0.35.1 publisher had also completed successfully.

The audit found lifecycle defects that automated release gates did not exercise deeply enough:

1. Restart used a fixed delay instead of waiting for the exact child process to exit.
2. Forced termination relied on `ChildProcess.killed`, which indicates signal delivery rather than confirmed exit.
3. Parent log descriptors were retained after spawning bundled services.
4. Nexus AI Core could remain in `starting` indefinitely if readiness never arrived.
5. Bulk startup failure handling could overwrite independent service state.
6. Renderer installation and polling were unbounded when the AI workspace was absent or hidden.
7. The Start All control did not share complete busy/runtime-state synchronization.
8. Renderer and main-process lifecycle inputs lacked strict action/service allowlists.
9. Manual lifecycle IPC lacked an explicit Owner/local-admin authorization and audit boundary.

## Repairs

- Restart now awaits the exact child exit before launching a replacement.
- Stop uses a bounded graceful period followed by forced termination of the same still-live child.
- Parent log descriptors close immediately after spawn setup.
- AI Core readiness has a 15-second bounded timeout.
- Start, stop, and restart-all operations isolate failures by service.
- Lifecycle action and service keys are allowlisted in renderer and main process.
- Manual lifecycle status and mutations require Owner/local-admin access.
- Manual lifecycle requests and outcomes write bounded AI-service audit/log evidence.
- Renderer installation retries for a bounded 30 seconds, pauses polling while hidden, refreshes on return, and synchronizes all service controls.

## Preserved boundaries

- Electron embedded Node remains the only required runtime.
- D&D AI and Nexus AI Core remain separate processes, endpoints, tokens, logs, readiness state, and contracts.
- Provider credentials and service tokens remain absent from renderer state, backups, diagnostics, and release metadata.
- AI remains advisory/non-autonomous and cannot directly execute Discord, game-server, scheduler, updater, permission, or maintenance actions.
- Android Companion and Mobile Gateway remain excluded from Windows artifacts.

## Required release evidence

Publication requires production dependency audit, complete tests, repository checks, bundled AI build verification, Windows installer and portable packaging, packaged startup readiness, updater metadata and asset verification, checksums, and confirmation that v0.35.2 is latest and updater-visible.
