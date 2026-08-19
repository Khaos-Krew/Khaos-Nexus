# Discord Shop rank sync

Nexus Sentinel uses Discord Server Shop Premium Roles as the source of truth. Discord grants the purchased role immediately; Sentinel arranges those roles and maintains cumulative channel access. No Discord IDs or Premium App SKUs are required.

## Required names

The Server Shop Premium Roles must use these names (capitalization and punctuation do not matter):

1. Cipher Runner
2. Nexus Raider
3. Khaos Warden
4. Blackout Legend

Channel access is cumulative without duplicating member roles. Blackout Legend can see all four channel tiers; Khaos Warden can see Cipher, Raider, and Warden; and so on.

During setup, Sentinel also moves the four shop roles directly below `Origin Founder`, ordered from highest to lowest as Blackout Legend, Khaos Warden, Nexus Raider, and Cipher Runner.

## Discord permissions

Nexus Sentinel needs `Manage Roles`, `Manage Channels`, `View Channels`, and `Send Messages`. Its highest bot role must be above `Origin Founder` so it can arrange the shop roles beneath it.

## Setup

1. Deploy or restart the Railway Nexus Sentinel service.
2. In Discord, run `/ranks setup` as a server manager.
3. Sentinel finds or creates `SUPPORTER HUB` and creates two locked text channels for each rank inside it.
4. Review the private setup response. It reports missing products, roles, permissions, or role-order problems without making unsafe guesses.

Use `/ranks status` to validate the setup and `/ranks sync` to repair role order and channel permissions. Sentinel also performs a full repair pass every 15 minutes by default.

Set `SHOP_RANK_SYNC_SECONDS` in Railway to change the repair interval. Set it to `0` to disable only the scheduled repair; entitlement event handling remains active.
