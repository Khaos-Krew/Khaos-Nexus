# Discord Automation Center

Khaos Nexus v0.12 adds a local-first Discord Automation workspace for self-service role menus, exclusive color roles, additive category/channel layouts, and structured audit history.

## Required bot permissions

The Khaos Nexus Discord bot needs these server permissions for the full workspace:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles
- Manage Channels

The bot's highest Discord role must remain above every role that members can select from a role or color menu. Khaos Nexus validates the hierarchy before publishing and blocks integration-managed or inaccessible roles.

## Role and color menus

1. Open **Discord Automation**.
2. Select **Load Discord Resources**.
3. Create a menu or choose an existing menu.
4. Select a text or announcement channel.
5. Add role options and choose the matching Discord roles.
6. Save the menu.
7. Select **Publish / Update**.

Normal role menus can toggle roles independently or enforce one option at a time. Color menus are always exclusive so selecting a new color removes other colors from the same menu.

Published buttons are handled by the supervised Discord bot. Configuration changes are pushed to the running bot without exposing the token or requiring a complete desktop restart.

## Additive server layout

The Server Layout tab creates missing categories and channels only. It does not delete, rename, reorder, or move existing Discord content.

1. Load Discord resources.
2. Edit or duplicate a layout blueprint.
3. Select **Preview Changes**.
4. Review the create and unchanged counts.
5. An Owner can select **Apply Missing Items**.

The built-in Khaos Nexus layout includes information, community, game-server status, support, and voice spaces. Duplicate it before making major changes.

## Audit history

Khaos Nexus records structured Discord Automation events locally with:

- actor name, Discord ID when available, and desktop role
- action and outcome
- target type and name
- timestamp and safe summary

Owners can optionally publish audit entries to a private Discord text channel. Generated audit messages disable mentions. The local history can retain 100, 250, 500, or 1,000 entries and can be exported as JSON.

## Safety boundaries

- Role hierarchy is checked before publication.
- Layout synchronization is additive and has no delete operation.
- Role buttons never expose protected credentials.
- Discord messages disable generated mentions.
- Operators can build and publish menus; applying a server layout requires Owner access.
- Audit settings and history clearing require Owner access.
