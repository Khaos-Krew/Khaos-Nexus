# Application Monitor Setup

The Application Monitor automatically sends redacted Khaos Nexus errors to GitHub for triage. Automatic reporting remains disabled until it is explicitly enabled.

The active default report destination is `Khaos-Krew/Khaos-Nexus`. Installs that still carry the retired `Khaos-Krew/Khaos-Nexus-Bot-Manager` default are migrated to the active repository when Application Monitor starts.

## Required information

- GitHub repository in `owner/name` format.
- A GitHub fine-grained personal access token.
- Desired issue labels.
- Duplicate-suppression period.

## Create the GitHub token

Create a fine-grained personal access token for the GitHub account or organization that owns the Khaos Nexus repository.

Recommended access:

- **Resource owner:** `Khaos-Krew`
- **Repository access:** Only the error-report destination repository
- **Repository permissions:**
  - **Issues:** Read and write
  - **Metadata:** Read-only, automatically included by GitHub

The monitor does not need permission to modify repository contents, workflows, pull requests, administration settings, secrets, or deployments.

## Configure Khaos Nexus

1. Open **Application Monitor**.
2. Enter `Khaos-Krew/Khaos-Nexus` as the destination repository unless a different approved error-report repository is intentionally being used.
3. Enter labels such as `bug, automated-report`.
4. Keep the duplicate window at 72 hours initially.
5. Paste the fine-grained token.
6. Select **Save Monitor Settings**.
7. Select **Verify GitHub Connection**.
8. Enable **Automatically send redacted errors to GitHub**.
9. Save the monitor settings again.

The token is encrypted with Windows protected storage and is not returned to the screen after saving.

## Owner-test live diagnostics

During stabilization, enabling automatic GitHub reporting also enables the owner-test diagnostic handoff. This reuses the existing Diagnostics and Application Monitor services instead of introducing a second telemetry system.

- Fatal and error-level main-process, renderer-process, loading, and unresponsive-window diagnostics are prepared and handed to Application Monitor immediately.
- Unhealthy diagnostic reports include a conservative stabilization-gate classification when the failure clearly maps to one of the 12 stabilization gates. Ambiguous failures remain marked as cross-cutting rather than being forced into a gate.
- A lightweight system health check runs every **ten minutes** while automatic reporting is enabled. Healthy checks stay local and do not create GitHub issues; warning or failed checks are eligible for immediate reporting.
- Diagnostic issues include the local diagnostic session ID, application version, redacted reason/error data, current system-check results, and recent redacted application logs.
- The GitHub issue path is the supported handoff for Nexus Doc Watch and repository maintainers. The desktop application does not attempt to post directly into a ChatGPT conversation.
- If GitHub is unavailable, credentials are missing, or the configured daily delivery limit is reached, the prepared report remains in the local Application Monitor queue for later delivery.

This behavior is stabilization instrumentation, not release authorization. A reported or passing diagnostic does not by itself mark a stabilization gate complete.

## Automatic UI-error batch schedule

Khaos Nexus retains UI/action errors locally as soon as they occur, but it does not transmit each button or workspace error immediately.

- The first complete UI-error scan runs **five minutes after application startup**.
- The same scan repeats **every thirty minutes for as long as Khaos Nexus remains open**.
- Each scan uploads all newly retained errors and all new occurrence counts since the previous successful batch.
- Errors that fail to upload remain queued for the next thirty-minute check.
- Missing credentials or network access do not delete queued errors.
- The startup and recurring timers run in the desktop main process and continue while the window is minimized to the system tray.

All UI-error batches for the same UTC day use one GitHub issue thread. The first non-empty batch creates the issue; later thirty-minute batches add comments to that issue. No issue or comment is created when a scan finds no new errors.

## Error classification

Expected access-control behavior is not treated as a defect. For example, opening a protected Players, Scheduler, Hosted Servers, or administration action while signed out can display a locked/sign-in state, but it is not retained or uploaded as a UI error.

Real failures remain eligible for reporting, including:

- failed buttons and IPC operations;
- renderer exceptions and unhandled promise rejections;
- main-process and renderer-process crashes or unresponsive states;
- bot/runtime failures captured by the supervisor;
- server, provider, scheduler, moderation, backup, and update errors routed through the retained monitor pipeline;
- unhealthy periodic owner-test system checks.

## Information included in reports

Depending on the failure type, reports may include:

- Khaos Nexus version.
- Diagnostic session ID.
- Windows version and architecture.
- Runtime state and crash count.
- Bot heartbeat snapshot.
- Stable error IDs, messages, sources, and redacted stack traces.
- Stabilization-gate classification when the mapping is supported by the failure context.
- Button, active workspace, and IPC channel for retained UI action errors.
- First and latest occurrence times.
- Repeat counts.
- Current local system-check results.
- Recent redacted application logs.
- Public configuration state.

Discord tokens, GitHub tokens, provider API keys, OAuth sessions, and game-server passwords are redacted and excluded. `secrets.bin` contents are never copied into diagnostic reports.

## Delivery behavior

- Automatic reporting remains opt-in.
- Runtime/process faults and unhealthy owner-test system checks use immediate prepared delivery when the monitor is enabled and credentials are available.
- UI/action errors remain batched to reduce issue noise.
- Reports are queued locally while offline or when the token is missing.
- A failed batch remains queued and is retried by the maintained batch cycle.
- Large UI-error batches are divided into multiple comments while preserving every queued error.
- If configured labels do not exist, the monitor retries issue creation without labels.
- Manual **Send Current Error** remains available for an immediate operator-requested report.

## Operator recovery steps

1. Check the Command Center status.
2. Open **Application Monitor**.
3. Confirm the destination is `Khaos-Krew/Khaos-Nexus` unless another repository is intentionally configured.
4. Confirm the monitor says **Ready**, **Queued**, or **Waiting for token**.
5. Verify the GitHub connection before beginning an owner-test session.
6. Leave automatic reporting enabled while exercising startup, persistence, Discord, Palworld, backup/restore, and updater workflows.
7. If a failure occurs, note what you were doing even when an automatic issue is created; user action context is still valuable.
8. Do not delete the local data folder or protected tokens unless instructed.
9. Export a backup before changing server or Discord credentials.
