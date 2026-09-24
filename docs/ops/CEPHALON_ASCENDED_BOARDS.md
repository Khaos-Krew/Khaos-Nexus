# Cephalon and Ascended boards

Wallet, verify, and ranks stay on Nexus Sentinal. These commands do not add a second shop.

## Cephalon Nexus

| Command | Env | Source |
|---------|-----|--------|
| `/fissures` | `CEPHALON_FISSURE_CHANNEL_ID` optional in-place panel. `CEPHALON_FISSURE_CACHE_MS` at least 60s. | `GET https://api.warframestat.us/pc/fissures` |
| `/nightwave` | none | `GET /pc/nightwave`. Done toggles are local Discord state. No Digital Extremes login. |
| `/cycles` | `CEPHALON_CYCLE_ROLES=cetus:ROLE,vallis:ROLE,cambion:ROLE,earth:ROLE` and optional `CEPHALON_CYCLE_CHANNEL_ID` | `cetusCycle`, `vallisCycle`, `cambionCycle`, `earthCycle` |

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

`/arkrcon` still uses configure and the password modal. After a process restart, RCON health reads the same encrypted files. Railway env is not a connection source.

## Owner smoke

1. The owner lobbies are already the defaults: Cephalon `1540877236184424500`, Ascended `1540867019979890829`, Sanctuary `1541540961937526916`. Join each lobby. A temporary channel appears and the member is moved. Leave it and confirm the lobby remains.
2. In the Warframe category, `/fissures` lists a node and an expiry and credits WFCD. `/nightwave` toggles a challenge. `/cycles` shows four countdowns.
3. In the ARK category, `/official` matches the Wildcard status text. Restart the Ascended process and confirm `/status` still shows the RCON vault without running `/arkrcon` again. `/cluster` shows only the allowlisted sessions.
