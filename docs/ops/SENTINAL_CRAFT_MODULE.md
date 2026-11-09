# Sentinal Craft module

Nexus Craft's always-on Discord features run inside Nexus Sentinal when `SENTINAL_CRAFT_MODULE=true`. The flag defaults off, so a deploy with the variable unset does not register commands, start the status loop, or start the Minecraft Points loops. The separate `nexus-craft` Railway service can stay up until the cutover below is finished. Do not merge this by turning the flag on in the same change that stops Craft unless the data copy is already done.

Sentinal and Craft already share the economy Postgres database. Realm listings, applications, the board channel, the status panel, and the RCON vault are files on the data volume, not new tables.

## Command mapping

`/minecraft` stays Sentinal's provider-backed server-tools command (`status`, `players`, `kick`, `ban`, and the rest of that module). Craft's names do not collide with it, or with `/shop` and `/shopadmin`, so they are unchanged.

| Craft | Sentinal | Who |
| --- | --- | --- |
| `/craft help` | `/craft help` | Everyone in the Craft category |
| `/mc status` | `/mc status` | Everyone in the Craft category |
| `/mc panel` | `/mc panel` | Staff |
| `/mc players`, `/mc say`, `/mc whitelist add\|remove\|list`, `/mc kick`, `/mc cmd` | same | Staff. Same owner, Administrator, operator-role, and staff-admin check as Craft |
| `/mc link start\|confirm\|status`, `/mc unlink` | same | Registered only when `MC_POINTS_ENABLED=true` |
| `/mc shop` | `/mc shop` | Registered only when `MC_SHOP_ENABLED=true`. Opens Sentinal's Minecraft shop |
| `/mc starter` | `/mc starter` | Registered only when `MC_STARTER_KIT_ENABLED=true`. Claims the kit in Sentinal |
| `/mcrcon setup\|status\|clear` | same | Staff. Password is stored encrypted and is not echoed |
| `/realm post\|edit\|close` | same | Listing owner. Apply, Approve, and Deny keep the `craft:realm:` button and modal ids |
| `/realm channel` | `/realm channel` | Staff |
| `/mcadmin orders\|kits\|link-revoke\|refund\|resolve` | same | Staff, and only when a Points flag is on. `refund` and `resolve` still point at `/shopadmin mc-refund` |
| — | `/realm repost` | Staff. One-time republish so Apply buttons belong to Sentinal. Also re-sends pending application reviews by DM |

## Environment

Required to turn the module on:

- `SENTINAL_CRAFT_MODULE=true` — master switch. Unset, empty, or `false` leaves the module off.
- `NEXUS_CRAFT_DISCORD_CATEGORY_ID` — commands and buttons, except Approve and Deny, only run in this category. Same fail-closed message as Craft when it is missing.
- Sentinal's existing guild id (`DISCORD_GUILD_ID` or `NEXUS_DISCORD_GUILD_ID`) and bot token. This module does not read `NEXUS_CRAFT_TOKEN`.

Copy forward from Craft when that feature is in use:

- `NEXUS_CRAFT_REALMS_CHANNEL_ID` — optional. When unset, `/realm channel` reads the saved id in `nexus-craft.json`.
- `NEXUS_CRAFT_STATUS_REFRESH_SECONDS` — optional. Default 120, clamped to 30–900.
- `NEXUS_RCON_CONFIG_SECRET` — vault key of at least 32 characters. This encrypts the saved RCON password. It is not the RCON password. When it is unset, the store reads `nexus-craft-rcon-secret` in the data directory. The module never logs the key or the password.
- `NEXUS_DATA_DIR` — directory that holds `nexus-craft.json`, `nexus-craft-rcon.json`, and, when the env key is unset, `nexus-craft-rcon-secret`. Sentinal uses the same files and the same encryption.
- `SENTINAL_CRAFT_SEED_JSON` — optional one-time seed. Base64 of `nexus-craft.json`. On boot, if that file is missing from the data directory, Sentinal writes it. An existing file is left untouched.
- `SENTINAL_CRAFT_SEED_RCON_JSON` — same, for base64 of `nexus-craft-rcon.json`.
- `SENTINAL_CRAFT_SEED_RCON_SECRET` — same, for the raw vault key written to `nexus-craft-rcon-secret`. This is not base64. It is not logged.

The seed runs only while `SENTINAL_CRAFT_MODULE=true`. It logs the file name and that seeding happened. It does not log the JSON or the secret. Remove all three variables after the next boot shows the files were written or were already present. Leaving them set keeps the secret in the service environment.
- `NEXUS_OWNER_USER_IDS`, `NEXUS_OPERATOR_ROLE_IDS`, `NEXUS_STAFF_ADMIN_ROLE_IDS` — same staff check Craft uses.
- `MC_POINTS_ENABLED`, `MC_PLAYTIME_NP_ENABLED`, `MC_PLAYTIME_DRY_RUN`, `MC_SHOP_ENABLED`, `MC_SHOP_DRY_RUN`, `MC_SHOP_DELIVERY_ENABLED`, `MC_STARTER_KIT_ENABLED` — same defaults as Craft. All default off except the two dry-run flags, which default on.
- `NEXUS_ECONOMY_URL` and `NEXUS_ECONOMY_CRAFT_TOKEN` — link, playtime, and delivery, same routes Craft calls. The craft token still cannot buy, quote, or refund.
- `NEXUS_ECONOMY_TOKEN` — already used by Sentinal. `/mc shop` and `/mc starter` call the shop through this token.

