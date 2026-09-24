# Cephalon clan, profile, and circuit

These three commands run on Cephalon Nexus, inside the Warframe category `1516640233389822042`. They do not change Nexus Sentinal panels or the Sentinal Warframe module.

## Clan applications

On startup Cephalon posts or edits one panel in `#warframe-clan-applications`. Staff refresh that same message with `/clan panel`. The applications channel has to sit in the Warframe category, or the buttons are refused the same way as other Cephalon commands. The message id is `cephalon-clan-panel.json` under `NEXUS_DATA_DIR` (or `RAILWAY_VOLUME_MOUNT_PATH` when `NEXUS_DATA_DIR` is unset).

| Variable | Default when unset |
|----------|--------------------|
| `CEPHALON_CLAN_APPLICATIONS_CHANNEL_ID` | `1552750453287161947` |
| `CEPHALON_CLAN_MEMBER_ROLE_ID` | `1552750297732874332` |
| `CEPHALON_CLAN_OFFICER_ROLE_ID` | `1552750301625188384` |

A blank value keeps the default. A value that is not a Discord snowflake turns that id off.

**Apply** opens a form. Discord allows five inputs, so platform and mastery rank share one box (`PC 18`). The other boxes are alias, availability, prior clan, and why they want to join. The bot posts the application in the applications channel and pings the Warframe Clan Officer role.

An officer presses **Approve** or **Reject** on that message. Approve adds the Warframe Clan Member role, edits the embed to Approved, and disables both buttons. Reject edits the embed to Rejected and disables both buttons. Anyone without the officer role is told they cannot decide, and the role is not changed.

Cephalon Nexus needs Manage Roles, and its role must sit above Warframe Clan Member. The guild is `1016059608789434408`.

## Profile and circuit

`/profile` reads `https://api.warframestat.us/profile/{username}`. The reply shows display name, mastery rank when the payload includes it, and `guildName` / `guildId` when those are present. A missing profile or an API outage is a short ephemeral reply. There is no Digital Extremes login.

`/circuit` reads `duviriCycle`, `steelPath`, and `deepArchimedea` from `https://api.warframestat.us/pc`. The reply shows the Duviri state and choices, the current Steel Path reward, and a short Archimedea summary. A section that fails shows as unavailable. This command does not post a durable panel.

## Railway `cephalon-nexus`

No new variables are required. Set the three clan ids above only to override the defaults. Keep `NEXUS_DATA_DIR` on the volume so the panel message id survives a redeploy.
