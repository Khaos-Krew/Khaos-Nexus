# Minecraft Points owner decisions

## OWNER DECISIONS

- A verified `/mc link` qualifies an identity for Minecraft-earned Nexus Points. EOS is not required. Status: pending WARDEN sign-off.
- No Minecraft Points are credited unless the economic identity is verified and the Minecraft link is verified.
- Partial delivery: lines already delivered stand, and the remainder goes to SENT_UNCONFIRMED for staff. Those lines are not auto-retried and not auto-refunded.

## Flags

Enable flags stay off unless set: `MC_POINTS_ENABLED`, `MC_PLAYTIME_NP_ENABLED`, `MC_SHOP_ENABLED`, `MC_SHOP_DELIVERY_ENABLED`, `MC_STARTER_KIT_ENABLED`. `MC_SHOP_ENABLED` is the narrow shop flag. `MC_PLAYTIME_DRY_RUN` defaults on. Dry-run logs the credit and cap math, accrues per-UUID playtime, and writes no ledger row. While dry-run is on, Craft does not send `give`. Poller timestamps, rank, flags, and dry-run switches in the HTTP body are ignored. Existing economy write flags are unchanged.

## Rank

A Minecraft-only player earns at the rank already synced from that identity's Discord roles. `syncRank` writes `rank_id` on the server. Presence and the shop do not accept a rank from the request body. A missing sync stays on the stored rank, which defaults to Shadow Recruit.

## Quarantine and AFK

A quarantined economic identity cannot earn or spend Minecraft Points. The Minecraft resolve path and the shop quote/buy path both refuse it. ARK's EOS resolve path is unchanged. Once AFK is detected, the five minutes that led up to it are not paid and are removed from Minecraft lifetime playtime.

AFK on the live server is position plus rotation, unchanged for five minutes. There is no datapack signal and no `MC_AFK_DATAPACK_TAG`. FTB Essentials is not an AFK source. A missing position or rotation counts as AFK.

## Live pack

Item ids are the ones on ATM10: Aeronautics 0.6.1 (Minecraft 1.21.1, NeoForge 21.1.250, hosted on Kinetic Hosting). `give` targets the premium UUID. A success reply is `Gave <count> [` with that same count. The display name is not compared. Delivery reads free inventory slots with `data get` on the UUID and requeues when there is no room. `list uuids` is `There are N of a max of M players online: name (uuid), ...` with lowercase hyphenated UUIDs.

## Craft token

`NEXUS_ECONOMY_CRAFT_TOKEN` is limited to presence, link and unlink, delivery claim and delivery status, the refund sweep, and the pending-order and kit-grant reads. Buy, quote, and staff refunds use Sentinal's token only. Credit, spend, identity, and admin routes reject the craft token.

## Catalog

`MC_SHOP_CATALOG_JSON` and `MC_STARTER_KIT_JSON` may only swap an item id for another id already in the reviewed catalog or kit. They cannot change prices, quantities, or add items. A quantity of zero or less is rejected. `GET /mc-shop/catalog` returns that catalog. Shop daily limits are counted per economic identity. Stuck `DELIVERY_IN_PROGRESS` orders move to `SENT_UNCONFIRMED` on the refund sweep, and staff resolve them in Sentinal.
