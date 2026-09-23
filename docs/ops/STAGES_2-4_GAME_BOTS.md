# Stages 2–4 game-bot utility

These commands sit on the Stage 1 category gate. Nexus Ascended still only runs inside category `1516602943670059108`. Cephalon Nexus still only runs inside category `1516640233389822042`. Threads follow the parent channel. DMs and other categories get the ephemeral redirect and do not run the command. Nexus Sentinal stays the hub for `/bal`, `/o9verify`, and ranks, and is not category-locked.

Do not set ARK RCON host, port, or password on Railway. The health check and the wipe checklist read the Discord `/arkrcon` override store only (`NEXUS_RCON_RAILWAY_ENV_FORBIDDEN=true`, `NEXUS_RCON_SOURCE=discord_override_store`).

## Stage 2 — Nexus Ascended

`/arkrcon` still writes the override. A background loop on the Ascended process calls `ListPlayers` for `ARK_GEN1` and `ARK_MAP2` when an override is configured. `/status` shows `ok`, `failed`, or `not configured`, plus a player count when the check succeeded. The public row, the log line, and the wipe checklist never include host, port, or password.

| Variable | Meaning |
|----------|---------|
| `ASCENDED_RCON_HEALTH` | Default on. `off`, `false`, `0`, or `no` stops the loop. |
| `ASCENDED_RCON_HEALTH_INTERVAL_MS` | Default 5 minutes. Clamped between 60 seconds and 30 minutes. |
| `ASCENDED_PRESENCE_CHANNEL_ID` | Optional snowflake. Join/leave lines post here after the first successful player list, which only seeds and does not announce. |
| `ASCENDED_WELCOME_CHANNEL_ID` | Optional. Staff `/welcome` refreshes one pinned welcome message. |
| `NEXUS_DATA_DIR` | JSON files for the rate card and welcome pin. Image default `/app/data`. |

Presence lines are display names and `joined Gen1` / `left Map2`. EOS ids are not posted. Logs are counts and error class only.

Cluster shop copy stays on Nexus Sentinal (NP and cache paths). A quote says nothing is charged until Confirm. Insufficient NP names the price and wallet balance and points at `/bal`. A confirmed order shows delivery status (`Paid`, `in progress`, `complete`, or waiting on ARK item removal).

Dino-cache reveal is four stored-roll stages. Stage 0 does not show species. The footer says the roll is stored and is not a reroll. Shiny is not re-added. ArkShop MySQL stays retired.

## Stage 3 — Cephalon Nexus

| Command | Who | What |
|---------|-----|------|
| `/market` | everyone | Lowest sell, highest buy, and how many top sell orders were in the snapshot. A set slug is labeled as the set. A `*_relic` slug is the relic, not one reward. The tip says this is not a trade. Seller names are not shown. |
| `/worldstate` | everyone | Cetus, Orb Vallis, Duviri, and up to three open invasions. Each path fails on its own and becomes `unavailable`. Results cache for `CEPHALON_WORLDSTATE_CACHE_MS` (default 60 seconds, minimum 5 seconds). |
| `/dojo` | everyone | Static clan checklist plus wiki links for Dojo, Research, and Trading. |
| `/calendar show` | everyone | Current staff pin. |
| `/calendar set` / `clear` | staff | Writes `cephalon-event-calendar.json`. If `CEPHALON_EVENT_CHANNEL_ID` is a snowflake, staff refresh that channel message. |

## Stage 4 — community hooks

`/welcome` on each game bot posts that bot’s card and points wallet, verify, and ranks at Nexus Sentinal. Staff can refresh the optional welcome channel. The pin id is `{bot}-welcome-pin.json` under `NEXUS_DATA_DIR`.

`/cosmetic` is Cephalon only. `CEPHALON_COSMETIC_ROLES` is `snowflake:Label,snowflake:Label` (max 25). The command adds or removes that Discord role. It does not change Sentinal ranks, wallet, or in-game power.

`/rates` on Ascended reads `ascended-rate-cards.json` (staff `/rates edit`). Defaults are a planning card: taming 5x, breeding 10x, harvest 3x, XP 3x. `/rates breed` scales hatch and mature by the breeding rate and does not scale the mating interval. `/rates boss` is a checklist and does not start a fight or spend Nexus Points.

`/wipe` is staff-only. It reminds the operator to pause the cluster shop, verify RCON from the override store, and confirm a backup. It does not pause the shop, run a destructive command, or change the server.

## Railway variables

Already baked into the images: `CEPHALON_DISCORD_CATEGORY_ID`, `ASCENDED_DISCORD_CATEGORY_ID`, and the Ascended RCON-forbidden flags. Leave `ARKSHOP_DB_MODE=disabled`.

Optional, not secrets:

- `NEXUS_STAFF_ALERT_CHANNEL_ID`
- `ASCENDED_PRESENCE_CHANNEL_ID`
- `ASCENDED_WELCOME_CHANNEL_ID`
- `CEPHALON_WELCOME_CHANNEL_ID`
- `CEPHALON_EVENT_CHANNEL_ID`
- `CEPHALON_COSMETIC_ROLES`
- `CEPHALON_WORLDSTATE_CACHE_MS`
- `ASCENDED_RCON_HEALTH` and `ASCENDED_RCON_HEALTH_INTERVAL_MS`
- `NEXUS_DATA_DIR` when the JSON files must survive a redeploy (volume at `/app/data`)

## Owner smoke

1. Keep the Stage 1 category checks: Ascended only in `1516602943670059108`, Cephalon only in `1516640233389822042`, threads allowed, DMs redirected, Sentinal `/bal` still works outside those categories.
2. On `nexus-ascended`, confirm there is still no `ARK_*_HOST`, `ARK_*_RCON_PORT`, or `ARK_*_RCON_PASSWORD`.
3. After `/arkrcon` has Gen1 and Map2 overrides, staff `/status` shows RCON health without a host, port, or password. Logs show `ok`, `configured`, player count, and error class only.
4. With `ASCENDED_PRESENCE_CHANNEL_ID` set, the first successful poll does not announce the current players. A later join or leave posts the display name only.
5. On Sentinal, a cluster-shop quote says nothing is charged until Confirm. An insufficient-NP failure names the price and does not claim a charge. A paid order shows a delivery line.
6. Opening a dino cache shows “Dino Cache reveal” and “stored roll”. The first stage does not show species. The word shiny is not in that reveal.
7. Cephalon `/market` shows plat and the snapshot tip. `/worldstate` still replies if one cycle source fails. `/dojo` lists the wiki links. Staff `/calendar set` pins when `CEPHALON_EVENT_CHANNEL_ID` is set.
8. `/welcome` on each bot names that bot and Sentinal. `/cosmetic` refuses a role that is not in `CEPHALON_COSMETIC_ROLES`. `/rates` and staff `/wipe` run only in the Ascended category. `/wipe` does not pause the shop.
