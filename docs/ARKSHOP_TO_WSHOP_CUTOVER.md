# ArkShop to WShop staged cutover

This migration is prepared but intentionally inactive. ArkShop remains the production provider until the installed WShop build and its companion W Shop UI mod have passed staging.

## Prepared catalog

- Seven kits: one spawn-only starter kit plus Recovery, Builder, Taming, Breeder, Ocean, and Boss Prep.
- Dino Ball packs, all planned native resource bundles, and the complete basic/boss/apex sell tables.
- The balanced Crazy's and Gaia potion catalog. Love Potion stays out of the shop and craftable; Engram Unlocker stays excluded.
- Seven Sentinel-owned Dino caches: Coastal, Forest, Swamp, Mountain, Ocean, Deep Cave, and Apex.
- Daily, weekly, Founder, and event reward-cache pools with rank entitlements, pity rules, value budgets, and non-pay-to-win validation.

## Shadow Recruit potion prices

The free Shadow Recruit baseline earns 2 Nexus Points every 5 minutes, or 24 NP per hour. Potion prices are therefore expressed against passive earning time before any resource sales, trophies, events, or other gameplay rewards:

| Potion | NP | Passive hours |
|---|---:|---:|
| Gaia Player Health — Small / Medium / Large | 25 / 50 / 75 | 1.0 / 2.1 / 3.1 |
| Gaia Dino Health — Small / Medium / Large | 40 / 75 / 100 | 1.7 / 3.1 / 4.2 |
| Gaia Stamina / Weight | 40 / 75 | 1.7 / 3.1 |
| Gaia Sedative / Famish / XP | 75 / 100 / 125 | 3.1 / 4.2 / 5.2 |
| Gestation Skip / Grow Up / Instant Imprint | 100 / 100 / 125 | 4.2 / 4.2 / 5.2 |
| Gender Change / Assignment | 75 / 125 | 3.1 / 5.2 |
| Mutation | 250 | 10.4 |
| Super Crafting / Gaia Instant Taming | 300 / 300 | 12.5 / 12.5 |

This is the free-rank affordability ceiling. Gameplay earnings shorten these times; paid ranks are not required to obtain any potion.

The generated bundle is `config/ark/wshop/nexus-wshop-migration.json`. Rebuild it with `npm run wshop:export` after changing any source catalog.

## Why the bundle is staged

W Shop UI identifies itself as the companion mod for WShop, but the public mod page does not publish the plugin's configuration schema or atomic debit/refund interface. The generated bundle therefore contains the complete catalog under `wshop.nativeCatalog` and records `schemaStatus: awaiting-installed-plugin-sample`. It must not be copied blindly over a live WShop config.

## Safe cutover sequence

1. Install matching WShop and W Shop UI versions on a staging server and let WShop generate a clean default configuration.
2. Save the generated WShop config and plugin version as migration inputs. Map the prepared `Kits`, `ShopItems`, and `SellItems` into that exact schema.
3. Validate item blueprints, quantities, prices, kit cooldown/claim behavior, sell amounts, and UI categories. Love Potion and Engram Unlocker must remain absent.
4. Back up ArkShop configuration and every player point balance. Import balances into WShop and reconcile totals and per-EOS balances before enabling purchases.
5. Verify WShop balance lookup, atomic debit, credit, and refund operations through RCON or the supported API. Sentinel must stay on ArkShop until all four operations pass.
6. Test one ordinary item, one paid kit, one sale, one Gaia potion, one Crazy's potion, one Dino cache, and one supporter reward cache. Confirm each has exactly one charge and one audit record.
7. Put the shop into a short maintenance window. Disable ArkShop writes, perform a final balance delta transfer, switch Sentinel to WShop, then enable WShop writes. Never run both providers writable together.
8. Keep the ArkShop backup untouched until post-cutover reconciliation passes. Roll back on any balance mismatch, duplicate charge, missing refund, or failed cache delivery.

No plugin installation, live config replacement, point transfer, restart, or provider switch is performed by the exporter.
