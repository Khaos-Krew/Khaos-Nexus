# Sentinal role order

Nexus Sentinal keeps the Discord role list in four movable bands. It only changes role positions. It does not create or delete roles, and it does not change names, colors, or permissions.

## Ladder (top to bottom)

1. Protected roles stay where they are: `@everyone`, any role at or above Sentinal's highest role, and human staff roles. A human staff role has Administrator, Manage Guild, Manage Roles, Kick Members, Ban Members, or Timeout Members, and is not a bot integration role (`role.tags.botId`).
2. Sentinal's own highest role. This is the ceiling. Sentinal cannot move it.
3. Colors: selectable name-color roles (`Color: …` and the color self-role menus).
4. Staff bots: integration roles for other bots (Cephalon Nexus, Nexus Ascended, Sanctuary Nexus, and the rest). Sentinal's own role is not in this band.
5. Game: module access roles, game self-role menu roles, Warframe Clan Officer, and Warframe Clan Member. Officer stays above Member.
6. Everything else movable: ranks, supporters, platforms, notifications, pronouns, and the rest.

Inside a band, the current relative order is kept. Human staff roles that already sit below Sentinal stay above the color band. If a protected role is pinned in the middle, Sentinal fills the free slots around it. If that cannot be done without moving a protected role, the pass skips and logs a warning.

## Discord setup (owner, once)

Sentinal needs the **Manage Roles** permission.

Drag Sentinal's highest role to the top of every role it should be allowed to move, directly under the human admin and moderator roles. Sentinal cannot move a role that is above its own highest role. Human staff roles that should stay above name colors must sit in that protected block too, with no movable roles between them and Sentinal. Bot integration roles (Cephalon, Ascended, Sanctuary, other bots) should be below Sentinal so they can be placed in the staff-bot band. Discord marks those bot roles as not editable because their names and permissions are locked; Sentinal can still change their position.

## When it runs

- After startup role-menu and self-role reconcile.
- About 30 seconds after a role is created or updated.
- Every 6 hours.
- `/roleorder preview` (ephemeral) and `/roleorder apply` for Nexus staff.

Passes never overlap. If the list is already in order, Sentinal does not call the position API.

Each pass logs one line: `moved=N bands={colors,staffBots,game,rest} warnings=...`

While this reconciler is enabled, the older name-color position step does not move roles.

## Environment

All of these are optional. Role ids are comma-separated snowflakes. No new variable is required.

| Variable | Effect |
| --- | --- |
| `SENTINAL_ROLE_ORDER_ENABLED` | Kill switch. Default `true`. Set `false` to skip every pass. |
| `SENTINAL_ROLE_ORDER_COLOR_IDS` | Force these roles into the color band. |
| `SENTINAL_ROLE_ORDER_STAFF_BOT_IDS` | Force these roles into the staff-bot band. |
| `SENTINAL_ROLE_ORDER_GAME_IDS` | Force these roles into the game band. |
| `SENTINAL_ROLE_ORDER_PROTECTED_IDS` | Never move these roles. |

Protected human staff roles stay put even if an id list also names them.
