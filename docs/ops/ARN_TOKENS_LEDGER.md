# ARN tokens on the main ledger

Live credits, spends, and refunds use `nexus_economy_wallets` and `nexus_economy_ledger` with currency `ARN_TOKENS`. The economy worker reads `ARN_DRY_RUN`, `NEXUS_ECONOMY_WRITES_ENABLED`, `ARN_ECONOMY_WRITES_ENABLED`, and the per-type drop flags from its own environment. Callers do not send an environment object.

The worker does not apply this change on boot, and it does not drop or rebuild CHECK constraints.

## 1. Additive migration

`db/migrations/003-arn-tokens-events.sql` creates `nexus_economy_arn_events` and its feed index. It is applied by the economy SQL migration runner, which records `arn-tokens-main-ledger-currency` in `nexus_economy_schema_migrations` and skips a later run.

```sh
node scripts/apply-economy-sql-migrations.cjs
```

`NEXUS_ECONOMY_DATABASE_URL` or `DATABASE_URL` is required. The runner refuses any statement that drops a constraint or alters a table.

## 2. Currency check, separate operator step

Fresh installs already allow `ARN_TOKENS` in the wallet, ledger, and order `CREATE TABLE` statements. A database created before that change still has a CHECK that rejects `ARN_TOKENS`.

Widen it only with `db/migrations/004-arn-tokens-currency-check.sql`. That file is not part of the runner and is not invoked on worker boot. For each currency CHECK on `nexus_economy_wallets`, `nexus_economy_ledger`, and `nexus_economy_orders` that lists `NEXUS_POINTS` and does not yet list `ARN_TOKENS`, it drops that constraint, adds the wider check `NOT VALID`, then `VALIDATE CONSTRAINT`.

```sh
psql "$NEXUS_ECONOMY_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004-arn-tokens-currency-check.sql
```

Run step 1 first. Do not start live ARN credits until both steps have been applied on that database.

## Draw secret

Live draws require `ARN_ROTATION_SECRET` of at least 32 characters. A missing secret fails closed. The public rotation constant is only used while credits are still in dry run.
