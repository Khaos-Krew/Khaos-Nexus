# Cephalon and Ascended boards

Wallet, verify, and ranks stay on Nexus Sentinal. These commands do not add a second shop.

## Cephalon Nexus

| Command | Env | Source |
|---------|-----|--------|
| `/fissures` | `CEPHALON_FISSURE_CHANNEL_ID` optional in-place panel. `CEPHALON_FISSURE_CACHE_MS` at least 60s. | `GET https://api.warframestat.us/pc/fissures` |
| `/nightwave` | none | `GET /pc/nightwave`. Done toggles are local Discord state. No Digital Extremes login. |
| `/cycles` | `CEPHALON_CYCLE_ROLES=cetus:ROLE,vallis:ROLE,cambion:ROLE,earth:ROLE` and optional `CEPHALON_CYCLE_CHANNEL_ID` | `cetusCycle`, `vallisCycle`, `cambionCycle`, `earthCycle` |
| `/descendia` | Optional durable panel. `CEPHALON_DESCENDIA_CHANNEL_ID`, or the shared world channel when that is unset. | `GET https://api.warframestat.us/pc/descendia` |

Embeds attribute WFCD WarframeStat. Buttons opt into a cycle ping role. A ping is sent only when that cycle's state changes, and only if both the role and the channel are set.

## Nexus Ascended

| Command | Env | Source |
|---------|-----|--------|
| `/official` | `ASCENDED_OFFICIAL_STATUS_CHANNEL_ID` optional panel. Cache at least 60s. | `https://cdn2.arkdedicated.com/asa/officialserverstatus.ini` |
| `/arkrcon` | unchanged. `NEXUS_DATA_DIR` volume. Never `ARK_*` host, port, or password. | Discord override vault |
| `/cluster` | `ASCENDED_SESSION_IDS` comma-separated SessionIDs. `ASCENDED_CLUSTER_CACHE_MS` default 10 minutes. | Cached slice of the unofficial server list |

`/cluster` shows name, map, player count, and day for allowlisted sessions. It does not print EOS ids. A warm cache is reused. The full list is not downloaded once per command. BattleMetrics is not used. `/cluster` itself is an ephemeral reply. The durable cluster board is the `ark-server-status` panel, refreshed by Nexus Ascended.

## Durable panels

A redeploy must edit the panel already in the channel. Discord does not let one bot edit a message posted by another application, so a panel still owned by Nexus Sentinal cannot be edited in place.

On startup and on each refresh the game bot:

1. Edits the saved message id when that message belongs to this bot.
2. If the id is missing, searches the last 100 messages in the panel channel for the same board. Its own match is edited. Older copies of that board are removed.
3. If the only match was posted by Sentinal (or another bot), posts one replacement, deletes the previous bot message when Manage Messages allows it, and saves the new id. The next redeploy only edits that message.

The id is stored under `NEXUS_DATA_DIR`, or `RAILWAY_VOLUME_MOUNT_PATH` when `NEXUS_DATA_DIR` is unset. Mount a volume on that path so the id survives a redeploy even if the panel has scrolled out of the last 100 messages. Optional snowflakes override the file once: `CEPHALON_FISSURE_MESSAGE_ID`, `ASCENDED_OFFICIAL_STATUS_MESSAGE_ID`, `CEPHALON_WELCOME_MESSAGE_ID`, `ASCENDED_WELCOME_MESSAGE_ID`, and `CEPHALON_EVENT_MESSAGE_ID`.

`/nightwave` and `/cycles` stay ephemeral command replies. Cycle pings are one message when a watched world changes state, not a new board on restart. Nexus Sentinal does not publish the fissure board, the official ASA board, or the public ARK cluster status panel. Ascended owns that cluster panel.

## Warframe world-state panels

Cephalon posts these durable boards on its own 10 minute schedule (`CEPHALON_WARFRAME_PANEL_MS` overrides it, minimum 60 seconds). Sentinal no longer posts or refreshes them. `SENTINAL_WARFRAME_FEED_DISABLED` defaults to disabled. Set it to `false` only to turn the old Sentinal feed back on. Other Sentinal feeds, including ARK and Pokémon GO, keep running. No RCON variables are involved.

Warframe news is not one of these boards. The server already has a news channel that follows the official Warframe Discord, so Cephalon does not post or refresh a `Cephalon • Warframe News` panel. On boot, Cephalon deletes a leftover news panel once when `cephalon-warframe-panels.json` still has a `news` entry, or when the world channel has a Cephalon-authored embed titled `Cephalon • Warframe News`. It clears that store entry and records the retirement. A later boot does not scan, delete, or log again, including when the delete itself failed. If a leftover message is still in the channel after that single attempt, delete it by hand. `CEPHALON_WARFRAME_NEWS_CHANNEL_ID` and `CEPHALON_WARFRAME_NEWS_MESSAGE_ID` do not start a news board. While the retirement record is absent they are read only to find that one message.

