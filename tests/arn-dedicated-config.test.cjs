'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadArnDedicatedConfig,
  validateArnDedicatedConfig,
  safeConfigSummary
} = require('../src/arn/dedicated-config.cjs');

const MANAGED = [
  'ARN_MODE', 'ARN_CUTOVER_READY', 'ARN_DISCORD_TOKEN', 'ARN_DISCORD_APPLICATION_ID',
  'ARN_DISCORD_CLIENT_ID', 'ARN_DISCORD_GUILD_ID', 'ARN_PUBLIC_CHANNEL_ID',
  'ARN_INGEST_CHANNEL_ID', 'ARN_RECONCILE_INTERVAL_MS', 'ARN_DATABASE_URL',
  'ARN_SENTINAL_JOB_ENDPOINT', 'ARN_SENTINAL_JOB_SECRET', 'ARN_CLEANUP_SENTINAL_PANELS'
];

function withEnv(values, fn) {
  const original = Object.fromEntries(MANAGED.map((key) => [key, process.env[key]]));
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, values);
  try { return fn(); } finally {
    for (const key of MANAGED) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

test('dedicated ARN defaults to safe shadow mode', () => withEnv({}, () => {
  const config = loadArnDedicatedConfig();
  assert.equal(config.mode, 'shadow');
  const result = validateArnDedicatedConfig(config);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.sort(), ['ARN_DISCORD_GUILD_ID', 'ARN_DISCORD_TOKEN'].sort());
}));

test('active mode is cutover gated and requires channel IDs', () => withEnv({
  ARN_MODE: 'active',
  ARN_DISCORD_TOKEN: 'test-token',
  ARN_DISCORD_GUILD_ID: '123'
}, () => {
  const result = validateArnDedicatedConfig(loadArnDedicatedConfig());
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('ARN_PUBLIC_CHANNEL_ID'));
  assert.ok(result.missing.includes('ARN_INGEST_CHANNEL_ID'));
  assert.ok(result.missing.includes('ARN_CUTOVER_READY=true'));
}));

test('active mode validates once explicit cutover values exist', () => withEnv({
  ARN_MODE: 'active',
  ARN_CUTOVER_READY: 'true',
  ARN_DISCORD_TOKEN: 'test-token',
  ARN_DISCORD_GUILD_ID: '123',
  ARN_PUBLIC_CHANNEL_ID: '456',
  ARN_INGEST_CHANNEL_ID: '789'
}, () => {
  const config = loadArnDedicatedConfig();
  assert.equal(validateArnDedicatedConfig(config).ok, true);
  const summary = safeConfigSummary(config);
  assert.equal(summary.cutoverReady, true);
  assert.equal('token' in summary, false);
  assert.equal('jobSecret' in summary, false);
}));

test('invalid mode fails closed to shadow', () => withEnv({ ARN_MODE: 'banana' }, () => {
  assert.equal(loadArnDedicatedConfig().mode, 'shadow');
}));
