# Khaos Nexus Autonomous Operator Setup

Khaos Nexus 0.5.0 adds an Operator Console designed for routine use by a trusted family member or community operator without exposing owner-only credentials and destructive controls.

## Before enabling desktop access control

1. Configure the Discord bot token, server ID, and owner Discord user ID.
2. Configure Discord desktop login with the application client ID and `http://127.0.0.1:43119/callback` redirect.
3. Add trusted operator Discord user IDs. Add the owner's wife here for routine Operator access.
4. Sign in with the configured owner Discord account.
5. Confirm the Operator Console shows **Owner** before enabling access control.
6. Create and verify a manual backup.
7. Enable Discord-based desktop access control from the Operator Console.

Access control is disabled by default so the first setup cannot lock the owner out.

## Access roles

### Owner

- Change Discord and RCON credentials.
- Add, edit, and remove game servers.
- Configure operators, viewers, GitHub reporting, backups, updates, and autonomy.
- Restore backups and install application updates.

### Operator

- Start, stop, and restart the Discord bot.
- Run Safe Recovery and Maintenance Mode.
- Test game servers and run full health checks.
- Create and export verified backups.
- Send diagnostics and queued GitHub reports.
- Check and download updates, but not install them.

### Viewer

- View application status, game-server health, logs, and prior reports.
- Open the automatic backup folder and the last GitHub issue.
- Cannot change configuration or run maintenance actions.

### Locked

- Can sign in or sign out with Discord.
- Protected desktop operations are rejected by the Electron main process.

## Local lockout recovery

The Operator Console displays the full path to:

```text
disable-access-control.flag
```

If Discord login becomes unavailable or the allowlist is configured incorrectly:

1. Close Khaos Nexus.
2. Create an empty file at the displayed recovery path named exactly `disable-access-control.flag`.
3. Start Khaos Nexus again.
4. Access control will be disabled and the flag will be removed automatically.
5. Repair the Discord login or allowlist before enabling access control again.

## Automatic verified backups

Automatic backups include:

- Normal Khaos Nexus configuration.
- The Windows-encrypted credential blob.
- Autonomous-operation settings.
- Backup format and application version metadata.

Each backup is written atomically, reopened, parsed, and format-validated before being marked successful. Older backups are removed after the configured retention count is reached.

Encrypted credentials can normally only be restored by the same Windows user profile.

## Safe Recovery

Safe Recovery performs the following guarded sequence:

1. Creates and verifies a pre-recovery backup.
2. Checks the Discord bot runtime.
3. Starts or restarts the supervised bot when safe.
4. Refuses to bypass the crash safety lock.
5. Processes queued GitHub error reports.
6. Tests every enabled game server through RCON.
7. Sends an optional Discord operator notification with the result.

## Maintenance Mode

Maintenance Mode performs the following sequence:

1. Creates and verifies a pre-maintenance backup.
2. Sends an optional private Discord operator notice.
3. Broadcasts the configured maintenance warning to each enabled RCON server.
4. Requests a world save for each enabled server.
5. Restarts the supervised Discord bot when enabled.
6. Records successful and failed steps for the operator.

Maintenance Mode does not restart hosted game servers because providers use different control APIs. Provider-specific restart adapters can be added later.

## Discord operator notifications

Provide a private Discord channel ID and enable notifications to receive:

- Safe Recovery results.
- Maintenance Mode start and completion notices.
- Repeated RCON connection failures.
- Bot self-healing notices.
- Desktop error identifiers.

The application sends notifications with the protected Discord bot token and disables mentions in generated messages.

## Recommended first test

1. Leave access control disabled.
2. Configure the owner's wife as an Operator.
3. Create a verified backup.
4. Run a full server health check.
5. Run Safe Recovery while the bot is online.
6. Run Maintenance Mode on a quiet test window.
7. Sign in as the wife and confirm owner-only controls are disabled.
8. Sign back in as the owner and enable access control.
9. Restart Windows and confirm the Discord session restores and the bot starts normally.
