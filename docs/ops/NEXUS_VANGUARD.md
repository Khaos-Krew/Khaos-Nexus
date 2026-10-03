# Nexus Vanguard (Slice A)

Nexus Vanguard is the Destiny 2 Discord bot for Railway service `nexus-vanguard`. Slice A has no Bungie API calls. It posts Discord-native fireteams, runs Join-To-Create voice, and uses the same category gate and `/nexushelp` / `/status` spine as Cephalon, Ascended, and Sanctuary.

Wallet, verify, ranks, and the shop stay on Nexus Sentinal. Vanguard has no paid tiers, donations, ads, or Nexus Coins.

Image: `Dockerfile.vanguard` (`node:22-slim`, `npm ci --omit=dev`). Start command: empty, so the image runs `node src/railway/vanguard-service.cjs`. Local equivalent: `npm run vanguard`.

Brand line on panels: `Many Worlds One Nexus`. Every panel footer also ends with `Not affiliated with or endorsed by Bungie`.

## Shared helpers (imported, not copied)

| Piece | Path | What Vanguard calls |
|-------|------|---------------------|
| Category gate | `src/game-bots/category-gate.cjs` | `evaluateChannelCategory(channel, 'vanguard')` via `src/game-bots/vanguard/gate.cjs` |
| Durable panel upsert | `src/game-bots/panel-message.cjs` | `upsertEmbed` via `upsertOwnedPanel`. Matching is the Vanguard bot id plus an exact footer. Other bots' messages are not edited or deleted. |
| Cephalon boards | `src/game-bots/cephalon-relay.cjs` (`startCephalonBoards`) and `refreshDurablePins` in `src/game-bots/stage-commands.cjs` | Not used. Those refresh Warframe and ARK pins. |
| Join-To-Create | `src/game-bots/join-to-create.cjs` | `installJoinToCreate` / `resolveJtcConfig` via `src/game-bots/vanguard/jtc.cjs` |
| Ops spine | `src/game-bots/ops-spine.cjs` | `installOpsSpine` from `startGameBot` for `/nexushelp` and `/status` |
| Railway boot | `src/game-bots/start.cjs` | `src/railway/vanguard-service.cjs` calls `startGameBot`, same as the other game bots |
| Atomic JSON | `readJson` / `writeJson` in `src/game-bots/panel-message.cjs` | `GuildStateStore` tmp-then-rename writes |

Vanguard panel refreshes and LFG expiry share one in-process scheduler mutex (`src/game-bots/vanguard/scheduler.cjs`). The ready handler and the one-minute tick both enter that mutex. The fireteam board also refreshes 5 seconds after a roster change, and again every 10 minutes.

## Railway

Create service `nexus-vanguard` (do not point Sentinal, Cephalon, Ascended, or Sanctuary at this Dockerfile).

| Setting | Value |
|---------|--------|
| Builder | Dockerfile |
| Dockerfile path | `Dockerfile.vanguard` |
| Start command | empty |
| Volume name | `nexus-vanguard-data` |
| Mount path | `/data/vanguard` |
| Volume size | 1 GB or more |
| Healthcheck path | `/health` |
| Port | Railway `PORT` (the process listens on `PORT`, default 8080) |

`/health` returns 503 until Discord is ready, then 200. That is the same game-bot health server the other bots use. A 503 during login is not a Bungie failure. This service has no Postgres plugin and no economy credentials.

Do not set `BUNGIE_API_KEY` for Slice A. Later slices stay off until that work is deployed.

## Environment variables

Set these on `nexus-vanguard` only. Never put the bot token in the Dockerfile, a log line, or an embed.

| Variable | Required | Purpose |
|----------|----------|---------|
| `VANGUARD_DISCORD_TOKEN` | yes | Bot token. Required on its own. A missing value exits before login and is never logged. The process copies it onto `DISCORD_BOT_TOKEN`. `DISCORD_BOT_TOKEN` alone does not start this bot. |
| `VANGUARD_DISCORD_APP_ID` | yes | Application id for the invite URL and command registration context. |
| `VANGUARD_GUILD_ID` | yes | Guild for slash-command registration. |
| `VANGUARD_DISCORD_CATEGORY_ID` | yes | Category gate. Missing, blank, or not a snowflake fail-closes every command. |
| `VANGUARD_CATEGORY_ID` | alias | Used only when `VANGUARD_DISCORD_CATEGORY_ID` is unset or blank. |
| `VANGUARD_DATA_DIR` | no | Default `/data/vanguard`. Also assigned to `NEXUS_DATA_DIR` so Join-To-Create uses the volume. |
| `VANGUARD_STAFF_ROLE_IDS` | no | Comma-separated role snowflakes. Staff also includes Discord Administrator, `NEXUS_OWNER_USER_IDS`, and `NEXUS_OPERATOR_ROLE_IDS`. |
| `VANGUARD_STAFF_ALERT_CHANNEL_ID` | no | Staff alert and status panel channel. |
| `VANGUARD_LFG_CHANNEL_ID` | no | Channel for fireteam posts. Unset leaves `/lfg create` off until `/vanguard setup` or this variable. |
| `VANGUARD_FIRETEAM_FINDER_CHANNEL_ID` | no | Durable fireteam board. Falls back to the lfg channel. |
| `VANGUARD_PANELS_CHANNEL_ID` | no | Created by setup for a later slice. Unused by Bungie panels in Slice A. |
| `VANGUARD_JTC_LOBBY_CHANNEL_ID` | no | Join-To-Create lobby voice. Unset leaves JTC off. No baked default. |
| `VANGUARD_JTC_CATEGORY_ID` | no | Ignored unless it equals `VANGUARD_DISCORD_CATEGORY_ID`. An unset or invalid gate leaves Join-To-Create off. A different value does not create channels outside the gate. |
| `VANGUARD_JTC_EMPTY_GRACE_MS` | no | Shared empty-channel grace, clamped 5–120 seconds. Default 15 seconds. |
| `VANGUARD_LFG_DEFAULT_TTL_MIN` | no | Default 120. Clamped 15–720. |
| `VANGUARD_LFG_MAX_OPEN_PER_USER` | no | Default 2. Clamped 1–10. |
| `NEXUS_OWNER_USER_IDS` | no | Owner user ids, same meaning as the other bots. |
| `NEXUS_OPERATOR_ROLE_IDS` | no | Operator role ids, same meaning as the other bots. |
| `NEXUS_STAFF_ADMIN_ROLE_IDS` | no | Staff admin role ids. Count as staff in the shared ops check. Unset fails closed. See `docs/SENTINAL_MODERATION.md`. |

