# Khaos Nexus v0.18.22 Production Audit

Audit date: 2026-07-29

Baseline: v0.18.21 source checkpoint `ca1b16decebb3acf526210df1d826e20845bd216`

Audit branch: `agent/v0.18.22-full-audit`

## Scope reviewed

- Electron startup, single-instance handling, software-rendering compatibility, preload bridge, startup-health gate, interface watchdog, recovery screen, and portable diagnostics.
- Renderer navigation, scrolling, updater controls, retained UI action errors, and access-denial filtering.
- Discord utility-process supervision, command registration, runtime heartbeats, live configuration, embeds, status panels, observability, and automation extensions.
- Palworld REST and generic/ARK/Palworld RCON transports.
- Application Monitor retention, batching, duplicate handling, manual delivery, scheduling, and daily limits.
- Server scheduler warnings, saves, shutdowns, restart verification, cancellation, history, and persisted occurrence state.
- Game-server health, automatic backups, guided recovery, maintenance mode, and self-healing.
- Protected configuration, credential redaction, backup verification, Pterodactyl controls, player moderation tokens, and audit history.
- GitHub Actions CI, syntax checks, Windows installer packaging, and portable executable packaging.

## Confirmed defects repaired

1. **Grouped navigation click routing** — retained from v0.18.21. Proxy buttons now resolve `data-view-proxy` through `dataset.viewProxy` and forward to the original working navigation controls.
2. **Discord spawn failure state** — synchronous utility-process launch failures now clear the child/PID state and surface Error instead of leaving Discord stuck on Starting.
3. **Live bot configuration ignored** — the supervised bot now applies `config-update` payloads in place, including refreshed protected-value redaction data.
4. **Status-panel buttons ignored** — Refresh Status and Show Players interactions are now handled, ephemeral, rate-limited, and public-safe.
5. **Palworld status-panel invalid emoji** — retained fix replaces the rejected `↻` component glyph with valid `🔄`.
6. **Manual monitor queue delayed** — Process Queue now explicitly forces immediate processing instead of being blocked until the next scheduled batch.
7. **Monitor daily limit bypass** — automatic batches now enforce the configured GitHub delivery ceiling.
8. **Monitor recurrence lost after startup error** — the thirty-minute timer starts in a `finally` path even if the five-minute batch fails.
9. **Stale server health retained** — deleted and disabled servers are removed from health state, attention messages, and repeat-failure notifications.
10. **Interrupted scheduler state stuck** — running histories and `finalStarted` occurrences are closed as failed after an application restart without replaying shutdown or restart commands.
11. **Unnecessary scheduler state writes** — occurrence state is written only when pruning actually removes entries.
12. **Updater stuck on Installing** — failed portable installation preparation returns to a retryable Downloaded state.
13. **Updater lifecycle leak** — update timers are disposed during application shutdown.
14. **RCON host accepted `host:port`** — RCON configuration rejects combined host/port input and validates the endpoint before connecting.
15. **RCON connection guidance unclear** — unresolved hosts, refused ports, timeouts, authentication failures, pre-auth disconnects, and post-auth response failures now produce distinct actionable messages.

## Audited paths requiring no code change

- Palworld REST routing was already installed before the generic main-process server test, so REST-backed Palworld tests correctly resolve through `ServerConnection`.
- Protected credentials remain outside public configuration payloads and are redacted from logs and diagnostics.
- Backup payloads remain verified before recovery, maintenance, or update installation.
- Pterodactyl action tokens and player moderation tokens remain short-lived and server-side.
- Status-panel payloads remain mention-free and do not expose host addresses, passwords, IP addresses, or platform identifiers.
- Startup visibility and watchdog paths remain independent from optional Discord desktop sign-in.

## Historical issue classification

- Issues #2 and #3: repaired by the RCON validation and guidance work in v0.18.22.
- Issue #27: repaired by the valid Discord component emoji and covered by regression tests.
- Issues #12, #29, #31–35, #42–47: historical expected access-control denials captured as defects by older builds. Current retained-error code filters and purges these denials.
- Issues #24–26: expected configuration validation when a Discord channel has not been selected; not transport or publishing failures.

## Automated validation

The release remains blocked unless all of the following pass on the final source commit:

- complete `node --test` suite;
- repository-wide JavaScript syntax audit;
- dependency installation on Windows runner;
- NSIS installer packaging;
- portable executable packaging;
- artifact upload with SHA-256 digest.

## Owner-device validation required

Before stable publication:

1. Start the portable executable after fully closing the previous tray process.
2. Confirm startup reaches the dashboard without blank or frozen surfaces.
3. Open multiple grouped navigation destinations.
4. Confirm the header updater opens the Update Center.
5. Confirm Discord reaches Online and displays its supervised PID.
6. Save a configuration change and verify the bot sees it without restart.
7. Publish or update the Palworld status panel.
8. Use Refresh Status and Show Players from Discord.
9. Use Application Monitor Process Queue and confirm it runs immediately.
10. Test an invalid `host:port` RCON value and confirm the separate-field guidance appears.

Stable release publication should occur only after these checks are confirmed on the owner PC.
