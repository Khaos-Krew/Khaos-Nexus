# Build plan

## Phase 1 — Stable local foundation (implemented in v0.1)

- Windows desktop shell and system tray.
- Protected local configuration and secret storage.
- Supervised Discord runtime with start, stop, restart, heartbeat, and crash backoff.
- Live logs, error fingerprints, redacted diagnostics, and GitHub issue reporting.
- Ark, Palworld, and generic Source RCON server records.
- Core slash commands and administrator safeguards.
- Automated syntax checks, tests, and Windows artifacts.
- Configuration backup and restore with the encrypted credential blob preserved.

## Phase 2 — Restore proven community functions

- Persistent status panels with buttons.
- Restart schedules and warning sequences.
- Per-server command permissions and audit logs.
- Discord channel setup wizard.
- Import tool for existing server JSON and command settings.

## Phase 3 — Modular community features

- Welcome and goodbye messages.
- Reaction/button roles.
- Moderation and logging.
- Tickets, suggestions, and feedback.
- Leveling and opt-in community economy.

Each feature must run behind a module boundary, expose a health state, and fail without stopping unrelated modules.

## Phase 4 — Distribution and side-income readiness

- Signed Windows releases.
- First-run community branding wizard.
- Backup/restore bundles.
- Plugin/module package format.
- Free personal/community edition with optional paid setup and premium modules.

## Reliability rules

1. No website is required for core operation.
2. Secrets never enter normal logs or diagnostics.
3. A single module failure cannot terminate the desktop manager.
4. Every release must pass tests and produce a Windows artifact.
5. Fixes are delivered through GitHub Releases and the built-in updater.