Do not set an RCON host, port, or password in Railway. `/mcrcon` ignores those variables.

`NEXUS_RESPECT_MANUAL_LAYOUT` is unchanged. The module does not create categories, create channels, move channels, or edit permission overwrites, including in guild `1016059608789434408`. Staff commands post or edit messages in channels that already exist.

## Stored data

| Data | Where | Cutover |
| --- | --- | --- |
| Realm listings, applications, board channel id, status panel | `nexus-craft.json` | Copy the file into Sentinal's data directory |
| Encrypted RCON records | `nexus-craft-rcon.json` | Copy the file with the JSON file |
| Vault key | `NEXUS_RCON_CONFIG_SECRET` or `nexus-craft-rcon-secret` | Set the same env value, or copy the secret file. Do not print it |
| Link, playtime, orders, kit claims | Economy Postgres tables `nexus_mc_links`, `nexus_mc_orders`, and the related `nexus_mc_*` tables | Already shared. No row copy and no new table |

Button and modal custom ids stay `craft:realm:*` and `craft:staff:*`. A message Craft posted still delivers its buttons to the Craft application. `/realm repost` sends a new message from Sentinal for each open listing, updates the stored message id, and sends a new private review to the Realm owner for each pending application. The status panel does the same adoption on its next refresh: the updater posts a Sentinal message and removes the previous bot's message when Discord allows the delete. Approve and Deny on a Craft DM stop working once that bot is offline; decide those applications before the stop, or use the new DM from `/realm repost`.

## Cutover

1. On the Craft volume, copy `nexus-craft.json` and `nexus-craft-rcon.json`. If `NEXUS_RCON_CONFIG_SECRET` is unset on Craft, copy `nexus-craft-rcon-secret` as well. Keep a second copy of the JSON until `/realm repost` has been checked.
2. Place those files in Sentinal's data directory (`NEXUS_DATA_DIR`, or the Railway volume path Sentinal already mounts). Railway volumes cannot be copied into each other. When the files cannot be mounted, base64-encode each JSON file and set `SENTINAL_CRAFT_SEED_JSON` and `SENTINAL_CRAFT_SEED_RCON_JSON`. Set `SENTINAL_CRAFT_SEED_RCON_SECRET` to the vault key when that file has to move too. Redeploy once. The log names each file it wrote and tells you to remove the seed variables. Remove them before the following deploy. Set `NEXUS_RCON_CONFIG_SECRET` to Craft's value when Craft uses that variable instead of the secret file.
3. Set `SENTINAL_CRAFT_MODULE=true` on Sentinal. Copy the category id, the optional Realms channel id, the `MC_*` flags, `NEXUS_ECONOMY_URL`, and `NEXUS_ECONOMY_CRAFT_TOKEN`. Leave RCON host, port, and password unset.
4. Redeploy Sentinal. On ready it re-registers `/craft`, `/mcrcon`, `/mc`, `/realm`, and `/mcadmin` when a Points flag is on.
5. In the Craft category, verify `/craft help`, `/mc status`, and a staff `/mcrcon status`. The status reply says the password is configured or missing. It does not print the password.
6. Staff run `/realm repost` in the Craft category. Confirm the new Apply button works, and that each pending application has a new owner DM from Sentinal. Delete any leftover Craft embed the bot could not remove.
7. Confirm the status panel's next refresh is a Sentinal message in the same channel.
8. Stop the `nexus-craft` service and remove that bot from the guild, or clear its slash commands, so members do not see two copies of `/mc`. Do this before the next playtime minute when playtime tracking is on. Two pollers can both post presence. Delivery claims use a Postgres row lock, so two workers will not hand out the same order, and Craft should still be stopped so only one worker is running.

To turn the module back off, set `SENTINAL_CRAFT_MODULE=false` and redeploy. Commands that were already registered stay on Sentinal's application and reply that the module is off. Start `nexus-craft` again from the pre-repost JSON copy if Sentinal's file was updated by `/realm repost`.

## Intentionally not moved

- Craft's own process, `NEXUS_CRAFT_TOKEN`, `/health`, and bot presence. Sentinal keeps its token, health server, and presence.
- Join-to-create. It was not part of Craft.
- A new Postgres table for listings or RCON. The volume files stay the store.
- Folding these commands into `/minecraft`. That command remains Sentinal's backend server tools.
- Reading an RCON password from Railway env.
- Creating or rearranging channels, including when `NEXUS_RESPECT_MANUAL_LAYOUT` is on for guild `1016059608789434408`.
- Rewriting Craft-authored messages on boot. Staff run `/realm repost` once. The status panel adopts itself on refresh.
