# Stage 1 game-bot ops spine

Cephalon Nexus (Warframe) and Nexus Ascended (ARK ASA) only run slash commands and component interactions inside their owner Discord categories. Nexus Sentinal is not category-locked and still owns wallet, verify, and ranks.

## Category gate

| Bot | Railway service | Env var | Owner category id |
|-----|-----------------|---------|-------------------|
| Nexus Ascended | `nexus-ascended` | `ASCENDED_DISCORD_CATEGORY_ID` | `1516602943670059108` |
| Cephalon Nexus | `cephalon-nexus` | `CEPHALON_DISCORD_CATEGORY_ID` | `1516640233389822042` |

The image Dockerfiles set those ids. An unset or blank variable uses the same owner id. A non-empty value that is not a Discord snowflake fail-closes the gate: every interaction is denied and the command does not run.

Join-to-create voice lobbies are owned by the game bot for that category, not by Nexus Sentinal. See `docs/ops/JOIN_TO_CREATE.md` for the lobby env vars and the Discord permissions (Manage Channels, Connect, and Move Members).

Threads are allowed when the parent channel’s category matches. DMs and other categories get an ephemeral redirect:

- Ascended: `Use this bot in the ARK Ascended category.`
- Cephalon: `Use this bot in the Warframe category.`

## Railway variables

Set on `cephalon-nexus`:

- `CEPHALON_DISCORD_CATEGORY_ID=1516640233389822042` (already baked into `Dockerfile.cephalon`)
- `NEXUS_STAFF_ALERT_CHANNEL_ID` optional staff text channel for command-failure alerts

Set on `nexus-ascended`:

- `ASCENDED_DISCORD_CATEGORY_ID=1516602943670059108` (already baked into `Dockerfile.ascended`)
- `ARKSHOP_DB_MODE=disabled` so the retired ArkShop MySQL bridge stays off
- `NEXUS_STAFF_ALERT_CHANNEL_ID` optional, same meaning as Cephalon

Do not set ARK RCON host, port, or password on `nexus-ascended`. RCON stays in the Discord `/arkrcon` override store (`NEXUS_RCON_RAILWAY_ENV_FORBIDDEN=true`, `NEXUS_RCON_SOURCE=discord_override_store`).

If `NEXUS_STAFF_ALERT_CHANNEL_ID` is unset, an alert falls back to a cached staff channel named `staff-ops`, `staff-hub`, `ark-ops`, `server-ops`, or `ark-server-status`. If none of those exist, the alert is logged without the error text.

## Commands

Both bots register `/nexushelp` and staff-only `/status` for that bot only.

`/nexushelp` lists that bot’s live commands and points wallet (`/bal`), verify (`/o9verify`), and ranks at Nexus Sentinal.

`/status` is ephemeral and staff-only (owner ids, operator roles, or Discord Administrator). It reports Discord ready, a short deploy SHA when `RAILWAY_GIT_COMMIT_SHA` is a hex commit, and:

- Cephalon: one on-demand Warframe backend health probe. No scheduler.
- Ascended: ArkShop MySQL retired / `ARKSHOP_DB_MODE=disabled` when that switch is on, plus RCON override presence (configured or missing) without host, port, or password. The self-check summary is `RCON health: no self-check recorded yet.` until the Ascended health loop records a public row. See `docs/ops/STAGES_2-4_GAME_BOTS.md`.

Cephalon commands and the Ascended slash-command handlers report player-facing failures with a generic ephemeral message. The staff alert contains the bot, command name, user id, and error class only. ARN and the Dino Cache Hub were not changed in this stage.

## Owner smoke

1. Deploy `cephalon-nexus` from `Dockerfile.cephalon` and `nexus-ascended` from `Dockerfile.ascended`.
2. Confirm `nexus-ascended` has no `ARK_*_HOST`, `ARK_*_RCON_PORT`, or `ARK_*_RCON_PASSWORD` variables.
3. In a channel under category `1516602943670059108`, Nexus Ascended `/nexushelp` lists the ARK commands and mentions Nexus Sentinal. `/ark` still runs.
4. In a thread under that same category, an Ascended command still runs.
5. In another category, and in a DM, an Ascended command replies with the ARK Ascended redirect and does not run.
6. Repeat for Cephalon Nexus under category `1516640233389822042` with `/warframe` or `/market`, including a thread and a wrong category.
7. As staff, `/status` in each game category is ephemeral. Ascended shows ArkShop MySQL retired and does not show an RCON password. Cephalon shows Discord ready.
8. Outside those categories, Nexus Sentinal `/bal` (or `/nexushelp` is not required on Sentinal) still works. Sentinal hub commands are not category-locked.
