'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachBackupIntegrity,
  backupDigest,
  validateBackupIntegrity
} = require('../shared/sentinel-backup-integrity.cjs');

function sample() {
  return {
    format: 'khaos-nexus-backup',
    formatVersion: 2,
    appVersion: '0.33.0',
    config: { schemaVersion: 3, general: {}, discord: {}, monitor: {}, servers: [] },
    encryptedSecrets: 'ZmFrZQ=='
  };
}

test('new Sentinel backup carries deterministic SHA-256 integrity', () => {
  const base = sample();
  const payload = attachBackupIntegrity(base);
  assert.equal(payload.product.id, 'nexus-sentinel');
  assert.equal(payload.product.scope, 'discord-palworld');
  assert.equal(payload.integrity.algorithm, 'sha256');
  assert.equal(payload.integrity.digest, backupDigest(base));
  assert.equal(validateBackupIntegrity(payload).valid, true);
});

test('tampered backup fails integrity validation', () => {
  const payload = attachBackupIntegrity(sample());
  payload.config.discord.ownerUserId = 'tampered';
  const result = validateBackupIntegrity(payload);
  assert.equal(result.valid, false);
  assert.match(result.reason, /SHA-256/);
});

test('legacy v2 backup without integrity remains import-compatible', () => {
  const result = validateBackupIntegrity(sample());
  assert.equal(result.valid, true);
  assert.equal(result.legacy, true);
});
