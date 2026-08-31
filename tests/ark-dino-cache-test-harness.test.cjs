'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runOwnerCacheTest, loadJournal } = require('../src/sentinel/ark-dino-cache-test-harness.cjs');

test('owner cache test persists its roll before no-charge Dino Ball delivery', async () => {
  const prior = { ...process.env };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cache-test-'));
  const file = path.join(dir, 'journal.json');
  process.env.NEXUS_DINO_CACHE_TEST_MODE = 'true';
  process.env.ARK_GEN1_OWNER_EOS_ID = 'OWNER_EOS_12345';
  process.env.NEXUS_DINO_CACHE_RNG_SECRET = '0123456789abcdef0123456789abcdef';
  try {
    let observed;
    const result = await runOwnerCacheTest({ cacheId: 'coastal', eosId: 'OWNER_EOS_12345', approved: true, file, rcon: { execute: async (command) => { observed = loadJournal(file).records.at(-1); assert.match(command, /^ScriptCommand SpawnDinoInBall /); return 'Success'; } } });
    assert.equal(observed.state, 'DELIVERING');
    assert.equal(observed.pointCost, 0);
    assert.equal(result.state, 'DELIVERED');
    assert.equal(result.roll.shiny, false);
  } finally { process.env = prior; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('owner cache test rejects unapproved or non-owner delivery', async () => {
  const prior = { ...process.env };
  process.env.NEXUS_DINO_CACHE_TEST_MODE = 'true'; process.env.ARK_GEN1_OWNER_EOS_ID = 'OWNER_EOS_12345';
  try {
    await assert.rejects(runOwnerCacheTest({ cacheId: 'coastal', eosId: 'OWNER_EOS_12345', approved: false, rcon: { execute: async () => 'ok' } }), /approved=true/);
    await assert.rejects(runOwnerCacheTest({ cacheId: 'coastal', eosId: 'SOMEONE_ELSE_123', approved: true, rcon: { execute: async () => 'ok' } }), /owner EOS/);
  } finally { process.env = prior; }
});
