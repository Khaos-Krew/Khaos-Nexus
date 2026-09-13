# Wallet relink before ARK shop

## Release gate

Do not enable spending or fulfillment from this document alone. The code and isolated
Postgres test are validation evidence, not evidence of a successful live player relink.
Promote one exact commit only after Linux and Windows CI pass and the following live
checks pass. Keep the existing production checkout until then.

## Railway observed on 2026-09-12 (America/Chicago)

Project: `discerning-purpose` (`e34e72bf-6ab7-437c-b55e-ef6aef586e4a`),
production environment `668aaf1d-a98c-4873-9e29-8c02aebb1ddb`.

* `nexus-sentinal-0-1-test`: successful deployment, source `rebuild/nexus-0.1`.
  Starts an economy subprocess on localhost:3240 and the legacy Sentinel process.
  Persistent volume is mounted at `/app/data`.
* `nexus-economy-worker-test`: failed build, source `rebuild/nexus-0.1`.
  Docker build stopped at `npm test`. No runtime log was present for that deployment.
* `nexus-economy-live-test`: failed deployment, source `railway-economy-live-test`.
* Postgres service exists and its latest deployment is successful.
* The economy test service lists only NEXUS_DATA_DIR, NEXUS_ECONOMY_TOKEN,
  NEXUS_ECONOMY_WRITES_ENABLED and NODE_ENV as service variables. No database
  connection or Postgres storage selection is listed.
* The Sentinel variable inventory does not list NEXUS_ARK_IDENTITY_WEBHOOK_SECRET,
  NEXUS_ECONOMY_IDENTITY_PROOF_SECRET, or a Postgres connection.
* The connected Railway API hides variable values. Presence of a flag is not proof
  of its value. No production variables or deployments were changed during this work.

## Configuration to prepare

Economy service:

```dotenv
NEXUS_ECONOMY_STORAGE=postgres
NEXUS_ECONOMY_SCHEMA=public
NEXUS_ECONOMY_WRITES_ENABLED=false
NEXUS_ECONOMY_IDENTITY_LINKS_ENABLED=false
NEXUS_ECONOMY_OUTBOX_ENABLED=false
NEXUS_ECONOMY_PURCHASE_EXECUTION_ENABLED=false
NEXUS_ECONOMY_PURCHASES_ENABLED=false
NEXUS_ECONOMY_WORKER_CLAIM_ENABLED=false
NEXUS_ECONOMY_WORKER_DEBIT_ENABLED=false
NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED=false
```

Set NEXUS_ECONOMY_DATABASE_URL using the existing Postgres service's DATABASE_URL
reference. Use the same schema in the migration and runtime. Set a separate random
NEXUS_ECONOMY_IDENTITY_PROOF_SECRET of at least 32 characters on Sentinel and the
economy service; do not reuse the bearer token or the game webhook secret.
Set NEXUS_ECONOMY_TOKEN and the private NEXUS_ECONOMY_URL consistently.
Set NEXUS_ARK_IDENTITY_WEBHOOK_SECRET on Sentinel and the authenticated game plugin.
Keep account linking disabled until the real plugin callback is configured and tested.
Store all secrets in Railway, never in this document or the repository.

Use `Dockerfile.sentinal`, `npm run economy-worker`, and `/health/ready` for the
dedicated economy service. Include all `src/**`, `tests/**`, `scripts/**`, config,
package manifests and Dockerfile changes in build watch patterns. The currently
configured narrow patterns omit several identity/repository dependencies.
Do not run the old JSON economy subprocess alongside a new wallet authority.

## Migration and relink validation

1. Verify actual write/fulfillment flag values. Freeze legacy financial writers and
   take a restorable snapshot of `/app/data`, including the identity secret, identity
   file, wallet file, purchase state and the existing database. Record checksums.
2. Run `npm run economy:migrate` against the frozen JSON snapshot. This is a dry run.
   Reconcile wallet counts, points totals, retained ledger and idempotency tombstones.
3. Apply only to the intended database/schema with `npm run economy:migrate -- --apply`.
   Rerun against the identical snapshot to verify idempotency. Never import an older
   snapshot over a wallet that has resumed activity. Balances must not be summed.
4. Legacy EOS associations are reserved but restricted. They are not proof of
   ownership. No coins or cache tokens are synthesized from legacy points.
5. Enable only NEXUS_ECONOMY_IDENTITY_LINKS_ENABLED on the isolated validation
   deployment. Financial and fulfillment flags remain false.
6. Issue a Discord challenge, redeem through the authenticated RewardsAscended
   webhook, and verify the same Discord and EOS resolve to one economic identity.
   Confirm the migrated points balance. Repeat the callback and restart both
   processes; confirm no extra identity, wallet, debit or reward.
7. Attempt conflicting EOS ownership and altered/expired proofs. Confirm rejection.
   Confirm disabled economic identities stay disabled. Verify wallet spend returns
   a disabled response and no purchase action or ARK reward is sent.
8. Before live relink is called complete, verify revocation/unlink handling across
   the identity store and Postgres. The current relink API only adds verified links;
   it is not an account-transfer or wallet-merge API. Do not use legacy unlink as a
   substitute for a coordinated Postgres revocation.

## Shop validation after live relink

PRs 639/641/643/645/646 supply intake, claim, debit intent/executor and fulfillment
intent. Their tests are now in `tests/`, where npm test runs them. PRs 640/642/644
supply request redaction and routing guards. All are incorporated in PR 638's branch.

The active Postgres shop commits the debit, order and outbox together. Its fulfillment
runtime must not debit a second time using the separate debit-stage helper. Retry a
purchase with the same key after the balance falls below the price: it must return
the original order. Changing the purchase under that key must fail.

Before delivery, the runtime rechecks the verified economic identity and matching
persisted debit and resolves the EOS player's current eligible server. Validate this
against the actual RewardsAscended installation. Offline players may retry before
sending; ambiguous sends must remain held for manual reconciliation. Never reset a
running or SENT_UNCONFIRMED action to requested without server-side receipt evidence.

DINO_CACHE_TOKENS, NEXUS_POINTS and NEXUS_COINS are separate wallets. One cache token
redemption must debit once, persist its sealed roll, and never reroll on retry. The
legacy Dino Cache ArkShop/MySQL and token-journal paths have not been cut over by this
change. Keep those purchases and fulfillment disabled until their existing balances,
sealed rolls, receipts and token claims are reconciled with the new authority.

## Rollback

Disable financial and fulfillment flags first. Drain workers and preserve all
orders, ledger and ambiguous delivery receipts. A code rollback must not restore an
old wallet snapshot over new financial activity. Return to legacy authority only
after reconciliation proves no double spend or lost receipt can occur.
