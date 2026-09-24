# Join-to-create voice lobbies

Each game bot owns the join-to-create lobby in its own category. Nexus Sentinal no longer creates temporary voice channels for ARK, Warframe, or Diablo IV. Sanctuary Nexus has no new live-game feed in this slice; it only takes over its own lobby.

## Discord permissions

The game bot needs these permissions in its category:

- View Channel
- Manage Channels
- Connect
- Move Members

Administrator includes those permissions. The bot also needs the Guild Voice States gateway intent, which the game-bot process declares itself.

## Environment variables

| Bot | Lobby channel | Owner lobby id | Category override | Empty grace |
|-----|---------------|-----------------|-------------------|-------------|
| Cephalon Nexus | `CEPHALON_JTC_LOBBY_CHANNEL_ID` | `1540877236184424500` | `CEPHALON_JTC_CATEGORY_ID` | `CEPHALON_JTC_EMPTY_GRACE_MS` |
| Nexus Ascended | `ASCENDED_JTC_LOBBY_CHANNEL_ID` | `1540867019979890829` | `ASCENDED_JTC_CATEGORY_ID` | `ASCENDED_JTC_EMPTY_GRACE_MS` |
| Sanctuary Nexus | `SANCTUARY_JTC_LOBBY_CHANNEL_ID` | `1541540961937526916` | `SANCTUARY_JTC_CATEGORY_ID` | `SANCTUARY_JTC_EMPTY_GRACE_MS` |

Those lobby ids are the owner voice channels. They are the source default and are baked into `Dockerfile.cephalon`, `Dockerfile.ascended`, and `Dockerfile.sanctuary`, the same way Cephalon and Ascended bake category ids. A blank variable keeps the owner id. A non-empty value that is not a Discord snowflake turns join-to-create off instead of falling back. Set the variable to a different snowflake to point at another lobby.

The category override is optional. When it is unset, the bot uses its category gate id (`CEPHALON_DISCORD_CATEGORY_ID`, `ASCENDED_DISCORD_CATEGORY_ID`, or `SANCTUARY_DISCORD_CATEGORY_ID`). Those gates stay `1516640233389822042`, `1516602943670059108`, and `1541540940471210128`. Sanctuary's category id stays a Railway variable and is not baked into the image.

Grace defaults to 15 seconds and is clamped between 5 and 120 seconds. An empty temporary channel is deleted after that grace. The lobby channel itself is never deleted.

The bot ignores joins outside its guild and outside its category. A member who already has a temporary channel is moved back into it. Staff `/status` reports whether the lobby is configured. It does not print display names.

Temporary channel ids are stored under `NEXUS_DATA_DIR` so a reconnect does not open a second channel for the same member.
