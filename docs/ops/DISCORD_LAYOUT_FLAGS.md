# Sentinal layout flags

Nexus Sentinal on `rebuild/nexus-0.1` can follow the Nov 9 player sidebar without recreating collapsed rooms or dragging join-to-create lobbies back under each game. Nothing in this path deletes a channel or posts to Discord. Game roles are not changed.

Set these on Railway service `nexus-sentinal-0-1-test`. A blank value uses the default in the last column.

| Variable | Purpose | Default |
|---|---|---|
| `NEXUS_RESPECT_MANUAL_LAYOUT` | Keep already-parented channels where they are (consoles and backups in Staff, builders that already have a parent). Limit non-slim games to their hub/console instead of recreating every layout room. | off |
| `NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS` | Guild ids that honor the flag. `1016059608789434408` is the main guild. | every guild when the flag is on |
| `NEXUS_SLIM_GAME_LAYOUT` | COD, DBD, Diablo IV, Destiny 2, and Warframe provision only `#*-hub` and `#*-lfg`. Division, Pokémon GO, and Palworld keep their full layouts. | `true` |
| `NEXUS_PLAYER_VOICE_CATEGORY_ID` | Category where a missing join-to-create builder is created. Existing builders are not moved. `1569266940508110928` is `🔊 VOICE`. | unset |
| `NEXUS_PIN_PLAYER_VOICE` | If Voice is no longer the category directly above Staff, slide it back there and leave every other category in its current order. Runs when this is on and either the voice id is set or manual layout is on for that guild. | `true` |
| `NEXUS_GAME_CATEGORY_ORDER` | Module ids, Minecraft first. `approved` uses the built-in list below. Unset keeps alphabetical order for any pass that still sorts games. | unset (alphabetical) |
| `NEXUS_ENFORCE_GAME_CATEGORY_ORDER` | Apply that game order, with Voice directly above Staff. Leave this off on the live guild so a deploy does not reshuffle categories. | `false` |

Built-in approved game order:

`minecraft,ark,palworld,pokemongo,division2,callofduty,deadbydaylight,diablo4,destiny2,warframe`

`INFORMATION` still matches Information / Start Here. `🌐 COMMUNITY HQ` stays a Nexus HQ alias and is not renamed back to `🌐 NEXUS HQ`.

Manual layout on the main guild does not block the slim hub + lfg pair. It still refuses to recreate Division, Pokémon GO, Palworld, Minecraft, and ARK rooms that are outside that pair, and it does not pull `#minecraft-console`, `#minecraft-backups`, `#ark-console`, `#palworld-console`, or `#palworld-backups` out of Staff.

Join-to-create rooms are created in the builder channel's parent. A builder that already lives in Voice stays there, including Diablo IV on the 10-minute auto-provision pass. Staff voice channels stay in Staff. ARK, Warframe, and Diablo temporary rooms are still opened by their game bots, which follow the same parent.

## Collapse dry-run

The command lists extra text channels for the five slim games. It does not delete them.

```bash
node scripts/discord-layout-collapse-dry-run.cjs
node scripts/discord-layout-collapse-dry-run.cjs --inventory path/to/channels.json
```

In Discord, `/nexus collapse-dry-run` replies ephemerally with the same review for the current guild. There is no `--apply` or `--delete` flag.

Layout names the dry-run treats as removal candidates:

- Call of Duty: `#cod-news`, `#cod-warzone`, `#cod-multiplayer`, `#cod-zombies`, `#cod-loadouts`
- Dead by Daylight: `#dbd-killers`, `#dbd-survivors`, `#dbd-builds`, `#dbd-stats`
- Diablo IV: `#diablo-news`, `#diablo-builds`, `#diablo-items`, `#diablo-paragon`, `#diablo-farming`
- Destiny 2: `#destiny-builds`, `#destiny-activities`, `#destiny-vendors`
- Warframe: `#warframe-world-state`, `#warframe-builds`, `#warframe-market`

Kept for those games: the hub, the lfg channel, and the join-to-create lobby. COD and DBD are also on the no-provision list, so setup and repair will not recreate their categories.
