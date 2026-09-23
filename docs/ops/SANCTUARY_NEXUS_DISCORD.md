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
- `SANCTUARY_DISCORD_CATEGORY_ID` (already set on the Railway service; not baked into the image)
- `SANCTUARY_BUTTON_CHANNEL_ID` (already set on the Railway service; role menu and group buttons). Aliases: `SANCTUARY_COMMANDS_CHANNEL_ID`, `DIABLO_BUTTON_CHANNEL_ID`
- `READY` is logged and ignored. It does not block startup or commands.

Railway service `sanctuary-nexus` already sets `SANCTUARY_DISCORD_CATEGORY_ID` and `DIABLO_DISCORD_CATEGORY_ID`. The gate reads `SANCTUARY_DISCORD_CATEGORY_ID` first. `DIABLO_DISCORD_CATEGORY_ID` applies only when the primary variable is unset or blank. Do not add either value to the image or to source defaults.

If neither category variable is set, the process logs a warning and allows commands, including DMs. A non-empty value that is not a Discord snowflake fail-closes the gate. When a valid category id is set, commands outside that category and in DMs get an ephemeral deny: `Use this bot in the Sanctuary category.`

Do not set ARK RCON host, port, or password on this service. This image does not start the Nexus backend.

## Commands

`/nexushelp` and `/sanctuary help` list commands and point wallet (`/bal`), verify (`/o9verify`), and shop at Nexus Sentinal. The guild command `/sanctuary` also posts role menus, group listings, build-link shares, a personal season checklist, a staff season note, staff `/sanctuary status`, and ephemeral `/sanctuary timers` (alias `/sanctuary events`).

Timers are a local community cadence for helltide, world boss, and legion. There is no official Blizzard event API, and this service does not call `d4api.dev` or scrape tracker pages. See `docs/ops/sanctuary-bot-runbook.md` for the cadence, optional phase anchors, and the Cephalon, Ascended, and Destiny notes that stay out of this service.

The category id is not baked into the image. See `docs/ops/sanctuary-bot-runbook.md` for the invite, intents, and rollback.

Hub commands stay on Nexus Sentinal. The Discord display name stays Sanctuary Nexus.
