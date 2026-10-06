# Minecraft Points owner decisions

## OWNER DECISIONS

- Owner decision (8:29 PM CT on 2026-10-05, B4): the in-game link code and `/mc link confirm` verify a member for Minecraft Points. A Minecraft-only member with no ARK or EOS link can link, earn Minecraft playtime Points, buy from the Minecraft shop, and claim the Minecraft starter kit. That verification does not unlock ARK shop items, the 1,500 Point ARK legacy grant, or other ARK-only paths, and it does not change Coin rules. Restricted, held, quarantined, and disabled rules still apply. One Discord member who links both games keeps one Nexus Points wallet. Confirming the link does not change identity status or the Discord link's verified_at. Minecraft playtime, the Minecraft shop, and the Minecraft starter kit read a verified `nexus_mc_links` row.
- Minecraft Points are credited only when that Minecraft link is verified and the identity is not held, disabled, or quarantined. An unmarked restricted identity can use those Minecraft features and still cannot spend Coins.
- Partial delivery: lines already delivered stand, and the remainder goes to SENT_UNCONFIRMED for staff. Those lines are not auto-retried and not auto-refunded.

## Flags

Enable flags stay off unless set: `MC_POINTS_ENABLED`, `MC_PLAYTIME_NP_ENABLED`, `MC_SHOP_ENABLED`, `MC_SHOP_DELIVERY_ENABLED`, `MC_STARTER_KIT_ENABLED`. `MC_SHOP_ENABLED` is the narrow shop flag. `MC_PLAYTIME_DRY_RUN` and `MC_SHOP_DRY_RUN` default on. Playtime dry-run logs the credit and cap math, accrues per-UUID playtime, and writes no ledger row. Shop dry-run shows the confirm and a test receipt and debits nothing. While playtime dry-run is on, Craft does not send `give`. Poller timestamps, rank, flags, and dry-run switches in the HTTP body are ignored. Existing economy write flags are unchanged. The Starter Kit counts its 15 minutes from that dry-run playtime and does not require `MC_PLAYTIME_NP_ENABLED`.

## Rank

A Minecraft-only player earns at the rank already synced from that identity's Discord roles. `syncRank` writes `rank_id` on the server. Presence and the shop do not accept a rank from the request body. A missing sync stays on the stored rank, which defaults to Shadow Recruit.

## Quarantine and AFK

A quarantined economic identity cannot earn or spend Minecraft Points. The Minecraft resolve path and the shop quote/buy path both refuse it. ARK's EOS resolve path is unchanged. Once AFK is detected, the five minutes that led up to it are not paid and are removed from Minecraft lifetime playtime.

AFK on the live server is position plus rotation, unchanged for five minutes. There is no datapack signal and no `MC_AFK_DATAPACK_TAG`. FTB Essentials is not an AFK source. A missing position or rotation counts as AFK.

## Live pack

Item ids are the ones on ATM10: Aeronautics 0.6.1 (Minecraft 1.21.1, NeoForge 21.1.250, hosted on Kinetic Hosting). `give` targets the premium UUID. A success reply is `Gave <count> [` with that same count. The display name is not compared. Delivery reads free inventory slots with `data get` on the UUID and requeues when there is no room. `list uuids` is `There are N of a max of M players online: name (uuid), ...` with lowercase hyphenated UUIDs.

## Craft token

`NEXUS_ECONOMY_CRAFT_TOKEN` is limited to presence, link and unlink, the link-status read, delivery claim and delivery status, the refund sweep, and the pending-order and kit-grant reads. It cannot call the staff refund route. Buy, quote, and refund use Sentinal's token only. Minecraft refunds use the same staff check as the Coin shop: the configured Owner role id, the guild owner, or a staff-admin role that is not also a mod role. A role named Owner with a different id does not pass, and the Administrator bit alone does not pass. A non-empty `NEXUS_MC_REFUND_STAFF_IDS` list only narrows that check. Leave it unset. Staff can post 10 Minecraft refunds per Chicago day, counted from committed audit rows under a lock on the actor. A refund is refused when the actor's Discord id or economic identity matches the order. The worker does not hold Sentinal's bot token for refunds. Staff refunds are only within 24 hours of the purchase, measured with the database clock, and a held member cannot be refunded. The 14-day automatic refund of an undelivered order is unchanged. A delivery that was sent and is not confirmed or failed is refunded only when staff pass `force: true`, and that flag is stored on the refund ledger metadata. Credit, spend, identity, and admin routes reject the craft token. Sentinal's kit claim looks up the join date. If that lookup fails, an in-range `joinedAt` from Sentinal is accepted and a future value is ignored.

## Member commands

`/mc link`, `/mc unlink`, `/mc shop`, and `/mc starter` are registered only when that feature's flag is on. `/mcadmin` is a separate command. Its default member permission is Moderate Members, so regular members do not see it.

## Daily cap and ARK offline

Once Minecraft counted time hits 8 hours, that Minecraft presence does not keep the shared online flag set. ARK offline Points can accrue. A fresh ARK presence still counts as online. Minecraft lifetime playtime keeps moving.

## offline_since

`offline_since` is nullable. Going online stores null. The accrual table drops NOT NULL on fresh and existing databases so that write matches the column.

## Schema

Minecraft schema stays lazy. A failure returns `mc-schema-unavailable`, disables only Minecraft, and does not close the economy pool.

## Catalog

`MC_SHOP_CATALOG_JSON` and `MC_STARTER_KIT_JSON` may only swap an item id for another id already in the reviewed catalog or kit. They cannot change prices, quantities, or add items. A quantity of zero or less is rejected. `GET /mc-shop/catalog` returns that catalog. Shop daily limits are counted per economic identity. Stuck `DELIVERY_IN_PROGRESS` orders move to `SENT_UNCONFIRMED` on the refund sweep, and staff resolve them in Sentinal.
