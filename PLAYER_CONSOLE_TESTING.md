# Players & Moderation Owner-Test Guide

## Safety model

The renderer never receives player IP addresses, game-account IDs, server passwords, or raw RCON commands. Each player row receives a short-lived random moderation token. The main process keeps the real player identifier in memory only long enough to perform a guarded action.

- Viewer: can refresh and search players.
- Operator: can kick a connected player after entering a reason and confirming.
- Owner or Local Admin: can kick, ban, change refresh settings, and clear local moderation history.
- Every moderation action requires a reason of at least three characters.
- Refreshing the list invalidates all previous player tokens.
- Tokens expire automatically after the configured lifetime.

## Recommended test sequence

1. Start the v0.16.0 portable build.
2. Confirm the redundant top workspace bars remain removed.
3. Open **Players & Moderation** from the left sidebar.
4. Confirm every enabled game server is selected by default.
5. Select **Refresh Players**.
6. Verify connected names appear under the correct server.
7. Search by player name, server name, and game name.
8. Clear one server filter and verify its players disappear.
9. Re-enable the server and refresh.
10. Test a kick against a willing test account and enter a clear reason.
11. Confirm the action appears in Moderation History without an account ID or IP address.
12. Only test ban with an account that can safely be unbanned through the game or hosting panel.

## Expected game behavior

### Palworld REST

The app uses the REST `/players`, `/kick`, and `/ban` endpoints. Display names, level, and ping may be available. The REST user ID stays inside the main process.

### Palworld RCON

The app parses `ShowPlayers` output and sends typed `KickPlayer` or `BanPlayer` actions through the server adapter.

### ARK RCON

The app parses `ListPlayers` output and sends `KickPlayer` or `BanPlayer` using the hidden identifier returned by the server.

### Generic Source RCON

The app uses the configured/default player-list, kick, and ban command mappings. Test generic servers carefully because output formats differ between games.

## Failure behavior

- A server that cannot be reached appears in the warning banner without blocking other servers.
- Missing protected credentials are reported without exposing any secret value.
- An expired player row asks the operator to refresh rather than retrying a stale identifier.
- Failed kick and ban actions are retained in history with the safe error message and reason.

## Local data

Moderation history is stored in `player-moderation-history.json` inside the Khaos Nexus data directory. The history contains player display name, server name, action, reason, operator identity, result, and time. It does not retain the hidden game-account identifier.
