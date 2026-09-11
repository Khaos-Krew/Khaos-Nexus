# Wallet and Cluster Shop launch assessment

Assessment: 65% complete toward a usable, production-verified launch. This is an engineering estimate, not a measured percentage of code. Seven equally weighted areas score 80/80/70/65/65/65/30. Local improvements are counted as implemented, not deployed.

## Verified production baseline

- Repository: https://github.com/Khaos-Krew/Khaos-Nexus
- Branch: rebuild/nexus-0.1
- Running commit: 7dad0f59f28be1e8aa71d200037db4d59b22fcac, merged via PR #580. The conversation handoff referring only to #579 was outdated.
- Railway project discerning-purpose, environment production, service nexus-sentinal-0-1-test.
- Deployment f6c153b3-71ae-44ef-adf3-249f4c1785a6: SUCCESS. No staged patch reported in this environment on both inspections.
- Runtime explicitly reports identity sync and ARK presence bridge disabled because the economy worker is not configured.
- No economy worker service is listed in this Railway project. Sentinel's variable names do not include NEXUS_ECONOMY_URL or NEXUS_ECONOMY_TOKEN. Values are redacted by the connector; current flag values cannot be independently read.
- Cluster Shop reconciles its existing panel without duplicate creation.
- Dino Cache delivery reports RewardsAscended, fallback off, ARK_GEN1 and ARK_MAP2 routing; the cache hub initializes.
- Legacy periodic ArkShop maintenance reports disabled. A separate startup cluster-economy guard still reports database-mismatch across gen1/map2, and the MySQL-only preloads still run. Do not equate the periodic maintenance fix with retirement of all legacy startup paths.
- PR #580's Nexus Rebuild CI test and Windows build succeeded; its Cloudflare Workers build failed. A green Railway service alone is not an end-to-end commerce acceptance result.

## Readiness and remaining work

| Area | Estimate | Implemented / observed | Remaining launch blockers |
|---|---:|---|---|
| Wallet credit/debit | 80% | Discord-keyed wallet, playtime and paid-rank offline income, credit/spend ledger; local overflow, dedupe and accrual fixes | Deploy/connect a durable single-authority worker; establish starting balances and whether any legacy balance migration is wanted; verify actual credits/debits and persistence |
| Discord linking | 80% | Existing challenge/link system, four linked accounts reported in production startup; worker sync exists | Worker sync is disabled; verify conflict handling, account revocation/relink behavior and first-login/returning-player flows |
| Dino Cache tokens | 70% | Existing owner grants and verified Anomaly 5% reward source; local combined wallet display, code-free owner redemption and idempotent owner issuance | Verify both source tables/settings and committed qualified activity in production; verify one grant/redemption and one Anomaly award/redemption. Token stores remain separate from NP; no balances were copied or migrated |
| Cluster Shop purchases | 65% | Catalog/quote/order/RewardsAscended adapter exists; local routing, quote, checkout and worker startup fixes | Configure approved item catalog; connect worker; explicitly enable checkout and delivery in approved rollout; verify exact quantities on each map. Sellback stays blocked until exact inventory removal evidence exists |
| Shared cross-map balance | 65% | One Discord account balance independent of map; concurrent map earning regression passes | Reconcile stale presence after Sentinel/worker restart or missed logouts; verify map transfer without double accrual and no legacy authority dependency |
| Safety/idempotency | 65% | Local restart recovery, normalized conflict-checked dedupe, retained receipts, payment rejection handling, exclusive delivery claims | JSON stores require one writer and durable storage; no multi-process transaction guarantee. Add verified operator reconciliation/refund workflow for held or ambiguous deliveries. Coordinate shared RewardsAscended config writes with Dino Cache delivery; resolve policy integration from #578/#581 |
| Production verification | 30% | Deployment, startup messages, shop panel and cache routing verified read-only | No live wallet balance, credit, debit, purchase, exact inventory receipt, restart persistence, token award, or token consumption exercised here |

## Changes prepared locally

Branch: fix/wallet-shop-launch-safety, based exactly on the running commit above.