`READY` is not read. Category and lobby ids are not baked into `Dockerfile.vanguard`.

## Discord application

Privileged intent: **Server Members Intent** (Guild Members). Gateway intents: Guilds, Guild Members, and Guild Voice States. Presence and Message Content stay off.

Permissions in the category:

- View Channel
- Send Messages
- Embed Links
- Read Message History
- Manage Channels
- Connect
- Move Members

Invite (replace `APP_ID` with `VANGUARD_DISCORD_APP_ID`):

`https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=17910800`

Permission bit `17910800` is the set above. Manage Channels, Connect, and Move Members are what Join-To-Create and `/vanguard setup` need. The bot does not need Mention Everyone; full fireteams ping the members on the post.

## Channels

When Discord is ready, the bot creates any missing channels under `VANGUARD_DISCORD_CATEGORY_ID`. It reuses a channel already in that category when the stored id or the channel name matches, and it does not create channels anywhere else. A missing or invalid category fail-closes this step: nothing is created. Staff can run `/vanguard setup` again later; that command uses the same rules and stays staff-only. The channels are:

| Name | Type | Use |
|------|------|-----|
| `lfg` | text | `/lfg create` posts |
| `fireteam-finder` | text | durable fireteam board |
| `panels` | text | reserved for a later slice |
| `staff-alerts` | text | status panel and command-failure alerts |
| `lobby` | voice | Join-To-Create lobby |

Names must not include the game name (`destiny-lfg` is not used). An id already set in Railway is left alone. A non-empty value that is not a snowflake is ignored and reported; fix it in Railway. Setup reuses an existing channel with the same name in the category.

Created ids are stored in `state/channels.json` and used when the matching env var is unset. Startup and `/vanguard setup` both point Join-To-Create at `lobby` through the one install path. A restart reuses the stored ids.

## Commands

- `/nexushelp` is ephemeral. It lists Vanguard commands and points wallet (`/bal`), verify (`/o9verify`), ranks, and the shop at Nexus Sentinal.
- `/status` is ephemeral and staff-only. It reports Discord ready, whether the category gate is fail-closed, whether the data dir is writable, LFG and Join-To-Create state, and the deploy SHA when `RAILWAY_GIT_COMMIT_SHA` is a hex commit. It does not show tokens or channel snowflakes. With the category id missing, the gate refuses `/status` and the reply says the gate is fail-closed.
- `/lfg create` posts in `lfg` when that channel exists. Outside the category the gate refuses it. `activity` is one of Raid, Dungeon, Nightfall, Trials, Iron Banner, Crucible, Gambit, Onslaught, Pantheon, or Other. `slots` is 2–12 (activity default when omitted). `when` is free text and is not parsed. `note` is at most 200 characters.
- `/lfg list` is an ephemeral list of open posts in this guild.
- `/lfg close` closes a post the caller hosts. Staff can close any open post.
- Join, Leave, and Close buttons follow the same rules. Join is refused when the post is full or the member is already in it. The host closes instead of leaving. Filling the post pings members and offers the lobby voice channel. The shared Join-To-Create module creates and later deletes that temporary channel.
- Posts expire at the TTL and are edited to **Expired**. Closed posts are edited to **Closed**. State is per guild.

Create is limited to one post per 10 seconds per user. Join, leave, and close are limited to one action per 5 seconds per user. Only the host or staff can close a post.

## State on the volume

```
/data/vanguard/
  state/lfg.json        # open fireteams, keyed by guild id
  state/panels.json     # lfg-board and status message ids, keyed by guild id
  state/channels.json   # ids created by /vanguard setup
  jtc-vanguard.json     # temporary voice channels (shared Join-To-Create file)
```

Panel identity is the footer only, for example:

`Many Worlds One Nexus • Nexus Vanguard • lfg-board • v1 • Not affiliated with or endorsed by Bungie`

Titles such as `Vanguard • Fireteam Board` are display only. A restart edits the saved message in place.

Player Bungie profiles are not stored. Slice A does not fetch them.

## Rollback

Stop service `nexus-vanguard`, or do not deploy this image. Sentinal, the economy worker, Cephalon, Ascended, and Sanctuary keep running. Panels that were already posted stay in Discord and simply stop updating. No shared database migration is involved.
