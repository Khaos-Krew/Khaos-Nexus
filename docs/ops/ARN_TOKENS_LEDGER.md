# ARN tokens on the main ledger

Live credits, spends, refunds, staff adjustments, and the pause switch use the main economy ledger. Currency is `ARN_TOKENS`. Drop source is `arn_drop`. Cache spends use `arn_cache`. Staff adjustments use `arn_adjust`. The worker reads `ARN_DRY_RUN`, `ARN_TOKENS_ENABLED`, `ARN_ECONOMY_WRITES_ENABLED`, `ARN_ROTATION_SECRET`, and the per-type drop flags from its own environment. A request cannot set those flags, the odds roll, or the draw seed. `NEXUS_ECONOMY_WRITES_ENABLED` does not open ARN writes. `ARN_ECONOMY_WRITES_ENABLED` defaults off and is required. `ARN_TOKENS_ENABLED` defaults off and gates credits, spends, refunds, and adjustments.

The worker does not apply schema changes on boot, and it does not drop or rebuild CHECK constraints. It does not read `arn-dry-run.json` and does not replay that journal into the ledger.

## 1. Additive migrations

`db/migrations/003-arn-tokens-events.sql` creates `nexus_economy_arn_events` and its feed index. The runner records `arn-tokens-main-ledger-currency`.

`db/migrations/005-arn-tokens-control.sql` creates `nexus_economy_arn_control` for the pause switch. The runner records `arn-tokens-control`. Pause is not a ledger row: ledger amounts must be non-zero. An empty control table means earning is not paused.

`db/migrations/006-arn-tokens-migration-holds.sql` creates `nexus_economy_arn_migration_holds`. The runner records `arn-tokens-legacy-holds`. Creating the table does not move balances. The staff balance script is separate and is not part of this runner.

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

Run the additive runner first. Do not start live ARN credits until the currency check has also been applied on that database.

## Draw secret

Live draws and live odds rolls require `ARN_ROTATION_SECRET` of at least 32 characters, and that value cannot be the public rotation constant. A missing secret fails closed. The public constant and `NEXUS_DINO_CACHE_RNG_SECRET` are used only while credits are still in dry run.

## Game event key

A live credit is idempotent on tribe, dino, event type, and the in-game timestamp or id (`arn-drop:<kind>|<tribe>|<dino>|<event id>`). The Discord message id is stored on the ledger metadata and is not the idempotency key. A report that lacks any of those parts is `event-unkeyed` and writes nothing. The Shiny marker still uses the documented tokens. Optional extra marker fields or embed fields named Tribe and Id can carry the tribe and event id.

## Caps

Inside the award transaction, after the advisory lock, the worker reads `SELECT NOW()` and counts ARN drop credits for that identity in the America/Chicago day and week. The day cap is 3. The week cap is 10, from Monday 00:00 CT.

## Spend, delivery, and replay

Spend resolves the player through the verified EOS link and returns that EOS id. Redeem passes that id into delivery. A request EOS id is not used. Refund requires exactly one prior `arn_cache` debit for that order, with the same identity, and credits the opposite of that debit once. A request amount or identity is ignored. A delivered order is not refunded.

A repeat spend of an order that was debited but not delivered returns the same EOS id so delivery can continue. After a successful delivery the bot writes `arn-deliver:<orderId>` on `nexus_economy_arn_events`. `POST /arn/reconcile` refunds unconfirmed spends older than 15 minutes, once each. A confirmed delivery is left alone.

## Staff

`/arn configure` and `/arn pause` write `nexus_economy_arn_control`. `/arn adjust` writes `ARN_TOKENS` on the main ledger for the verified EOS identity. These commands do not open the retired MySQL ARN wallet.

## Legacy MySQL balances

Legacy MySQL ARN balances move onto `ARN_TOKENS` once, 1-for-1. `npm run economy:arn-migrate` prints a dry-run report and writes nothing. `npm run economy:arn-migrate -- --apply` writes, and only when `ARN_ECONOMY_WRITES_ENABLED` is true. `ARN_DRY_RUN` and `ARN_TOKENS_ENABLED` do not block that command. Boot, the economy worker, and the SQL runner do not call it.

Apply the additive SQL first so the hold table exists:

```sh
node scripts/apply-economy-sql-migrations.cjs
node scripts/migrate-legacy-arn-balances.cjs
ARN_ECONOMY_WRITES_ENABLED=true node scripts/migrate-legacy-arn-balances.cjs --apply
```

Each positive `nexus_arn_wallets.balance` becomes one main-ledger credit. Source is `arn_migrate`. The idempotency key is `arn-migrate:<econId>`. Metadata reason is `arn_migrate`. The economic identity is the Discord link plus one verified EOS identity. Several verified EOS ids on that same identity still count as one. Zero balances are skipped. A Discord wallet with no verified EOS link gets a pending row in `nexus_economy_arn_migration_holds`. Run the same command again after the member verifies. The stored hold amount is credited once. A later MySQL balance change does not replace it.

An invalid balance, more than one economic identity, or an `arn-migrate` key that already belongs to a different Discord id blocks the whole apply. Nothing is written and the MySQL wallet stays writable.

A successful apply, including one that only stores pending holds, freezes MySQL ARN wallet writes. The script creates `nexus_arn_wallet_freeze` and sets `read_only`. Balance and history reads still work. Wallet changes, configure, adjust, and participation sync refuse with `ARN_WALLET_READ_ONLY`. Running `--apply` again is idempotent: existing keys are duplicates, pending holds credit once, and the freeze is set again.

The command reads MySQL even when ArkShop is retired. It requires `ARKSHOP_DB_HOST`, `ARKSHOP_DB_NAME`, `ARKSHOP_DB_USER`, and `ARKSHOP_DB_PASSWORD`. It does not open `ArnTokenLedger`.
