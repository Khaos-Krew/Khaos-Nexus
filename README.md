# Khaos Nexus

A local-first Windows desktop control center for the Khaos Nexus Discord bot, game servers, diagnostics, backups, and future community modules. It is designed to operate without Lovable credits or a hosted control panel.

## Current capabilities

- Start, stop, and restart the Discord bot from a desktop dashboard.
- Isolate the bot in a supervised process so a module failure does not crash the desktop manager.
- Automatically restart unexpected crashes with exponential backoff and a safety limit.
- Store Discord, RCON, GitHub monitor, and Discord OAuth credentials with Electron/Windows protected storage.
- Sign desktop operators in with Discord through the system browser using Authorization Code with PKCE.
- Restore and refresh Discord login sessions after Windows restarts.
- Authorize the owner and additional trusted operator Discord user IDs.
- Manage ARK, Palworld, and generic Source RCON connections.
- Provide slash commands for ping, health, server status, players, save, broadcast, kick, ban, and advanced RCON.
- Capture redacted logs, stable error fingerprints, diagnostics exports, and GitHub reports.
- Automatically create GitHub issues for new errors and comment on existing issues when the same error repeats.
- Queue reports locally while offline or while credentials are unavailable.
- Export and restore configuration backups without decrypting the protected credential blob.
- Build Windows installer and portable executables through GitHub Actions.
- Check GitHub Releases for updates from inside the application.

## Downloading a Windows build

1. Open the repository's **Actions** tab.
2. Open the latest successful **Windows Build** run.
3. Download the `Khaos-Nexus-Windows` artifact.
4. Extract it and run either the installer or portable executable.

Tagged releases publish the installer and portable executable to GitHub Releases.

When no Actions build is available, extract the source package and double-click `Install-and-Run.bat`. It prepares a private, checksum-verified Node.js LTS runtime when needed. No separate Node installation or administrator access is required. See `RUN_FROM_SOURCE.md`.

## Initial setup

1. Create or select a Discord application in the Discord Developer Portal.
2. Add a bot user and reset/copy its token.
3. Invite the bot with the `bot` and `applications.commands` scopes.
4. Under OAuth2, enable **Public Client** and add `http://127.0.0.1:43119/callback` as a redirect.
5. Open **Discord** in Khaos Nexus and enter the bot token, Discord server ID, owner user ID, application client ID, and any additional trusted operator IDs.
6. Select **Sign in with Discord** and approve the `identify` and `guilds` scopes in the browser.
7. Add hosted game servers under **Game Servers** using their RCON address, port, and password.
8. Open **Application Monitor**, add the protected GitHub token, verify the connection, and enable automatic reporting when ready.
9. Start the bot from the Command Center.

Protected tokens and RCON passwords are not written to the normal configuration file and are excluded from diagnostics.

## Discord operator login

The operator login uses the external system browser rather than an embedded password form. It includes:

- random OAuth `state` validation;
- PKCE SHA-256 code challenge and verifier;
- a localhost-only callback on `127.0.0.1:43119`;
- encrypted access and refresh token storage;
- automatic refresh and session restoration;
- owner and additional-operator allowlists;
- configured Discord server membership detection.

The app requests only the `identify` and `guilds` scopes. Setup instructions are in `DISCORD_LOGIN_SETUP.md`.

## Application Monitor

The Application Monitor watches the bot runtime, Electron main process, and desktop renderer. It can:

- assign a stable error fingerprint;
- create a redacted GitHub issue for a new error;
- add a comment when the same fingerprint occurs again;
- suppress duplicate issue spam for a configurable period;
- enforce a configurable daily delivery limit;
- queue reports locally while offline;
- retry queued reports every 15 minutes;
- export a local JSON diagnostic report;
- open a manual report for review before submission.

Automatic reporting is disabled by default. Setup instructions and minimum GitHub permissions are in `APPLICATION_MONITOR_SETUP.md`.

## Local development

```bash
npm install
npm test
npm run check
npm start
```

Build Windows packages on Windows with:

```bash
npm run dist:win
```

## Current scope

This is the stable local-first foundation. Community automation, role management, status panels, richer game adapters, guided recovery, and operator-friendly maintenance workflows should be added as isolated modules so the application remains reliable and manageable by a nontechnical operator.
