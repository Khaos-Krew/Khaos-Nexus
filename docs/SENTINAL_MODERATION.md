# Nexus Sentinal moderation commands

## `/clear amount:<1-100>`

Administrator-only channel cleanup command.

- Operates only in the channel where the slash command is run.
- Requires Discord `Administrator` permission in both the registered command schema and the runtime authorization check.
- `amount` is required and accepts 1 through 100.
- Uses Discord bulk deletion with old-message filtering enabled.
- Discord bulk deletion cannot remove messages older than 14 days; Sentinal reports how many requested messages were left untouched.
- The completion/error response is ephemeral.
- No game-module capability or raw console path is involved.
