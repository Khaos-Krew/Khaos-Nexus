# CODEX_RESUME

## Objective
Finish the SAME Khaos Nexus Sentinel production task tonight: database-managed encrypted RCON, shared provider and /ark server test; authoritative Wallet; direct Dino Cache credits; safe quantity purchases and fulfillment. Sellback and destructive Dino Depot conversion remain disabled. Kirito must explicitly approve production deployment. User approved zero starting Nexus Wallet balances; preserve all legacy ArkShop balances.

## Current branch / commits
Working branch: fix/wallet-shop-launch-safety.
Latest baseline SHA: 7dad0f59f28be1e8aa71d200037db4d59b22fcac.
New upstream SHA discovered: accd2c87087d6fea55fcf4ef0e22131a4db2724e (PR #583 default-off economy write gate).
The implementation checkpoint commit is the commit containing this file; get exact SHA with git rev-parse HEAD. Rebase onto upstream completed at 24f488d; #583 preserved in postgres-server.cjs.

## Completed
Wallet/order Postgres JSONB transaction boundary implemented in postgres-persistence.cjs with row lock and atomic commit/rollback. HTTP integration tests use real embedded Postgres (PGlite), not a mocked query engine. Readiness/auth/checkout gate, recoverable payments, exclusive fulfillment claims, operator refund/resolve behind separate credentials. 42 catalog offers preserve source prices/quantities. Complete identity and per-map presence snapshots with stale-input rejection. Shared same-map lock covers both RewardsAscended adapters through config/reload/send. Earlier checkout navigation and idempotency fixes retained. Owner grants idempotent; code-free owner token redemption and combined wallet display implemented.

## Changed files
Use git show --stat HEAD / git diff --stat. Main areas: src/economy-worker/{entry,postgres-persistence}.cjs; src/sentinel/{nexus-economy-worker,nexus-economy-client,nexus-economy-identity-sync-extension,ark-economy-presence-bridge,cluster-shop-service,cluster-shop-delivery-worker,cluster-shop-ui-extension,cluster-shop-rewards-delivery,rewards-ascended-delivery,rewards-ascended-lock,ark-dino-box-token-service,ark-dino-box-token-issuer-extension,ark-dino-box-shop-extension,entry}.cjs; imported pure policy files from #578/#581; catalog JSON; Dockerfile.economy-worker; focused tests; package files (PGlite dev dependency).

## Migrations
Created code to initialize nexus_economy_state in existing Postgres; no production migration applied. No legacy balances touched. Production worker not created/deployed. No RCON migration applied.

## Tests
Latest local full suite after integrating #583: 1,408 passed, 0 failed, 0 skipped. npm run check passed.

## Exact remaining work (priority)
A. Replace existing FILE-backed encrypted ark-rcon-config-store with database management (existing encryption is AES-GCM but file based, not DONE).
B. Shared RCON provider: arkServerFromEnv currently resolves file/env settings synchronously; live clients currently retain endpoints. Move active callers to dynamic shared database provider, preserve safe legacy mode until explicit cutover.
C. /ark server test and management using provider; preserve existing /arkrcon owner/staff permission checks.
D. Direct Dino Cache wallet credits: current implementation only displays legacy owner/ARN balances; new user explicitly requires direct Wallet credits. Must implement authoritative credit/redemption without double-spending legacy records. Preserve both existing sources and 5% Anomaly rule.
E. Integrate #583 write gate with PostgreSQL service. Validate no debit/order on failure, safe refund paths, multi-instance DB locking, critical API/Discord flows.
F. Production variables/config, exact commit gate, approval, approved rollout, live tests. No approval for production deployment yet.
G. Update checkpoint/report after each milestone, commit/push safe working branch. Never merge failing/incomplete work to production.

## Bugs/blockers
Upstream #583 reconciled and verified. RCON DB migration and direct token credits unfinished. Live RCON/Discord/database evidence not yet run. Shared delivery lock assumes one Sentinel replica. PostgreSQL tests embedded locally; remote DB multi-connection tests still needed. No production activation approval. Do not claim 100%/DONE.

## Production discovered
Railway project e34e72bf-6ab7-437c-b55e-ef6aef586e4a; env 668aaf1d-a98c-4873-9e29-8c02aebb1ddb; Sentinel a89ba9d3-e5e7-4e20-b1c8-1fad1ece331b; Postgres 0bbddff2-f0c9-4bdc-af7e-d1164dafdf99. Last inspected deployment f6c153b3-71ae-44ef-adf3-249f4c1785a6 SUCCESS at 7dad0f5, no staged patch. Upstream changed since that inspection: reread Railway before any action. Production branch rebuild/nexus-0.1 auto-deploys: no merge/push there without approval.

## Railway variables discovered / needed (names only)
Sentinel has ARK_GEN1/ARK_MAP2 host, RCON port/password, SFTP settings, NEXUS_DINO_CACHE_DELIVERY_BACKEND, NEXUS_DINO_CACHE_DINODEPOT_FALLBACK, NEXUS_DINO_CACHE_RNG_SECRET. Connector values redacted. NEXUS_ECONOMY_URL and NEXUS_ECONOMY_TOKEN absent on last inspection.
Worker needs NEXUS_ECONOMY_DATABASE_URL (Postgres reference), NEXUS_ECONOMY_TOKEN, separate NEXUS_ECONOMY_RECOVERY_TOKEN; preserve default-off NEXUS_ECONOMY_WRITES_ENABLED from #583; NEXUS_CLUSTER_SHOP_CHECKOUT_ENABLED; authority nexus. Sentinel needs worker URL/token; explicit NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED only after approval. Encryption key NEXUS_RCON_CONFIG_SECRET exists in file-based code but DB encryption/key contract still to implement. Do not print secrets.

## Status
RCON: encrypted file/env config exists; DB-managed replacement not yet implemented/applied.
Wallet: code upgraded to Postgres; not deployed/connected. Zero balances approved; legacy balances untouched.
Cluster Shop: UI live but checkout disconnected; local safety and catalog ready; no live purchase verified.
Dino Cache: production RewardsAscended/fallback-off worker healthy on two maps. Token code-free redemption locally prepared, but direct authoritative Wallet credit migration remains.

## Safest next action / exact command
Rebase completed. Continue database-backed RCON implementation. Baseline verification command:
node --test tests/economy-postgres-http.test.cjs tests/economy-launch-readiness.test.cjs tests/nexus-economy-server.test.cjs
Then npm test and npm run check. Continue RCON database work after integration. No production deployment.

