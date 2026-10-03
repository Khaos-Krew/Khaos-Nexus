# Legacy bank flat credit

One-shot operator runbook for `legacy-bank-flat-2026-10`. The shop writes flag does not enable this run. Two gates must both be on for any write: `NEXUS_LEGACY_BANK_FLAT_ENABLED=true` and, for execute, `NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH` set to the dry-run hash. Both default off. Dry-run does not need the flag. It does not create tables, insert the mint, or write ledger rows.

The mint account is `system:mint:legacy-bank-flat`, status `system`. Each grant books +1,500 on the member and −1,500 on the mint. Member wallets still cannot go negative. The mint is not a member and is left out of balance sums, leaderboards, and reports.

Economy-worker and Sentinal startup do not alter wallet, ledger, or identity checks. The mint exemption is a migration that runs only from `--execute`, and only when `NEXUS_LEGACY_BANK_FLAT_ENABLED` is on. It takes one transaction, sets `lock_timeout` to 5 seconds, takes the advisory lock `nexus-economy:system-mint-balance-checks`, and is idempotent: if the exempting check already exists it does nothing. Otherwise it `DROP CONSTRAINT IF EXISTS` the strict check and adds the new check `NOT VALID`, then `VALIDATE CONSTRAINT`. Only `economic_identity_id LIKE 'system:mint:%'` may go negative. Member checks stay `balance >= 0` and `balance_after >= 0`. A compiled cap (`MAX_LEGACY_FLAT_GRANTS`, 4096 grants) refuses a larger N or total even when `--approved-count` / `--approved-total` are higher.

## Dry-run

```sh
node scripts/legacy-bank-flat.cjs --dry-run --operator NAME --out /tmp/legacy-bank-flat
```

Read the eligible count N, the total N×1500, the full hash, and every held row. The hash covers only identities that were eligible at the frozen snapshot `2026-10-03T01:14:00.000Z`. A signup or link after that snapshot does not change the hash. Do not treat concept approval as list approval. The owner sets the hash env only after reviewing this list.

## Execute

```sh
NEXUS_LEGACY_BANK_FLAT_ENABLED=true \
NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH=<hash> \
node scripts/legacy-bank-flat.cjs --execute --operator NAME --approval REF --approved-count N --approved-total TOTAL
```

A completed marker refuses every later run. After reconcile, unset both env vars.

## Partial batch that fails closed after data changed

If execute stops with the marker still incomplete (`completed_at` is null), some grants may already exist. Keys `legacy-bank-flat:<econId>` that were written are no-ops on a re-run. Do not delete the marker, the ledger rows, or the mint.

1. Leave `NEXUS_LEGACY_BANK_FLAT_APPROVED_HASH` set to the original approved hash. Do not point it at a newly computed hash while the marker is incomplete. Execute compares the stored hash to the list recomputed from the database and refuses on a mismatch, which writes no further grants.
2. Run dry-run again and diff it against the approved list. Note who was paid (ledger key present), who was skipped inside the lock, and what changed (status, link time, or denylist).
3. If the change was accidental and the approved snapshot facts can be restored, restore them and re-run execute with the same hash, the same N and total, and the flag still on. Existing keys do not pay twice. `completed_at` is set only when member credits and the contra balance net to zero.
4. If the change is real and must stand, stop. The incomplete marker stays the lock. Do not start a second batch name, do not hand-edit balances, and do not unset the hash in order to force a new list through the open marker. The owner decides, in writing, who was already paid and who must not be paid. A wrong credit that is still unspent is reversed with `--reverse --confirm-reverse` (the flag must be on). A credit that was already spent is flagged with `--flag-spent` and is not clawed back.
5. Reconcile before calling the batch finished: member sum of `legacy_bank_flat` amounts, including reversals, equals the negation of the contra sum, and the mint balance equals that contra sum. Only then is `completed_at` set by a successful execute.

## Reversal

```sh
NEXUS_LEGACY_BANK_FLAT_ENABLED=true \
node scripts/legacy-bank-flat.cjs --reverse --confirm-reverse --operator NAME --econ ECON_ID
```

Reversal refuses when the original `legacy-bank-flat:<econId>` credit is missing or was already reversed. It also refuses, and flags the row, when the member balance is below 1,500. A successful reversal debits the member 1,500 and moves the contra 1,500 back toward zero.
