# Cephalon Nexus and Nexus Ascended

Both bots are already in the Discord guild. This slice moves live slash commands off Nexus Sentinal. It does not add Vanguard or Nephalem.

| Discord app | Railway service | Dockerfile | Start command | Game role |
|-------------|-----------------|------------|---------------|-----------|
| Cephalon Nexus | `cephalon-nexus` | `Dockerfile.cephalon` | `node src/railway/cephalon-service.cjs` | `warframe` |
| Nexus Ascended | `nexus-ascended` | `Dockerfile.ascended` | `node src/railway/ascended-service.cjs` | `ark_asa` |

Sentinal stays on `Dockerfile.sentinal` and `src/railway/sentinal-service.cjs`. Do not point Sentinal at either game Dockerfile.

## Railway settings

For each game service:

- Root directory: repository root (`/`)
- Builder: Dockerfile
- Dockerfile path: the path in the table above
- Start command: empty, so the image `CMD` is used, or the start command in the table
- Leave existing Discord variables in place: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`, `NEXUS_GAME_ROLE`
- `READY` is logged and ignored. `false` does not stop the process or the moved commands

Local equivalents: `npm run cephalon` and `npm run ascended`.

## Commands moved to Nexus Ascended

`/ark`, `/ark-health`, `/arkcluster`, `/arkconfig`, `/arkdb`, `/arkevent`, `/arkprofile`, `/arkshopadmin`, `/arkserver`, `/arkrcon`, `/arn`, `/cacheadmin`, `/cachetoken`

`/ark` here is the ARK ops command. Sentinal retires its copy on startup so the guild does not keep two handlers.

RCON host, port, and password are not Railway variables on Ascended. Leave `NEXUS_RCON_RAILWAY_ENV_FORBIDDEN=true` and `NEXUS_RCON_SOURCE=discord_override_store`. Owners set the connection with `/arkrcon configure` and `/arkrcon password`. The encrypted override file lives under `NEXUS_DATA_DIR` (image default `/app/data`). Attach a Railway volume at `/app/data` if those overrides must survive a redeploy. Existing overrides on the Sentinal disk do not move with this deploy; enter them again on Ascended.

## Commands moved to Cephalon Nexus

`/market`, `/warframe`

Cephalon starts the existing Nexus backend in the same container and calls the current Warframe provider. No new market API was added.

## Left on Nexus Sentinal

Hub and other-game commands stay, including `/nexus`, `/bal`, `/walletadjust`, `/o9verify`, `/clear`, `/report`, `/protocol`, `/darkzone`, and the non-ARK non-Warframe friendly commands (`/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/division2`, `/rust`, `/satisfactory`, `/idleon`, `/pogo`, `/osrs`, `/rs3`).

Also left, for an owner decision rather than a guessed move:

- `/nexus run` can still target a Warframe or ARK backend action. It is the shared advanced tool, not a game-specific command.
- Cluster Shop panel buttons spend Nexus economy and stay on Sentinal.
- ARN intake channel automation stays on Sentinal. It is not a slash command.
- ARK staff panels, health monitors, config HTTP hooks, identity webhooks, and one-shot ArkShop launch runtimes stay on Sentinal. They are not the moved slash commands, and their existing service credentials stay there.
- The friendly `/ark tame` calculator is not registered. ARK ops owns `/ark`, so that tame subcommand was already unregistered.

## Smoke checks

1. Deploy `cephalon-nexus` from `Dockerfile.cephalon` and `nexus-ascended` from `Dockerfile.ascended`.
2. `GET /health` returns `discordReady: true` after each bot logs in.
3. In Discord, `/warframe news` and `/market` reply from Cephalon Nexus.
4. `/ark` and `/arkrcon` reply from Nexus Ascended.
5. Sentinal no longer offers `/market`, `/warframe`, or `/ark`.