- Fixed all four Discord shop session parsers (they read a fourth segment from three-segment component IDs).
- Repeated confirmation clicks use the same checkout identity, and changed quotes are rejected before charging.
- Checkout requires an EOS identity belonging to that Discord wallet. Conflicting idempotency reuse and replayed rejected payments fail correctly.
- Pending payments recover after a process restart with the original order ID, without a second debit.
- Credit keys are required/normalized and bound to account, amount, type and source. Dedupe receipts are retained after ledger display pruning; unverifiable legacy receipts fail closed.
- Removed asynchronous gaps inside wallet read/modify/write operations that could overwrite another user's accrued balance. Added safe integer checks, login accrual settlement and a non-replayable offline cap.
- Added exclusive delivery claims and prevented automatic release/requeue of ambiguous outcomes. An offline order no longer blocks the rest of a cycle.
- Wired the existing delivery worker into Sentinel startup behind its existing explicit enable flag. Added a separate default-off checkout gate, NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED, on the economy worker.
- Blocked exposed sellback API paths until an exact removal adapter is available.
- Both token sources appear in the Wallet view from their existing stores. Owner-issued tokens can be used through Use Wallet Token in the Dino Cache hub; ownership and row locking use the same existing redemption transaction. Owner grant retries mint only one token. Existing Anomaly eligibility, 5% chance and ARN redemption rules are unchanged.

## Validation

- npm run check passed.
- Final full npm test: 1,387 passed, 0 failed, 0 skipped.
- Added regressions cover restart after debit/before order update, concurrent checkouts, conflicting retries, rejected replay, stale quote, unlinked EOS, delivery claims, cross-user accrual, offline cap, login settlement, overflow, shared-map earning, the complete mocked Discord checkout flow, both token balances, token ownership lookup and repeated owner grants.
- Database, Discord and RCON behavior in these tests uses local fixtures/mocks. No live database transactions, inventory delivery, live token issuance, or Discord messages were performed.
- Windows installer build and fresh remote CI were not run for this candidate. The repository check and test suite ran locally on Windows.

## Review and rollout sequence — not executed

1. Review this patch against current production and reconcile #578/#581. #574 is the older economy foundation and should not be merged over #580 wholesale; #569/#573 are broader rebuild candidates. #568 remains the broad rebuild tracker.
2. Resolve presence recovery, shared reward-config serialization and operator handling of stuck/ambiguous orders; validate source token schema/settings with read-only production evidence.
3. Prepare the economy worker service (entry: src/economy-worker/entry.cjs), storage/backup plan, one-writer enforcement, health behavior, catalog and credentials. Required connectivity is NEXUS_ECONOMY_URL plus NEXUS_ECONOMY_TOKEN on Sentinel and matching worker authentication. NEXUS_DATA_DIR must point to persistent worker storage. The current implementation uses JSON files, not the existing Postgres service.
4. Obtain Kirito's explicit approval for an exact commit and reviewed configuration batch before creating/deploying the production worker or deploying Sentinel. Keep checkout and delivery off initially. Do not accept unrelated staged changes.
5. After the approved deployment, verify identity sync and presence. Use an approved test account and fixed transaction IDs to check credit, debit, duplicate retries, insufficient funds, and persistence.
6. Enable checkout/delivery only in the approved sequence. Test one catalog item on each map, map transfer, an offline order behind an online order, exact quantity/receipt, and an ambiguous response that remains held without resending.
7. Verify both token sources: owner grant retry gives one token; using the wallet token consumes one and seals one reward; committed qualified Anomaly awards use the existing persisted 5% roll, without reroll on replay; ARN redemption consumes one token. Verify failure/expiry/wrong-owner behavior.
8. Keep sellback disabled. Keep Dino Depot destructive conversion disabled. Preserve legacy balances until an explicitly reviewed migration is decided.

## Delivery boundary

No branch was pushed, PR posted, merge performed, Railway variables changed, staged changes accepted, deployment triggered, ARK command sent, or Discord message sent during this work. The output patch includes all prepared source and test changes. Production remains on #580; this candidate is not yet production-ready.
