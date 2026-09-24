# Nexus Craft

Nexus Craft is the Minecraft Discord bot for Railway service `nexus-craft`. Build it from `Dockerfile.craft` (`node:22-slim`, `npm ci --omit=dev`). The image command is `node src/railway/craft-service.cjs`. `NEXUS_GAME_ROLE` is `minecraft`. Local equivalent: `npm run craft`.

The image copies this file to `/app/docs/ops/NEXUS_CRAFT.md`. Leave the Railway start command empty so the image `CMD` is used. There is no `railway.toml` for the other game bots, so Craft does not add one. Set the service in the Railway dashboard.

Join-to-create is not part of this bot.

## Railway service `nexus-craft`

- Builder: Dockerfile
- Dockerfile path: `Dockerfile.craft`
- Start command: empty
- Health check path: `/health` (HTTP 200 while the process is up, including when Discord is idle because the token is unset)
- Volume: mount a Railway volume at `/app/data` so listings, the status-panel message id, and the RCON vault survive redeploys. The image sets `NEXUS_DATA_DIR=/app/data`.

Watch patterns, so other bots do not rebuild Craft and Craft does not rebuild them:

```text
Dockerfile.craft
docs/ops/NEXUS_CRAFT.md
package.json
package-lock.json
config.example.json
src/craft/**
src/railway/craft-service.cjs
src/backend/transports/rcon-protocol.cjs
src/backend/transports/source-rcon.cjs
src/game-bots/panel-message.cjs
src/game-bots/category-gate.cjs
src/game-bots/command-failure.cjs
src/game-bots/ops-spine.cjs
src/shared/config.cjs
```

Do not add `Dockerfile.craft` or `src/craft/**` to the Cephalon, Ascended, Sanctuary, or Sentinal watch paths.

## Environment

Required before the bot logs into Discord. The process still boots and serves `/health` when these are empty.

- `NEXUS_CRAFT_TOKEN` — bot token. This process does not read `DISCORD_BOT_TOKEN`.

Required before slash commands work.

- `DISCORD_GUILD_ID` — guild where `/craft`, `/mc`, `/mcrcon`, and `/realm` are registered. `NEXUS_DISCORD_GUILD_ID` is accepted as an alias.
- `NEXUS_CRAFT_DISCORD_CATEGORY_ID` — commands and panels only run in channels (and threads) under this category. If it is unset or not a snowflake, the bot replies: `Nexus Craft is not configured. Set NEXUS_CRAFT_DISCORD_CATEGORY_ID.`

Optional.

- `NEXUS_CRAFT_CLIENT_ID` — application id, logged as present or missing and used for the invite URL. `DISCORD_CLIENT_ID` is accepted as an alias. Not required to boot.
- `NEXUS_CRAFT_REALMS_CHANNEL_ID` — Realms board channel. When unset, staff can save a channel with `/realm channel`. The board channel must sit inside the Craft category.
- `NEXUS_CRAFT_STATUS_REFRESH_SECONDS` — status panel edit interval. Default 120. Clamped to 30–900.
- `NEXUS_OWNER_USER_IDS` — comma-separated owner user ids. Count as staff.
- `NEXUS_OPERATOR_ROLE_IDS` — comma-separated staff role ids. Count as staff, same check the other game bots use, plus Administrator.
- `NEXUS_RCON_CONFIG_SECRET` — optional vault key of at least 32 characters. This encrypts the saved RCON password. It is not the RCON password. If unset, the bot creates `/app/data/nexus-craft-rcon-secret` on first save.
- `NEXUS_DATA_DIR` — already `/app/data` in the image. `RAILWAY_VOLUME_MOUNT_PATH` is used only when `NEXUS_DATA_DIR` is blank.
- `PORT` — health server port. Default 8080.

Do not set RCON host, port, or password in Railway. `/mcrcon` ignores those variables. The Discord store is the only connection source. The password is never echoed in a reply or a log line.

## One-time owner setup in Discord

1. Create the bot application. Invite it with scopes `bot` and `applications.commands`. Grant View Channels, Send Messages, Embed Links, Read Message History, Create Public Threads, and Send Messages in Threads. Privileged intents are not required.
2. Invite URL shape: `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands`. In the authorize screen, grant View Channels, Send Messages, Embed Links, Read Message History, Create Public Threads, and Send Messages in Threads.
3. Put the bot token in `NEXUS_CRAFT_TOKEN`, the guild id in `DISCORD_GUILD_ID`, and the Minecraft category id in `NEXUS_CRAFT_DISCORD_CATEGORY_ID`. Redeploy.
4. In a channel inside that category, a staff member runs `/mcrcon setup` with the Java server host, RCON port, and password. Add `server` only when more than one Java server should be saved. Check with `/mcrcon status`. The password field is not printed back.
5. Optional: `/mc panel` with the public host posts one status embed in the current channel. Restarts edit that message instead of posting another.
6. Optional: set `NEXUS_CRAFT_REALMS_CHANNEL_ID`, or run `/realm channel` in the board channel.
7. A Realm owner runs `/realm post` (name, Java or Bedrock, description, open slots, optional image). Players press Apply, enter a gamertag and a note, and the bot pings that listing's owner in a thread, or in a DM if a thread cannot be opened. Approve or Deny works for that owner or for staff. Approve tells the applicant the next step. The owner still adds them inside Minecraft.

## Commands

`/craft help` lists commands and the matrix below.

`/mc status` pings a host with no RCON. Java uses the server-list ping (default port 25565). Bedrock uses a RakNet unconnected ping (default port 19132). `edition` can be `java`, `bedrock`, or `both`.

Staff RCON, after `/mcrcon setup`: `/mc players`, `/mc say`, `/mc whitelist add`, `/mc whitelist remove`, `/mc whitelist list`, `/mc kick`, and `/mc cmd`. `/mc cmd` uses the same staff check as the other bots: owner id, Administrator, or an operator role.

`/mcrcon clear` with `confirm: true` deletes one saved server.

## Edition support

| Target | Status | RCON | Realms board |
| --- | --- | --- | --- |
| Java dedicated server | Server-list ping | Full (`/mc` and `/mcrcon`) | No |
| Bedrock dedicated server | RakNet ping, port 19132 | No | No |
| Bedrock players on Java through Geyser | Java ping | Full, because the server is Java | No |
| Minecraft Realms | No | No. Mojang provides no RCON and no official Realms API | Yes |

## Health

`GET /health` returns 200 and `{"ok":true,"service":"nexus-craft",...}` as soon as the process is listening. If `NEXUS_CRAFT_TOKEN` is missing, the process logs `[Nexus Craft] token missing, Discord idle` and does not log in to Discord.
