# ARK Rebuild Checklist

Use this checklist when the required ARK plugins are available again.

## Before plugin installation

- [ ] Save all ARK worlds.
- [ ] Back up `Game.ini` and `GameUserSettings.ini` for every map.
- [ ] Record current map names, ports, SFTP roots, and RCON endpoints.
- [ ] Preserve the current known-good player rates/stats profile.
- [ ] Export or back up ArkShop database/configuration before plugin changes.
- [ ] Confirm Nexus ARK worker and Sentinel health before touching the game servers.

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
- [ ] SFTP read succeeds.
- [ ] SFTP controlled config write succeeds on a backed-up non-critical file.
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

## Multi-map rollout

- [ ] Complete Gen1 first.
- [ ] Treat Gen1 as the canonical working profile.
- [ ] Clone config to Astraeos only after Gen1 passes all checks.
- [ ] Validate Astraeos independently.
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
- [ ] RCON/SFTP are stable.
- [ ] ArkShop read/write tests pass.
- [ ] Rank sync tests pass.
- [ ] ARN/Shiny notification tests pass.
- [ ] Rollback steps are written and tested.
- [ ] No temporary preview Railway services are needed for production.
