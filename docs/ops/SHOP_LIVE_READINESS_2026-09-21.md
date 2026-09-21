# Cluster shop + dino cache — live readiness (2026-09-21)

**Status:** NOT READY to flip spend flags  
**Director decision:** Prep catalog only; keep all money/delivery flags OFF until Gen1 RCON + presence smoke pass and owner Go.

## What we did tonight (safe)
- Copied Sentinal smoke catalog (3 live-test items) onto `nexus-economy-worker-test` as `NEXUS_CLUSTER_SHOP_CATALOG_JSON`.
- Spend / delivery flags unchanged (all false). Presence writes stay on.

## Why shop is not live yet
1. **Gen1 RCON unreachable** from Railway Sentinal (TCP timeout on Discord override). Owner fixing via `/arkrcon` at home. Delivery + join detection need at least one healthy map RCON.
2. **Presence not proven** — accrual rows still show null `last_presence_at` / empty presence; harden code is local, GitHub push blocked until SCM reconnect.
3. **Owner plan-lock** — open cluster shop **and** dino caches together only after dino-cache path confirmed with new wallet. Dino cache still `NEXUS_DINO_CACHE_TEST_MODE=true`; no clear `NEXUS_ARK_DINO_CACHE_ENABLED=true` on Sentinal.
4. **Checklist gaps** — WARDEN/LEDGER sign-off, catalog review beyond smoke SKUs, smoke buy + Rewards Ascended delivery not done.
5. **Worker debit/claim/outbox** still false — needed with spend path when we do flip.

## Flip order (when Go)
See `docs/ops/SHOP_ENABLE_CHECKLIST_2026-09-15.md`. Keep `NEXUS_ECONOMY_PRESENCE_WRITES_ENABLED=true`. Rollback: delivery → purchases → writes OFF.

## Catalog note
Smoke SKUs only (`live-test-metal|polymer|element`). Full production catalog = set catalog JSON to `@arkshop-production` marker after owner reviews prices — not tonight.

## Owner home actions
1. `/arkrcon configure` + `password` + `test` for Gen1 (Discord only — no Railway RCON env).
2. Reconnect GitHub on the SCM card so presence harden can land + redeploy Sentinal.
3. Explicit **Go** for shop+cache enable after presence smoke shows players accruing.
