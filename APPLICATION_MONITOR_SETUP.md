# Application Monitor Setup

The Application Monitor automatically sends redacted Khaos Nexus errors to GitHub for triage. Automatic reporting remains disabled until it is explicitly enabled.

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
2. Enter the destination repository in `owner/name` format.
3. Enter labels such as `bug, automated-report`.
4. Keep the duplicate window at 72 hours initially.
5. Paste the fine-grained token.
6. Select **Save Monitor Settings**.
7. Select **Verify GitHub Connection**.
8. Enable **Automatically send redacted errors to GitHub**.
9. Save the monitor settings again.

The token is encrypted with Windows protected storage and is not returned to the screen after saving.

## Automatic batch schedule

Khaos Nexus retains errors locally as soon as they occur, but it does not transmit each error immediately.

- The first complete scan runs **five minutes after application startup**.
- The same scan repeats **every thirty minutes for as long as Khaos Nexus remains open**.
- Each scan uploads all newly retained errors and all new occurrence counts since the previous successful batch.
- Errors that fail to upload remain queued for the next thirty-minute check.
- Missing credentials or network access do not delete queued errors.
- The startup and recurring timers run in the desktop main process and continue while the window is minimized to the system tray.

All batches for the same UTC day use one GitHub issue thread. The first non-empty batch creates the issue; later thirty-minute batches add comments to that issue. No issue or comment is created when a scan finds no new errors.

## Error classification

Expected access-control behavior is not treated as a defect. For example, opening a protected Players, Scheduler, Hosted Servers, or administration action while signed out can display a locked/sign-in state, but it is not retained or uploaded as a UI error.

Real failures remain eligible for reporting, including:

- failed buttons and IPC operations;
- renderer exceptions and unhandled promise rejections;
- bot/runtime failures captured by the supervisor;
- server, provider, scheduler, moderation, backup, and update errors routed through the retained monitor pipeline.

## Information included in batches

- Khaos Nexus version.
- Windows version and architecture.
- Runtime state and crash count.
- Bot heartbeat snapshot.
- Stable error IDs, messages, sources, and stack traces.
- Button, active workspace, and IPC channel for UI action errors.
- First and latest occurrence times.
- Repeat counts.
- Recent redacted application logs.
- Public configuration state.

Discord tokens, GitHub tokens, provider API keys, OAuth sessions, and game-server passwords are redacted and excluded.

## Delivery behavior

- Reports are queued locally while offline or when the token is missing.
- A failed batch remains queued and is retried by the maintained thirty-minute cycle.
- Large batches are divided into multiple comments while preserving every queued error.
- If configured labels do not exist, the monitor retries issue creation without labels.
- Manual **Send Current Error** remains available for an immediate operator-requested report.

## Operator recovery steps

1. Check the Command Center status.
2. Open **Application Monitor**.
3. Confirm the monitor says **Ready**, **Queued**, or **Waiting for token**.
4. Check the displayed next automatic batch time.
5. Verify the GitHub connection when reports remain queued after a scheduled check.
6. Do not delete the local data folder or protected tokens unless instructed.
7. Export a backup before changing server or Discord credentials.
