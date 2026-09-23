# Sanctuary Nexus Discord service

Sanctuary Nexus is the Discord game bot for Railway service `sanctuary-nexus`. Build it from `Dockerfile.sanctuary` (`node:22-slim`, `npm ci --omit=dev`). The image command is `node src/railway/sanctuary-service.cjs`. `NEXUS_GAME_ROLE` is `diablo`.

Do not deploy this service from BusyBox. In Railway, set the builder to Dockerfile and the Dockerfile path to `Dockerfile.sanctuary`. Leave the start command empty so the image `CMD` is used. After this lands, remove the BusyBox image and redeploy `sanctuary-nexus` from the merge tip.

Local equivalent: `npm run sanctuary`.

## Environment

Set these on `sanctuary-nexus`:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `SANCTUARY_DISCORD_CATEGORY_ID` once the Discord category id is known
- `READY` is logged and ignored. It does not block startup or commands.

`DIABLO_DISCORD_CATEGORY_ID` is used only when `SANCTUARY_DISCORD_CATEGORY_ID` is unset or blank.

If neither category variable is set, the process logs a warning and allows commands, including DMs, so the bot can log in before a category id exists. A non-empty value that is not a Discord snowflake fail-closes the gate. When a valid category id is set, commands outside that category and in DMs get an ephemeral deny: `Use this bot in the Sanctuary category.`

Do not set ARK RCON host, port, or password on this service. This image does not start the Nexus backend.

## Commands

`/nexushelp` lists this bot's commands and points wallet (`/bal`), verify (`/o9verify`), and ranks at Nexus Sentinal. `/sanctuary` is a short info reply. `/status` is staff-only and does not report a game backend.

Hub commands stay on Nexus Sentinal. The Discord display name stays Sanctuary Nexus.