Each value below is a channel snowflake or a channel name. The channel must sit under category `1516640233389822042`. One shared channel is enough. A per-panel variable overrides it for that board.

| Panel | Channel variable | Optional message id |
| --- | --- | --- |
| All panels, unless a row below is set | `CEPHALON_WARFRAME_WORLD_CHANNEL_ID` |  |
| Events | `CEPHALON_WARFRAME_EVENTS_CHANNEL_ID` | `CEPHALON_WARFRAME_EVENTS_MESSAGE_ID` |
| Alerts | `CEPHALON_WARFRAME_ALERTS_CHANNEL_ID` | `CEPHALON_WARFRAME_ALERTS_MESSAGE_ID` |
| Sortie | `CEPHALON_WARFRAME_SORTIE_CHANNEL_ID` | `CEPHALON_WARFRAME_SORTIE_MESSAGE_ID` |
| Arbitration | `CEPHALON_WARFRAME_ARBITRATION_CHANNEL_ID` | `CEPHALON_WARFRAME_ARBITRATION_MESSAGE_ID` |
| Nightwave | `CEPHALON_WARFRAME_NIGHTWAVE_CHANNEL_ID` | `CEPHALON_WARFRAME_NIGHTWAVE_MESSAGE_ID` |
| Baro Ki'Teer | `CEPHALON_WARFRAME_VOID_TRADER_CHANNEL_ID` | `CEPHALON_WARFRAME_VOID_TRADER_MESSAGE_ID` |
| Steel Path | `CEPHALON_WARFRAME_STEEL_PATH_CHANNEL_ID` | `CEPHALON_WARFRAME_STEEL_PATH_MESSAGE_ID` |
| Circuit | `CEPHALON_CIRCUIT_CHANNEL_ID` | `CEPHALON_CIRCUIT_MESSAGE_ID` |
| Descendia | `CEPHALON_DESCENDIA_CHANNEL_ID` | `CEPHALON_DESCENDIA_MESSAGE_ID` |

Descendia is the weekly Descent board. It reads the `descendia` key: activation, expiry, and the 21 floors. Mission names come from `typeKey` (`DT_SHRINE_DEFENSE` becomes Shrine Defense). Each floor shows its challenge and a short aura summary when the feed includes one. The description uses a Discord relative countdown to `expiry`. The 10 minute schedule edits the saved message. When that expiry has passed, the refresh fetches `descendia` again before posting so a cached week is not left up after the reset. `/descendia` replies with the same embed and does not post a second channel message. Point `CEPHALON_DESCENDIA_CHANNEL_ID` at `1540956147241062401`, or leave it unset when `CEPHALON_WARFRAME_WORLD_CHANNEL_ID` is already that channel. Leave `CEPHALON_DESCENDIA_MESSAGE_ID` unset on the first deploy.

Message ids are optional pins for Cephalon's own messages. Leave them unset on the first deploy. Do not paste a Sentinal message id. Cephalon posts a new embed and then edits that embed. Titles use a `Cephalon • ` prefix. A refresh adopts or deletes a message only when this bot authored it and the footer starts with `Cephalon Nexus • warframe:<action>`. Another bot or webhook with the same title, including `Baro Ki'Teer` or `Circuit digest`, is left in place. Ids are stored in `cephalon-warframe-panels.json` under `NEXUS_DATA_DIR` (or `RAILWAY_VOLUME_MOUNT_PATH`).

When the Sentinal flag is disabled, Sentinal deletes its own stored Warframe feed messages once, then scans `#warframe-world-state` for footers `Nexus Sentinal • Live Feed • warframe:<action>:v3`. A second boot does not delete again after that cleanup is recorded. If a delete fails, or the state file was lost and the message is older than the last 100 in the channel, delete those messages by hand. Cephalon will not remove them.

`/arkrcon` still uses configure and the password modal. After a process restart, RCON health reads the same encrypted files. Railway env is not a connection source.

## Owner smoke

1. The owner lobbies are already the defaults: Cephalon `1540877236184424500`, Ascended `1540867019979890829`, Sanctuary `1541540961937526916`. Join each lobby. A temporary channel appears and the member is moved. Leave it and confirm the lobby remains.
2. In the Warframe category, `/fissures` lists a node and an expiry and credits WFCD. `/nightwave` toggles a challenge. `/cycles` shows four countdowns.
3. In the ARK category, `/official` matches the Wildcard status text. Restart the Ascended process and confirm `/status` still shows the RCON vault without running `/arkrcon` again. `/cluster` shows only the allowlisted sessions.
