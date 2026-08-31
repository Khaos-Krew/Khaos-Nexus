# Sentinel Dino Cache Foundation

Status: feature branch foundation; production delivery intentionally disabled.

## Implemented paid-purchase flow

1. Resolve the Discord user to the canonical linked ARK/EOS ID.
2. Atomically claim the persistent per-EOS purchase cooldown. Default: 5 seconds; configurable up to 3600 seconds.
3. Read the player's current ArkShop balance with `GetPlayerPoints <EOS>`.
4. Reject the purchase if the player cannot afford the cache.
5. Deduct the exact cache cost with `ChangePoints <EOS> -<cost>`.
6. Re-read ArkShop and require the exact expected post-debit balance.
7. **Only after the cooldown and ArkShop debit are positively verified** may `freezePurchase()` execute RNG.
8. `freezePurchase()` rolls species, Normal/X/S variant, level and sex once.
9. Only species/variant outcomes with a configured verified blueprint can roll.
10. Persist the exact reward in `ark_dino_cache_purchases` as `ROLLING` before Discord animation starts.
11. `animateCacheReveal()` edits one Discord message to reveal the already-frozen result.
12. Move the ledger to `AWAITING_LOGIN` even if the visual reveal fails.
13. The delivery worker runs `ListPlayers` against eligible ARK RCON connections and matches the linked EOS ID.
14. The ledger atomically locks the cache, then moves it to `DELIVERING` before command transmission.
15. Dino Depot fulfillment uses a configurable `SpawnDinoInBall` command template.
16. A configured success acknowledgement is required before `DELIVERED`; ambiguous results become `DELIVERY_UNKNOWN` and are never automatically resent.

Shiny is deliberately not part of this system.

## Abuse prevention invariants

- Cooldown is keyed by EOS ID, not Discord session, so relogging or using another Discord session cannot bypass it.
- Cooldown is claimed atomically in Supabase before ArkShop RCON operations.
- The default cooldown is `5` seconds and is configurable with `purchaseCooldownSeconds`.
- No RNG occurs before a positively verified ArkShop debit.
- No cache reward is created when points are insufficient.
- Owner/Admin permissions do **not** bypass cooldown or payment. Paid cache purchases use the exact same path for every player.
- If failure occurs after a verified debit but before the reward can be persisted, Sentinel attempts a verified ArkShop refund.
- Once the exact reward is persisted, Discord/reveal failure does not refund the purchase; the reward remains owed and queued, preventing reveal/refund abuse.
- Delivery ambiguity never auto-retries.

## Files

- `bot/ark-cache/cache-engine.cjs` — weighted RNG, blueprint gating, announcement qualification.
- `bot/ark-cache/cache-service.cjs` — cooldown, verified payment, persist/reveal/queue coordinator.
- `bot/ark-cache/arkshop-points.cjs` — ArkShop point balance/debit/refund gateway over existing ARK RCON.
- `bot/ark-cache/discord-roller.cjs` — single-message slot-style reveal.
- `bot/ark-cache/delivery-worker.cjs` — EOS online detection and anti-duplicate delivery state machine.
- `bot/ark-cache/supabase-store.cjs` — service-role REST store and atomic cooldown claim.
- `supabase/migrations/20260831220000_ark_dino_cache_ledger.sql` — immutable reward/delivery ledger, cooldown table, atomic cooldown RPC, delivery lock RPC.
- `config/ark-dino-caches.json` — safe disabled configuration shell and cooldown default.

## ArkShop economy contract

Paid cache purchases call ArkShop directly through Sentinel's existing ARK RCON stack:

- `GetPlayerPoints <EOS>`
- `ChangePoints <EOS> -<cost>`

The purchase service requires the post-debit balance to equal `balance_before - cost` before RNG is allowed.

Free/event/admin grants, if added later, must be separate explicitly authorized grant operations. They must never reuse or silently bypass the paid shop-purchase entry point.

## Account-link adapter

Resolve Discord user ID to the canonical linked ARK/EOS ID before purchase. The cache engine refuses an empty EOS ID.

## Verified Dino Depot command template

Dino Depot documents `SpawnDinoInBall` as capable of placing an exact dino in a target player's inventory over RCON. The exact production flags for level/sex/stat generation must be generated/verified against the current Dino Depot command builder and then tested on the test ARK server.

Set `delivery.commandTemplate` only after that test. Supported placeholders in Sentinel are:

- `{eosId}`
- `{blueprintPath}`
- `{level}`
- `{sex}`
- `{cacheId}`

No flag names are hard-coded in Sentinel, preventing a guessed Dino Depot syntax from entering production.

## Success acknowledgement

Set `delivery.successPattern` to a response that conclusively means Dino Depot created the Dinoball for the target player. If RCON returns no trustworthy acknowledgement, leave automatic completion disabled and add a small ASA/API receipt helper before production. A timeout or non-matching response is `DELIVERY_UNKNOWN`, not a retry.

## Cache pools

Populate `config/ark-dino-caches.json` only with verified blueprint paths. Each cache can define:

- cost
- optional purchase cooldown override
- eligible maps
- level min/max
- species weights
- Normal/X/S weights
- sex weights
- announcement rules

## State machine

`ROLLING -> AWAITING_LOGIN -> DELIVERY_LOCKED -> DELIVERING -> DELIVERED`

Failure states:

- `DELIVERY_FAILED`: known pre-send/definite failure; admin may reconcile and explicitly requeue.
- `DELIVERY_UNKNOWN`: command may have executed; never auto-retry.

## Deployment policy

Keep `enabled=false` and `delivery.enabled=false` until account linking, blueprint registry, Dino Depot command syntax and success acknowledgement are verified on a test server. ArkShop payment and cooldown code are implemented but should still be validated against the live/test ArkShop RCON responses before production enablement.
