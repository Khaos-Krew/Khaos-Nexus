# Sentinel Dino Cache Foundation

Status: feature branch foundation; production delivery intentionally disabled.

## Implemented flow

1. The shop/economy layer authorizes payment and resolves the linked ARK/EOS ID.
2. `freezePurchase()` rolls species, Normal/X/S variant, level and sex once.
3. Only species/variant outcomes with a configured verified blueprint can roll.
4. The exact reward is persisted in `ark_dino_cache_purchases` as `ROLLING` before Discord animation starts.
5. `animateCacheReveal()` edits one Discord message to reveal the already-frozen result.
6. The ledger moves to `AWAITING_LOGIN` even if the visual reveal fails.
7. The delivery worker runs `ListPlayers` against eligible ARK RCON connections and matches the linked EOS ID.
8. The ledger atomically locks the cache, then moves it to `DELIVERING` before command transmission.
9. Dino Depot fulfillment uses a configurable `SpawnDinoInBall` command template.
10. A configured success acknowledgement is required before `DELIVERED`; ambiguous results become `DELIVERY_UNKNOWN` and are never automatically resent.

Shiny is deliberately not part of this system.

## Files

- `bot/ark-cache/cache-engine.cjs` — weighted RNG, blueprint gating, announcement qualification.
- `bot/ark-cache/cache-service.cjs` — persist/reveal/queue coordinator after payment authorization.
- `bot/ark-cache/discord-roller.cjs` — single-message slot-style reveal.
- `bot/ark-cache/delivery-worker.cjs` — EOS online detection and anti-duplicate delivery state machine.
- `bot/ark-cache/supabase-store.cjs` — service-role REST store.
- `supabase/migrations/20260831220000_ark_dino_cache_ledger.sql` — immutable reward/delivery ledger and atomic lock RPC.
- `config/ark-dino-caches.json` — safe disabled configuration shell.

## Required before enabling production

### 1. Nexus Points adapter

`recordPurchasedCache()` intentionally begins after payment authorization. Wire it to the canonical Nexus Points/ArkShop economy source with an idempotent debit transaction. Do not allow the Discord command/button to call the cache service until debit succeeds.

### 2. Account-link adapter

Resolve Discord user ID to the canonical linked ARK/EOS ID before purchase. The cache engine refuses an empty EOS ID.

### 3. Verified Dino Depot command template

Dino Depot documents `SpawnDinoInBall` as capable of placing an exact dino in a target player's inventory over RCON. The exact production flags for level/sex/stat generation must be generated/verified against the current Dino Depot command builder and then tested on the test ARK server.

Set `delivery.commandTemplate` only after that test. Supported placeholders in Sentinel are:

- `{eosId}`
- `{blueprintPath}`
- `{level}`
- `{sex}`
- `{cacheId}`

No flag names are hard-coded in Sentinel, preventing a guessed Dino Depot syntax from entering production.

### 4. Success acknowledgement

Set `delivery.successPattern` to a response that conclusively means Dino Depot created the Dinoball for the target player. If RCON returns no trustworthy acknowledgement, leave automatic completion disabled and add a small ASA/API receipt helper before production. A timeout or non-matching response is `DELIVERY_UNKNOWN`, not a retry.

### 5. Cache pools

Populate `config/ark-dino-caches.json` only with verified blueprint paths. Each cache can define:

- cost
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

Keep `enabled=false` and `delivery.enabled=false` until account linking, economy debit, blueprint registry, Dino Depot command syntax and success acknowledgement are verified on a test server.
