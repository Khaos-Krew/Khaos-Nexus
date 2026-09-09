# ARK Rebuild Checklist

Use this checklist when rebuilding Sentinel's ARK support and when the required ARK plugins are available again.

## Current scope

- [ ] Work on **Gen1 / Map1 only** until it is stable.
- [ ] Leave Map2 untouched/deferred until Gen1 passes the full validation gate.
- [ ] Treat the **live Citadel server files** as authoritative for rates and settings.
- [ ] Treat Git ARK INI/rate files as reference snapshots/templates only.
- [ ] Treat the live Citadel configuration as authoritative for installed/enabled mod IDs.
- [ ] Resolve mod names and update metadata from CurseForge using those live mod IDs.

## Before plugin installation

- [ ] Save the Gen1 ARK world.
- [ ] Back up live `Game.ini` and `GameUserSettings.ini` from Citadel.
- [ ] Record the Gen1 map name, ports, FTP/SFTP root, and RCON endpoint in protected runtime configuration.
- [ ] Preserve a sanitized reference snapshot of the current known-good player rates/stats profile.
- [ ] Export or back up ArkShop database/configuration before plugin changes.
- [ ] Confirm Nexus ARK worker and Sentinel health before touching the game server.

## Gen1 live-state read path

- [ ] Read `GameUserSettings.ini` from the live Citadel Gen1 server.
- [ ] Read `Game.ini` from the live Citadel Gen1 server.
- [ ] Parse rates/settings from the live files without merging Git defaults over them.
- [ ] Read the actually enabled mod IDs from Gen1's live launch/config source.
- [ ] Resolve each live mod ID through CurseForge to obtain canonical mod name and current file/update metadata.
- [ ] Display unknown/unresolved mod IDs without inventing names.
- [ ] Cache CurseForge metadata only as a cache; refresh it from the API when appropriate.
- [ ] Report Git-vs-live differences without auto-correcting the server.

## Minimum plugin-first validation

Install and validate one dependency at a time. Do not install the full desired stack at once.

For each plugin:
- [ ] Server boots normally.
- [ ] Plugin loads without startup errors.
- [ ] Plugin commands work locally/admin-side.
- [ ] Nexus read-only probe can identify the plugin/version.
- [ ] Restart persistence works.
- [ ] No unexpected schema/config mutation occurs.

## Nexus connection validation

- [ ] RCON read command succeeds.
- [ ] RCON controlled broadcast succeeds.
- [ ] FTP/SFTP read succeeds against Citadel.
- [ ] Controlled config write succeeds only after a backup and only on an approved non-critical test file.
- [ ] Post-write readback verifies the actual Citadel file contents.
- [ ] Server save command succeeds.
- [ ] Restart warning path succeeds without restarting.

## ArkShop / economy

- [ ] Confirm the authoritative ArkShop database mode.
- [ ] Confirm tables/schema before writes.
- [ ] Verify account/player linking.
- [ ] Test balance read.
- [ ] Test a tiny controlled token adjustment.
- [ ] Test one resource purchase.
- [ ] Test one item purchase.
- [ ] Test one dino/kit delivery path.
- [ ] Verify transaction/audit logging.
- [ ] Verify offline token accrual strategy separately from plugin delivery.

## Ranks and kits

- [ ] Validate rank/group creation.
- [ ] Validate Discord-to-ARK rank sync.
- [ ] Validate starter kit delivery.
- [ ] Validate any unbreakable-item implementation only after the relevant item/plugin APIs are confirmed.
- [ ] Validate Upgrade Station exclusions separately; never assume durability protection also blocks upgrading.

## Map rollout

- [ ] Complete Gen1 / Map1 first.
- [ ] Use Gen1 to validate Sentinel's **read/parsing/control workflow**, not as a Git configuration template that gets pushed everywhere.
- [ ] Keep Map2 deferred until Gen1 passes all checks.
- [ ] When Map2 work starts, read Map2's own live Citadel files first.
- [ ] Apply shared settings to Map2 only deliberately after comparing both maps; never clone blindly.
- [ ] Add additional maps only after the first two are stable.

## ARN / Shiny notifications

- [ ] Validate ARN ingest path.
- [ ] Validate public Discord notification formatting.
- [ ] Confirm duplicate suppression/reconciliation.
- [ ] Validate Shiny event source.
- [ ] Validate Shiny Discord notification channel.
- [ ] Confirm Sentinel does not override server-side Shiny configuration unless explicitly enabled.

## Go-live gate

Do not enable full automation until all of the following are true:
- [ ] Server saves are protected.
- [ ] Plugin versions are known and documented.
- [ ] RCON and Citadel file access are stable.
- [ ] Live Gen1 settings can be read without Git changing or masking them.
- [ ] Live mod IDs resolve correctly through CurseForge.
- [ ] ArkShop read/write tests pass.
- [ ] Rank sync tests pass.
- [ ] ARN/Shiny notification tests pass.
- [ ] Rollback steps are written and tested.
- [ ] No temporary preview Railway services are needed for production.
