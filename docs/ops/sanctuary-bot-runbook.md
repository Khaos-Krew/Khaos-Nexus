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
- `SANCTUARY_JTC_LOBBY_CHANNEL_ID=1541540961937526916` (baked into `Dockerfile.sanctuary`; blank keeps this lobby). This is join-to-create only.
- `SANCTUARY_BUTTON_CHANNEL_ID` for persistent role menus and group buttons. `SANCTUARY_COMMANDS_CHANNEL_ID` and `DIABLO_BUTTON_CHANNEL_ID` are aliases used only when the primary value is unset or blank
- `READY` is logged and ignored. It does not block startup or commands.
- `SANCTUARY_LFG_TTL_MINUTES` optional, clamped from 15 to 240. Default is 120.
- `SANCTUARY_WORLD_BOSS_ANCHOR` optional UTC instant (`YYYY-MM-DDTHH:mm:ssZ`) if a patch shifts the 210-minute world boss phase. Invalid values fall back to the built-in seed.
- `SANCTUARY_LEGION_ANCHOR` optional UTC instant. Set it only when a legion phase is confirmed. Unset leaves the 25-minute rule without a countdown.

Railway service `sanctuary-nexus` already sets both category variables and `SANCTUARY_BUTTON_CHANNEL_ID`. The process reads `SANCTUARY_DISCORD_CATEGORY_ID` first and uses `DIABLO_DISCORD_CATEGORY_ID` only when that primary value is unset or blank. Do not copy either id into `Dockerfile.sanctuary` or into source defaults. If both category variables are unset, the process logs a warning and allows commands. A non-snowflake value fail-closes the gate. When a valid category id is set, slash commands outside that category (including its threads) and in DMs get an ephemeral deny.

Persistent role menus and LFG button posts go only to the button channel. `/sanctuary roles post:true` updates that channel. On startup the bot posts or edits the role menu there. If the button channel env is unset or not a snowflake, it logs a warning and skips the panel post. Slash commands stay category-gated and are not moved into that channel.

## Intents and invite

Privileged intent: **Server Members Intent** (Guild Members). Gateway intents used: Guilds, Guild Members, and Guild Voice States. Presence and Message Content stay off. Join-to-create also needs View Channel, Manage Channels, Connect, and Move Members in the Sanctuary category. See `docs/ops/JOIN_TO_CREATE.md`.

Invite with the bot and applications.commands scopes. Grant View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles. Manage Roles is required to create missing Sanctuary roles and to place them under the bot role. If Manage Roles is missing, `/sanctuary roles` posts an instruction embed listing the required role names instead of creating them.

Use the application id from `DISCORD_CLIENT_ID`:

`https://discord.com/oauth2/authorize?client_id=DISCORD_CLIENT_ID&scope=bot%20applications.commands&permissions=268520448`

Permission bit `268520448` is View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles.

## Commands

- `/nexushelp` and `/sanctuary help` list commands and point wallet (`/bal`), verify (`/o9verify`), and shop at Nexus Sentinal.
- `/sanctuary roles` opens class, world tier, and seasonal interest selects. Staff can set `post:true` to pin that menu in the channel.
- `/sanctuary lfg` posts a helltide, boss, pit, or seasonal group embed with an optional voice mention and a close button. The post expires on its own.
- `/sanctuary timers` and `/sanctuary events` reply with an ephemeral live community tracker for helltide and world boss, plus an approximate legion line. They do not post a button panel.
- `/sanctuary build` posts a link plus class and build-type tags. The bot does not open the link.
- `/sanctuary season` is that member's checklist.
- `/sanctuary seasonpost` is a staff season note with a Herald template.
- `/sanctuary status` is staff-only. It reports Discord ready, the `READY` flag, whether the category id is present, guild, and latency. `reregister:true` registers commands again.
- `/status` is the shared staff status for this bot.

## Event timers

There is no official Blizzard Diablo IV character, inventory, or event API. Do not add `d4api.dev`; that host does not resolve. Do not scrape HTML pages. A 2026-09-23 check found helltides.com `/api/schedule` behind a Cloudflare challenge and d4armory.io event routes redirected away. Helltide report history on diablo4.life is not used: the public `reports` array was still from 2024 on 2026-09-24.

`/sanctuary timers` and `/sanctuary events` call `https://diablo4.life/api/trackers/list` with User-Agent `KhaosNexus-Sanctuary/1.0`, a 5 second timeout, and a 5 minute in-memory cache. That JSON is community data, not a Blizzard feed. A timeout, non-200, or unreadable body falls back to the approximate local schedule and says so. The Discord process stays up.

- World boss name and spawn time come from `worldBoss` and `nextWorldBoss` when those objects include a name, place, or time.
- Helltide uses the same payload when it includes a name, place, or time. An empty `helltide` object shows "No community Helltide report right now" plus a short approximate line.
- Legion stays approximate. It is not wired to the live feed. Optional phase: `SANCTUARY_LEGION_ANCHOR`.

Approximate fallback, used when a live field is missing or the tracker is down:

- Helltide starts at the top of each UTC hour and runs about 55 minutes.
- World bosses use a 210-minute cycle and an about-15-minute window. The built-in phase is a community seed of 2026-09-23 23:30 UTC. `SANCTUARY_WORLD_BOSS_ANCHOR` overrides that seed. The approximate line does not predict the boss name.
- Legion gatherings are about every 25 minutes for about 4 minutes. The countdown stays off unless `SANCTUARY_LEGION_ANCHOR` is set.

The reply says to confirm the in-game map marker. Role menus and LFG button posts stay in the button channel.

## Other games (not this service)

- Cephalon already calls warframestat.us and warframe.market. Expanding those commands is a separate Director change.
- Ascended can use the Wildcard CDN `officialserverstatus.ini` and server-list JSON for a status command. That is a separate Ascended follow-up.
- Destiny (Vanguard) needs an owner Bungie API key and stays parked.

## Rollback

In Railway, redeploy the previous `sanctuary-nexus` deployment. If that deployment was still BusyBox, the Discord bot stops until `Dockerfile.sanctuary` is selected again. Do not roll this bot back by changing the Sentinal service.
