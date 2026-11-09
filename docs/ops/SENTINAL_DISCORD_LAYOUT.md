# Sentinal Discord layout flags

These flags are off unless set. A deploy with none of them keeps today's provisioning: full game layouts, alphabetical game categories, and the existing About / patch-notes maintenance. Set them on `nexus-sentinal-0-1-test` for guild `1016059608789434408`. `NEXUS_LAYOUT_GUILD_IDS` limits every new flag below when that flag does not have its own guild list. `NEXUS_RESPECT_MANUAL_LAYOUT` keeps its own guild list.

Nothing here deletes a channel, posts an announcement, or edits a game role. Hidden channels stay hidden. Sentinal will not clear a hand-applied ViewChannel deny on `#cobblemon`, `#about`, or `#patch-notes`, and it will not post into them while that deny is in place.

## Environment

| Variable | Value on the test service | Effect |
| --- | --- | --- |
| `NEXUS_RESPECT_MANUAL_LAYOUT` | `true` (already set) | Do not recreate unmanaged extra rooms. Do not force A–Z game order. Keep `🌐 COMMUNITY HQ` as an HQ alias instead of renaming it back to `🌐 NEXUS HQ`. Leave player voice channels that already sit in `🔊 VOICE` there, including Nexus Lounge and AFK. If VOICE is not directly above STAFF, the next cycle moves only that category back above STAFF and lists every category in the position update so one cannot be dropped at the top. |
| `NEXUS_RESPECT_MANUAL_LAYOUT_GUILD_IDS` | `1016059608789434408` | Limits the row above to the main guild. |
| `NEXUS_LAYOUT_GUILD_IDS` | `1016059608789434408` | Limits the new flags to the main guild. |
| `NEXUS_SLIM_GAME_LAYOUT` | `true` | For Call of Duty, Dead by Daylight, Diablo IV, Destiny 2, and Warframe, `/nexus setup`, `/nexus repair`, repair-all, and auto-provision ensure the hub and `lfg` text channels only. Builds, farming, loadouts, and the other extra rooms are not recreated. Division, Pokémon GO, and Palworld keep full layouts. |
| `NEXUS_PLAYER_VOICE_CATEGORY` | `true` | Join-to-create builders are created in the player Voice category. An existing builder that is still under its game category is moved there once, without syncing permissions. Builders already in VOICE stay. Builders in STAFF stay. Temporary rooms open under the builder's current parent. Staff voice stays in STAFF. |
| `NEXUS_PLAYER_VOICE_CATEGORY_ID` | `1569266940508110928` | The live `🔊 VOICE` category. Name `voice` is the fallback. |
| `NEXUS_GAME_CATEGORY_ORDER` | `minecraft-first` | Minecraft is the first game category. Every other game category stays alphabetical. VOICE is placed directly above STAFF. This applies even while manual layout is on. Structural categories are not reshuffled. |
| `NEXUS_FOLD_START_HERE` | `true` | `#about` and `#patch-notes` are folded into `#start-here` (`1569266931054284841`). Sentinal does not recreate them, move them back to INFORMATION, edit them, or post the About panel or roadmap notes. `📌 INFORMATION` still matches the Start Here alias. `🌐 COMMUNITY HQ` still matches the HQ alias. |
| `NEXUS_ARK_MODULE_RETIRED` | `true` | ARK servers are offline. Setup, repair, repair-all, admin reconcile, and auto-provision do not create or edit the ARK category, its text channels, or the ARK join-to-create lobby. The ARK role is not deleted or edited. The ARK schedule feed, the ARK cluster board, and ARK mod-update alert delivery stop. `#cobblemon` is not an ARK channel; access repair skips it, `#about`, and `#patch-notes` so a Minecraft or INFORMATION pass cannot clear their hides. |

`#minecraft-console`, `#minecraft-backups`, `#ark-console`, `#palworld-console`, and `#palworld-backups` are left in STAFF. Repair does not move a layout channel that already has a parent.

## Dry run before any delete

```bash
npm run layout:collapse-dry-run
npm run layout:collapse-dry-run -- --json
npm run layout:collapse-dry-run -- --inventory path/to/channels.json
```

The command prints layout names only. It does not call Discord, delete channels, post, or change roles. An inventory file is a channel array, or `{ "channels": [ ... ] }`, with `name`, `id`, and `parent_id` / `parentId`. Matching names are annotated. Channels that are not in the inventory are still listed, because the operator deletes by hand.

Slim removals, by layout name:

| Module | Keep | Would remove |
| --- | --- | --- |
| `callofduty` | `cod-hub`, `cod-lfg` | `cod-news`, `cod-warzone`, `cod-multiplayer`, `cod-zombies`, `cod-loadouts` |
| `deadbydaylight` | `dbd-hub`, `dbd-lfg` | `dbd-killers`, `dbd-survivors`, `dbd-builds`, `dbd-stats` |
| `diablo4` | `diablo-hub`, `diablo-lfg` | `diablo-news`, `diablo-builds`, `diablo-items`, `diablo-paragon`, `diablo-farming` |
| `destiny2` | `destiny-hub`, `destiny-lfg` | `destiny-builds`, `destiny-activities`, `destiny-vendors` |
| `warframe` | `warframe-hub`, `warframe-lfg` | `warframe-world-state`, `warframe-builds`, `warframe-market` |

Join-to-create lobby names are not in the removal list. Division, Pokémon GO, and Palworld are not in it. The ARK category is hidden, not deleted, and is not in this list. `#cobblemon`, `#about`, and `#patch-notes` are hidden, not deleted.
