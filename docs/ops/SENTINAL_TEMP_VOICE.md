# Sentinal temporary voice rooms

Nexus Sentinal can open player voice rooms from one lobby, `➕ Create a Voice Chat`. The feature is off unless `SENTINAL_TEMP_VOICE=true`, so a deploy that does not set the variable does not create the lobby, register `/vc`, or request the Presence intent.

This is not the per-game join-to-create used by Cephalon, Ascended, Sanctuary, or Vanguard. Those bots still own their own lobbies. Sentinal does not delete the existing `➕ Join to Create …` game rooms, Nexus Lounge, AFK, event-night, or staff voice. Ops remove the old game rooms after the new lobby is tested.

## Environment

| Variable | Default | Effect |
| --- | --- | --- |
| `SENTINAL_TEMP_VOICE` | off | Master switch. `true` creates or adopts the lobby, listens for joins, registers `/vc`, and deletes empty rooms Sentinal created. |
| `SENTINAL_TEMP_VOICE_LOBBY_ID` | unset | Voice channel id of the lobby. Unset means Sentinal creates `➕ Create a Voice Chat` in the Voice category, visible to `@everyone`. A non-snowflake value turns the feature off. A protected channel (Nexus Lounge, AFK, event-night, staff voice, or a game-bot lobby) is refused. |
| `SENTINAL_TEMP_VOICE_CATEGORY_ID` | `1569266940508110928` when the feature is on | Player Voice category in guild `1016059608789434408`. A non-snowflake value turns the feature off. When the default id is missing, Sentinal looks for a category named Voice. |
| `SENTINAL_TEMP_VOICE_PRESENCE` | off | With the master switch on, requests the privileged Guild Presences intent and names a room from the member's Playing activity. |
| `SENTINAL_TEMP_VOICE_EMPTY_GRACE_MS` | `45000` | How long an empty room stays before deletion. Clamped to 30–60 seconds. |
| `SENTINAL_TEMP_VOICE_MAX_ROOMS` | `25` | Cap on open rooms. Clamped to 50. |
| `NEXUS_DISCORD_GUILD_ID` | required | Guild the feature listens to. Sentinal already requires this. |
| `NEXUS_DATA_DIR` | runtime data dir | Stores `sentinal-temp-voice.json`. The file is the list of rooms Sentinal may delete. |

Guild id `1016059608789434408` is the live Nexus guild. Category `1569266940508110928` is `🔊 VOICE`.

## Presence intent

Sentinal's base client asks for Guilds and Guild Voice States. Guild Members and Guild Messages are added by other Sentinal extensions. **Guild Presences is not requested unless both `SENTINAL_TEMP_VOICE=true` and `SENTINAL_TEMP_VOICE_PRESENCE=true`.**

The Discord Developer Portal Presence Intent must be enabled on the Sentinal application before that pair is set. If the portal toggle is off, Discord rejects login. Leave `SENTINAL_TEMP_VOICE_PRESENCE` unset to keep the current login behavior. Rooms are then named `<display name>'s Chat`.

When presence is available and the member's activity type is Playing, the room is `<display name>'s <Game>`. If presence is missing, throws, or is not a game, the name is `<display name>'s Chat`. Names go through the player-card profanity denylist. A blocked display name becomes `Player`. A blocked game becomes `Chat`. The name is cut at 100 characters.

If the owner is alone and their game changes, Sentinal renames the room once. Discord allows about two renames per channel every 10 minutes, so a rename that would exceed that wait is skipped. `/vc rename` also counts toward that limit and stops the automatic rename.

## Behavior

Joining the lobby creates a voice channel in the lobby's category, moves the member into it, and grants that member Manage Channels, Move Members, Mute Members, and Deafen Members on the room. Joining the lobby again returns them to their open room.

`/vc` is available to everyone so a room owner without a staff role can use it. The command only runs while the member is inside a Sentinal temporary room.

| Subcommand | Who | Effect |
| --- | --- | --- |
| `/vc rename name:<name>` | Owner or staff | Renames the room. Reserved names and blocked language are rejected. |
| `/vc limit n:<0-99>` | Owner or staff | Sets the user limit. `0` clears it. |
| `/vc lock` | Owner or staff | Stops new joins. People already inside stay. The owner can still connect. |
| `/vc unlock` | Owner or staff | Allows joins again. |
| `/vc claim` | Someone in the room | Transfers ownership after the owner has left. |

An empty room is deleted after the grace period. On startup, Sentinal deletes empty rooms listed in `sentinal-temp-voice.json` when they are still voice channels in a non-staff category. It does not delete a channel that is missing from that file. It also does not delete Nexus Lounge, AFK, `event-night`, staff voice, the open lobby, a game-bot lobby id, or any `➕ Join to Create …` channel, even if that id is in the file.

Layout repair (`NEXUS_RESPECT_MANUAL_LAYOUT`, Nexus HQ locking, and module access reconciliation) skips channels Sentinal marked as temporary voice. It does not re-lock the lobby or the rooms.

## Manual test

1. Leave `SENTINAL_TEMP_VOICE` unset, restart Sentinal, and confirm there is no new lobby and `/vc` is not registered.
2. Enable the Presence Intent on the Sentinal application in the Developer Portal.
3. Set `SENTINAL_TEMP_VOICE=true` and `SENTINAL_TEMP_VOICE_PRESENCE=true`. Set `SENTINAL_TEMP_VOICE_CATEGORY_ID=1569266940508110928` if the default should not be used. Restart.
4. Confirm the log says the Guild Presences intent **is** requested, and that `➕ Create a Voice Chat` exists once in `🔊 VOICE` and is visible to `@everyone`.
5. Join the lobby with a game showing as Playing. Sentinal should move you into `<name>'s <Game>` and you should be able to rename it from Discord's channel settings.
6. Join with no game, or with presence turned off, and confirm the room is `<name>'s Chat`.
7. From inside the room, run `/vc rename`, `/vc limit`, `/vc lock`, `/vc unlock`. A second member should be rejected by lock and should not be able to rename.
8. Leave so someone else is last, and have them run `/vc claim`.
9. Empty the room and wait about 45 seconds. The room should disappear. Nexus Lounge, AFK, event-night, staff voice, and the old Join to Create rooms should still be there.
10. Restart Sentinal with an empty room still up (leave during the grace window). Startup should remove that empty room and leave occupied rooms and the lobby in place.
