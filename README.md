# Khaos Nexus Bot Manager

A Discord-first Windows desktop manager that runs the Khaos Nexus bot locally without depending on a website, Lovable credits, or a hosted control panel.

## First release goals

- Start, stop, and restart the Discord bot from a desktop dashboard.
- Keep the bot isolated in a supervised process so a module failure does not crash the manager.
- Automatically restart unexpected crashes with exponential backoff and a safety limit.
- Store the Discord token and RCON passwords with Electron/Windows protected credential storage.
- Manage Ark, Palworld, and generic Source RCON connections from forms.
- Provide slash commands for ping, health, server status, players, save, broadcast, kick, ban, and advanced RCON.
- Capture redacted logs, error fingerprints, diagnostics exports, and prefilled GitHub error reports.
- Export and restore configuration backups without decrypting the protected credential blob.
- Build Windows installer and portable executables through GitHub Actions.
- Check GitHub Releases for updates from inside the manager.

## Downloading a Windows build

1. Open the repository's **Actions** tab.
2. Open the latest successful **Windows Build** run.
3. Download the `Khaos-Nexus-Bot-Manager-Windows` artifact.
4. Extract it and run either the installer or portable executable.

Tagged releases publish the installer and portable executable to GitHub Releases.

When no Actions build is available yet, extract the source package and double-click `Install-and-Run.bat`. It automatically prepares a private, checksum-verified Node.js LTS runtime when needed; no separate Node installation or administrator access is required. See `RUN_FROM_SOURCE.md`.

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

## Initial setup

1. Create or select a Discord application in the Discord Developer Portal.
2. Add a bot user and reset/copy its token.
3. Invite the bot with the `bot` and `applications.commands` scopes.
4. Open **Bot Setup** in the manager, enter the token, Discord server ID, and owner user ID.
5. Add hosted game servers under **Game Servers** using their RCON address, port, and password.
6. Start the bot from the dashboard.

The token and RCON passwords are not written to the normal configuration file and are not included in diagnostics.

## Error reporting

The Health Monitor assigns a stable error ID, keeps redacted recent logs, and can:

- export a local JSON diagnostic report;
- copy a Markdown report to the clipboard;
- open a prefilled GitHub issue for review and submission.

Do not paste credentials into GitHub issues. The built-in redactor is a safeguard, not a substitute for reviewing a report before submitting it.

## Current scope

This is the stable foundation. Community modules such as reaction roles, tickets, leveling, scheduled status panels, and richer game adapters should be added as isolated modules after the manager and core runtime prove reliable.
