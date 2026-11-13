'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { arkEnabled, arnEnabled } = require('../src/shared/ark-switch.cjs');

test('ARK switch defaults on and only turns off for explicit false values', () => {
  assert.equal(arkEnabled({}), true);
  assert.equal(arkEnabled({ NEXUS_ARK_ENABLED: '' }), true);
  assert.equal(arkEnabled({ NEXUS_ARK_ENABLED: 'true' }), true);
  for (const value of ['false', 'FALSE', '0', 'no', 'off', ' off ']) {
    assert.equal(arkEnabled({ NEXUS_ARK_ENABLED: value }), false, value);
  }
});

test('ARN follows the ARK switch and its own switch', () => {
  assert.equal(arnEnabled({}), true);
  assert.equal(arnEnabled({ NEXUS_ARK_ENABLED: 'false' }), false);
  assert.equal(arnEnabled({ NEXUS_ARN_ENABLED: 'false' }), false);
  assert.equal(arnEnabled({ NEXUS_ARK_ENABLED: 'false', NEXUS_ARN_ENABLED: 'true' }), false);
});

test('entry gates ARK monitors and ARN behind the switch; hands-off features stay ungated', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  const arkBlock = source.slice(source.indexOf('if (arkEnabled()) {'), source.indexOf('} else {', source.indexOf('if (arkEnabled()) {')));
  for (const name of ['ark-economy-presence-extension', 'ark-config-drift-alert-extension', 'ark-cluster-metadata-extension', 'ark-shiny-config-runtime', 'ark-dynamic-config-http', 'ark-identity-webhook-http']) {
    assert.match(arkBlock, new RegExp(name), name);
  }
  const arnBlock = source.slice(source.indexOf('if (arnEnabled()) {'), source.indexOf('} else {', source.indexOf('if (arnEnabled()) {')));
  assert.match(arnBlock, /installArnLiveBoardExtension/);
  for (const name of ['temp-voice-extension', 'skyblock-store-extension', 'craft-module-extension', 'minecraft-curseforge-tracker', 'coin-shop-ui', 'mc-shop-ui-extension']) {
    assert.ok(source.includes(name), name);
    assert.ok(!arkBlock.includes(name) && !arnBlock.includes(name), `${name} must not be gated`);
  }
});

test('ARN markdown strip lives in the parser source, not a load-time patch', () => {
  const live = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/arn-live-board-extension.cjs'), 'utf8');
  assert.match(live, /\.replace\(\/\\\*\{1,3\}\/g, ''\)/);
  const patch = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/arn-parser-runtime-patch.cjs'), 'utf8');
  assert.doesNotMatch(patch, /_compile/);
});
