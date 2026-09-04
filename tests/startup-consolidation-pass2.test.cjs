'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  INITIAL_DELAY_MS,
  REFRESH_MS,
  startArkClusterMetadataMonitor,
  bindMetadataInteractions
} = require('../src/sentinel/ark-cluster-metadata-extension.cjs');
const { runStaffNameColorPreview } = require('../src/sentinel/staff-name-color-preview-extension.cjs');

const ROOT = path.resolve(__dirname, '..');

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

test('second startup consolidation removes private ClientReady listeners from coordinated systems', () => {
  for (const relative of [
    'src/sentinel/forge-auth-probe-extension.cjs',
    'src/sentinel/staff-name-color-preview-extension.cjs',
    'src/sentinel/ark-cluster-metadata-extension.cjs'
  ]) {
    const text = source(relative);
    assert.equal(text.includes('Events.ClientReady'), false, `${relative} must use the startup coordinator instead of a private ClientReady listener`);
    assert.equal(text.includes('registerStartupTask'), true, `${relative} must register through the startup coordinator`);
  }
});

test('ARK cluster metadata keeps the same startup and periodic cadence after consolidation', () => {
  const scheduled = [];
  const handle = () => ({ unref() {} });
  const client = {};
  const runMetadata = async () => {};
  startArkClusterMetadataMonitor(client, runMetadata, {
    setTimeoutFn(fn, delay) {
      scheduled.push({ type: 'timeout', fn, delay });
      return handle();
    },
    setIntervalFn(fn, delay) {
      scheduled.push({ type: 'interval', fn, delay });
      return handle();
    }
  });
  assert.deepEqual(scheduled.map(({ type, delay }) => ({ type, delay })), [
    { type: 'timeout', delay: INITIAL_DELAY_MS },
    { type: 'interval', delay: REFRESH_MS }
  ]);
});

test('ARK cluster metadata interaction binding remains direct and idempotent', () => {
  const listeners = [];
  const client = { on(event, handler) { listeners.push({ event, handler }); } };
  const runMetadata = async () => {};
  assert.equal(bindMetadataInteractions(client, runMetadata), true);
  assert.equal(bindMetadataInteractions(client, runMetadata), false);
  assert.equal(listeners.length, 1);
});

test('staff name-color preview fails closed when no Discord guild is configured', async () => {
  let fetched = false;
  const result = await runStaffNameColorPreview({ guilds: { fetch: async () => { fetched = true; } } }, { discord: {} });
  assert.equal(result.skipped, 'guild-not-configured');
  assert.equal(fetched, false);
});
