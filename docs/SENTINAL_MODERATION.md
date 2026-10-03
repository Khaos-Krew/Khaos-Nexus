# Nexus Sentinal moderation commands

## Staff role gates

Staff commands no longer depend on the Discord `Administrator` permission alone.
Two optional environment variables name the staff roles explicitly. The shared
helper is `src/sentinel/staff-roles.cjs` (`isStaffAdmin`, `isStaffModOrAbove`,
`hasStaffAdminRole`).

| Variable | Meaning |
| --- | --- |
| `NEXUS_STAFF_ADMIN_ROLE_IDS` | Comma-separated Discord role IDs for staff admins (for example the `⚔️ Admin` role). Staff admins also count as mods. |
| `NEXUS_STAFF_MOD_ROLE_IDS` | Comma-separated Discord role IDs for staff mods. Parsed for later commands. This change grants mods no command, including `/clear`. |

Rules:

- Discord `Administrator` still passes every check. Roles that keep Administrator (for example Community Manager) are unaffected.
- The guild owner passes `isStaffAdmin` / `isStaffModOrAbove`.
- Empty or unset variables fail closed. No role grants access and behavior is exactly the pre-existing Administrator / owner / allow-list behavior.
- Values that are not 17–20 digit snowflakes are ignored.
- The guild id (`@everyone`) and managed bot roles never grant access, even when their ids are listed. Each ignored id is logged once.
- Set the variables on every service that runs these gates: Sentinal, and the game bots that use the shared ops `isStaff` (Cephalon, Ascended, Sanctuary, Craft, Vanguard).

Sites that accept the staff admin role in addition to their existing paths:
`/o9verify`, `/card admin` (`isCardAdmin`), ARK RCON config (`/arkrcon`),
ARK server controls (`/arkserver`), ARK ops `isStaff` (and the ARK cluster,
config, profile, events, update-safety, ARN cache, and protocol commands that
reuse it), `/forgeops`, game-bot ops `isStaff` (`/status` and the commands that
reuse it), and Sentinal privileged mention commands.

## `/clear amount:<1-100>`

Staff channel cleanup command for staff admins only. A staff mod role does not grant it, even with Manage Messages.

- Operates only in the channel where the slash command is run.
- Registered with `default_member_permissions = ManageGuild`, so Discord shows it to members who can manage the guild rather than every member who can manage messages.
- Runtime check: the member must be a staff admin (staff admin role, guild owner, or Discord `Administrator`) **and** hold `Manage Messages` in Discord. Discord `Administrator` counts as Manage Messages. `isStaffModOrAbove` is not used here. The guild id and managed roles are ignored by the shared `roleIdsOf` helper, not by a `/clear`-only filter.
- Denial: `Only Admins can use /clear. Ask an Admin if something needs cleaning up.`
- `amount` is required and accepts 1 through 100.
- Uses Discord bulk deletion with old-message filtering enabled.
- Discord bulk deletion cannot remove messages older than 14 days; Sentinal reports how many requested messages were left untouched.
- The completion/error response is ephemeral.
- No game-module capability or raw console path is involved.

## `/o9verify`

Admin-only membership verification. Never open to mods.

- Registered with `default_member_permissions = ManageGuild`. `Administrator` would hide the command from the staff admin role once that role loses Administrator. `ManageGuild` is an admin-tier permission mods do not normally hold, so it keeps the command out of the mod UI.
- Runtime check (authoritative): staff admin role, guild owner, or Discord `Administrator`. Staff mod roles are rejected even if a Discord integration override shows them the command.
