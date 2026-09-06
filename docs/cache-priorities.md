# Dino, weekly and ARN caches

This change extends the live `ark-dino-box-shop-extension` →
`ArkCacheShopService` → `ark-dino-box-delivery-worker` flow. It does not enable
the legacy ArkShop receipt poller or add another reward engine.

## ArkShop checkout

Sentinel checks the linked account and shared economy, verifies the ArkShop
wallet is InnoDB, locks the wallet row, conditionally deducts points, then rolls
and stores the sealed order, purchase snapshot, balance audit and saddle work
in one MySQL transaction. A failed write rolls back the entire purchase.
The unique Discord interaction ID prevents a second charge on retries.
Conflicting purchaser/cache reuse is rejected. Concurrent duplicate inserts
roll back the losing debit and retrieve the committed order.

`nexus_cache_purchase_receipts` stores the original currency, balances, cost,
complete cache definition and reward snapshot. Application code never updates
or deletes these receipts. Delivery and reveal state remain in the existing
orders table; delivery never changes either wallet.

## Weekly cache

- Monday 00:00 UTC; the ready hook checks every minute and catches up after downtime.
- Eight creatures from an explicit ASA Island allowlist using existing approved blueprints.
- Previous lineup is excluded when enough candidates remain.
- Initial price: 2,500 ArkShop Points; five-minute cooldown.
- Rarity weights: common 35, uncommon 35, rare 25, ultra 5, normalized to available tiers.
- Existing Normal/X/S eligibility and exact 200–300 level distribution are reused.
- Moros/Indomitable/Indominus/Indoraptor and Shiny names or paths are denied.
- Database snapshots preserve lineups across restarts and RNG-secret changes.
- The hub shows a Discord relative reset timestamp. Buy buttons identify the
  displayed rotation and reject an expired lineup before charging.
- Rotation announcements use a database lock, saved publication timestamp and
  Discord nonce. Discord and MySQL are not a distributed transaction; a prolonged
  outage after Discord accepts a message but before saving its timestamp may
  still require announcement reconciliation.

## ARN tokens

**Earning and redemption are disabled by default, with unset rates, as requested.**
The schema initializer uses INSERT IGNORE and never overwrites staff settings.

Separate InnoDB wallets and append-only earn/spend ledger records commit
atomically. ARN purchases use the existing sealed order/reveal/delivery flow
and never deduct ArkShop Points. Existing NXC token codes remain separate.
The initial ARN cache uses the approved forest species subset and shared rules.

The participation poller reads the existing Protocol store, accepting only
qualified, non-disqualified participants in completed Anomaly runs. Stable award
IDs prevent duplicate grants, including after rate changes. Display-name-only
Shiny feeds are not trusted currency sources. The existing authenticated
Protocol evidence intake or staff verification supplies participation evidence.
Activity completed before enablement is not backfilled.

Player commands: `/arn balance`, `/arn history`, `/arn cache`, `/arn buy`.
Staff commands: `/arn configure earn:<n> cost:<n>` enables both operations;
`/arn pause` disables them; `/arn adjust` records a signed adjustment with a reason.
Staff authorization reuses the existing Nexus owner/admin/operator-role check.

## Saddle delivery and recovery

The purchase snapshot includes the matching primitive saddle for the approved
weekly/ARN species that need one. Moschops does not require one. The existing
RCON worker sends the saved creature and saddle as separately acknowledged
components. It never automatically resends an acknowledged creature.

Dino Depot's published command builder does not expose saddle delivery, so the
saddle uses `GiveItemToPlayer`. That requires a numeric ARK player ID, distinct
from EOS. Before a bundle can deliver, staff must register an evidence-verified
mapping with `/cacheadmin target eos:<EOS> map:<ARK_PREFIX> playerid:<ID>
evidence:<reference>`. Sentinel also verifies the EOS is online on that map.
Missing mappings leave the order queued and do not block other orders.
Update mappings after character replacement; EOS alone cannot prove a new
character's numeric ID.

Blank, unknown or lost acknowledgements and stale delivery claims are held for
inventory verification. `/cacheadmin reconcile` records whether the creature
and saddle were received and queues only the missing components. It cannot
automatically resend a previously acknowledged creature. Neither recovery path
charges again.

## Rollout and validation

Use the existing Sentinel MySQL connection and `NEXUS_DINO_CACHE_RNG_SECRET`
(at least 32 characters). Startup creates additive InnoDB tables. Retain backups
of the wallet, order, receipt, ledger, rotation and delivery tables. Do not start
a local Sentinel against production merely to run tests.

Unit/behavior tests cover rollback, replay conflicts, ARN separation and disabled
policy, earnings replay, rotation persistence, level/variant rules, permissions,
and ambiguous/component delivery recovery. Full repository tests and structure
checks are run separately. These tests use simulated database/RCON interfaces;
they do not establish live MySQL concurrency or actual ASA inventory delivery.
Live rollout requires a controlled linked test account, verified numeric target,
and one purchase/reveal with inventory confirmation. ARN remains disabled until
the owner sets rates.

Reference: [Dino Depot official command builder](https://docs.google.com/spreadsheets/d/1WKHzcZqxt8RUJ4oPg7DdEJSYGUs87ntoHeHmW62aBxc/edit).
