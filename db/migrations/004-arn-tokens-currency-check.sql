-- Operator step. Do not run this from the economy worker boot path, and do not
-- include it in scripts/apply-economy-sql-migrations.cjs.
--
-- Existing databases created before ARN_TOKENS reject that currency in the
-- CHECK constraints on nexus_economy_wallets, nexus_economy_ledger, and
-- nexus_economy_orders. Fresh CREATE TABLE statements already allow it.
-- This step drops only a currency check that does not already list ARN_TOKENS,
-- adds the wider check NOT VALID, then VALIDATE CONSTRAINT.
--
-- Run it in one session, after 003-arn-tokens-events.sql, before live credits:
--   psql "$NEXUS_ECONOMY_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/004-arn-tokens-currency-check.sql

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname AS schema_name, t.relname AS table_name, c.conname, pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema()
      AND t.relname IN ('nexus_economy_wallets', 'nexus_economy_ledger', 'nexus_economy_orders')
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%currency%'
      AND pg_get_constraintdef(c.oid) LIKE '%NEXUS_POINTS%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%ARN_TOKENS%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', rec.schema_name, rec.table_name, rec.conname);
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I CHECK (currency IN (''NEXUS_COINS'',''NEXUS_POINTS'',''DINO_CACHE_TOKENS'',''ARN_TOKENS'')) NOT VALID',
      rec.schema_name, rec.table_name, rec.conname
    );
    EXECUTE format('ALTER TABLE %I.%I VALIDATE CONSTRAINT %I', rec.schema_name, rec.table_name, rec.conname);
  END LOOP;
END $$;
