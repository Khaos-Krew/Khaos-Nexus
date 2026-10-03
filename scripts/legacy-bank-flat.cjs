'use strict';

const fs = require('node:fs');
const { Pool } = require('pg');
const flat = require('../src/economy-worker/legacy-bank-flat.cjs');

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] || '';
}

function has(name) {
  return process.argv.includes(name);
}

function databaseUrl() {
  return String(process.env.NEXUS_ECONOMY_DATABASE_URL || process.env.DATABASE_URL || '').trim();
}

async function main() {
  const url = databaseUrl();
  if (!url) {
    console.error('legacy-bank-flat: database url is not set');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: url, max: 3 });
  const schema = String(process.env.NEXUS_ECONOMY_SCHEMA || 'public').trim() || 'public';
  try {
    if (has('--dry-run')) {
      const result = await flat.dryRun({ pool, schema, operator: arg('--operator') });
      if (!result.ok) {
        console.error(`legacy-bank-flat: ${result.reason}`);
        process.exitCode = 1;
        return;
      }
      const out = arg('--out');
      if (out) {
        const base = out.replace(/\.(json|csv)$/i, '');
        const artifact = {
          snapshotAt: result.snapshotAt,
          batchName: result.batchName,
          operator: result.operator,
          eligibleCount: result.eligibleCount,
          total: result.total,
          hash: result.hash,
          denylistHash: result.denylistHash,
          rows: result.rows
        };
        fs.writeFileSync(`${base}.json`, `${JSON.stringify(artifact, null, 2)}\n`);
        fs.writeFileSync(`${base}.csv`, result.csv);
      }
      const held = result.rows.filter((row) => row.skipReason === 'duplicate_human' || row.duplicateHuman);
      console.log(`snapshotAt=${result.snapshotAt}`);
      console.log(`batch=${result.batchName}`);
      console.log(`eligible=${result.eligibleCount}`);
      console.log(`total=${result.total}`);
      console.log(`hash=${result.hash}`);
      console.log(`held=${held.length}`);
      for (const row of held) {
        console.log(`held econ=${row.econId} skip=${row.skipReason || 'flagged'} discord=${row.discordUserId}`);
      }
      console.log('Held rows are not paid. Copy the hash only after the owner approves this list.');
      return;
    }
    if ((has('--execute') || has('--reverse') || has('--flag-spent')) && !flat.legacyBankFlatEnabled()) {
      console.error('legacy-bank-flat: NEXUS_LEGACY_BANK_FLAT_ENABLED is off');
      process.exitCode = 1;
      return;
    }
    if (has('--execute')) {
      const result = await flat.execute({
        pool,
        schema,
        operator: arg('--operator'),
        approvalRef: arg('--approval'),
        approvedCount: Number(arg('--approved-count')),
        approvedTotal: Number(arg('--approved-total'))
      });
      const safe = {
        ok: result.ok === true,
        reason: result.reason || '',
        credited: result.credited || 0,
        skipped: result.skipped || 0,
        noop: result.noop || 0
      };
      console.log(JSON.stringify(safe));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (has('--flag-spent')) {
      const result = await flat.flagSpentCredit({ pool, schema, econId: arg('--econ'), operator: arg('--operator'), env: process.env });
      console.log(JSON.stringify({ ok: result.ok === true, flagged: result.flagged === true, reversed: false }));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    if (has('--reverse')) {
      const result = await flat.reverseCredit({
        pool,
        schema,
        econId: arg('--econ'),
        operator: arg('--operator'),
        confirm: has('--confirm-reverse'),
        env: process.env
      });
      console.log(JSON.stringify({
        ok: result.ok === true,
        reason: result.reason || '',
        reversed: result.reversed === true,
        flagged: result.flagged === true
      }));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    console.error('legacy-bank-flat: use --dry-run, --execute, --flag-spent, or --reverse');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`legacy-bank-flat: ${String(error?.message || error).slice(0, 200)}`);
  process.exitCode = 1;
});
