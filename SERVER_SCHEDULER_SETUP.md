# Khaos Nexus Server Scheduler

The Server Scheduler automates recurring world saves and host-managed restart workflows from the desktop application.

## What Khaos Nexus controls

For a restart workflow Khaos Nexus can:

1. Broadcast configurable countdown warnings through Palworld REST or game-server RCON.
2. Request a world save on every selected server.
3. Refuse to shut down a server whose save failed.
4. Wait for the configured save-settle delay.
5. Send the game-specific safe shutdown command.
6. Watch for the server to go offline and return online.
7. Record every stage and optionally report the result to Discord.

Khaos Nexus does not claim to power on a hosted server without a hosting-provider API. The game host or local process manager must be configured to relaunch the server after shutdown. Provider-backed power control remains part of the Hosted Server Control milestone.

## Supported actions

### Host-managed restart

- Palworld REST: announcement, save, shutdown, status verification.
- Palworld RCON: `Broadcast`, `Save`, `Shutdown`, and `Info` verification.
- ARK RCON: `Broadcast`, `SaveWorld`, `DoExit`, and `ListPlayers` verification.
- Generic Source RCON: configured/default broadcast, save, shutdown, and status commands.

### World save only

Runs the safe save action on each selected server and records individual success or failure.

## Creating a schedule

1. Open **Server Scheduler** in the left sidebar.
2. Select **New Schedule**.
3. Choose the target servers.
4. Select **Host-managed restart** or **World save only**.
5. Choose the local PC time and active days.
6. Configure warning minutes, player messages, save delay, and verification timeout.
7. Save the schedule.

Schedules use the Windows PC's local timezone. Khaos Nexus must be running at the scheduled time. A missed-run grace setting allows a recently missed action to execute after a short sleep, reboot, or application restart.

## Discord reports

Scheduler reports use the private notification channel configured in **Operator Console**. Each schedule can enable or disable Discord reporting independently. The **Test Discord Report** button verifies the route without touching a game server.

## Manual execution

**Run Now** uses a 60-second warning for restart workflows. Save-only workflows run immediately. Active workflows can be cancelled before shutdown. Once shutdown has been sent, cancellation only stops Khaos Nexus from continuing restart monitoring; it cannot undo the game-server command.

## Execution history

The scheduler retains:

- schedule and occurrence identifiers;
- manual or scheduled source;
- warning, save, shutdown, offline, and online stages;
- per-server results;
- completion outcome and timestamps.

History is stored locally in `server-scheduler-history.json` inside the Khaos Nexus data directory. Schedule definitions are included in normal Khaos Nexus configuration backups.

## Recommended first test

Create a **World save only** schedule and use **Run Now**. Confirm that the save succeeds before testing a host-managed restart. Then verify through the hosting panel that the server is configured to relaunch automatically after `DoExit` or the Palworld shutdown action.
