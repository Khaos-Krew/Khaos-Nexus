# Sanctuary Nexus bot runbook

Sanctuary Nexus is the Discord bot for Railway service `sanctuary-nexus`. The display name stays Sanctuary Nexus. `NEXUS_GAME_ROLE` is `diablo`. Wallet, verify, and shop stay on Nexus Sentinal.

Image: `Dockerfile.sanctuary` (`node:22-slim`, `npm ci --omit=dev`). Start command: empty, so the image runs `node src/railway/sanctuary-service.cjs`. Local equivalent: `npm run sanctuary`.

## Railway follow-up

Set service `sanctuary-nexus` builder to Dockerfile and the Dockerfile path to `Dockerfile.sanctuary`. Remove the BusyBox image. Redeploy from the merge tip.

Do not point Nexus Sentinal at this Dockerfile. Do not set ARK RCON host, port, or password on this service.

## Token and env

Set these on `sanctuary-nexus` only:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_GUILD_ID`
- `SANCTUARY_DISCORD_CATEGORY_ID` (preferred) or `DIABLO_DISCORD_CATEGORY_ID` if the preferred variable is unset
- `READY` is logged and ignored. It does not block startup or commands.
- `SANCTUARY_LFG_TTL_MINUTES` optional, clamped from 15 to 240. Default is 120.

The category id lives only in Railway. Do not bake it into `Dockerfile.sanctuary` or source. If both category variables are unset, the process logs a warning and allows commands so a deploy can finish before the id is copied. A non-snowflake value fail-closes the gate. When a valid id is set, slash commands, role selects, checklist buttons, and group-close buttons outside that category (including its threads) and in DMs get an ephemeral deny.

## Intents and invite

Privileged intent: **Server Members Intent** (Guild Members). Gateway intents used: Guilds and Guild Members. Presence and Message Content stay off.

Invite with the bot and applications.commands scopes. Grant View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles. Manage Roles is required to create missing Sanctuary roles and to place them under the bot role. If Manage Roles is missing, `/sanctuary roles` posts an instruction embed listing the required role names instead of creating them.

Use the application id from `DISCORD_CLIENT_ID`:

`https://discord.com/oauth2/authorize?client_id=DISCORD_CLIENT_ID&scope=bot%20applications.commands&permissions=268520448`

Permission bit `268520448` is View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles.

## Commands

- `/nexushelp` and `/sanctuary help` list commands and point wallet (`/bal`), verify (`/o9verify`), and shop at Nexus Sentinal.
- `/sanctuary roles` opens class, world tier, and seasonal interest selects. Staff can set `post:true` to pin that menu in the channel.
- `/sanctuary lfg` posts a helltide, boss, pit, or seasonal group embed with an optional voice mention and a close button. The post expires on its own.
- `/sanctuary build` posts a link plus class and build-type tags. The bot does not open the link.
- `/sanctuary season` is that member's checklist.
- `/sanctuary seasonpost` is a staff season note with a Herald template.
- `/sanctuary status` is staff-only. It reports Discord ready, the `READY` flag, whether the category id is present, guild, and latency. `reregister:true` registers commands again.
- `/status` is the shared staff status for this bot.

## Rollback

In Railway, redeploy the previous `sanctuary-nexus` deployment. If that deployment was still BusyBox, the Discord bot stops until `Dockerfile.sanctuary` is selected again. Do not roll this bot back by changing the Sentinal service.
