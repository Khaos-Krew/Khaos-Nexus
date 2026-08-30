'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { version: packageVersion } = require('../package.json');
const {
  forgeIntegrationVersion,
  logForgeDiscordBridgeInstalled
} = require('../src/sentinel/forge-startup-log.cjs');

test('Forge startup diagnostic confirms bridge installation with the current integration version', () => {
  const logs = [];
  logForgeDiscordBridgeInstalled({
    log(message) { logs.push(message); }
  });

  assert.equal(forgeIntegrationVersion, packageVersion);
  assert.deepEqual(logs, [
    `[Nexus Sentinal] Forge Discord bridge installed (integration v${packageVersion}).`
  ]);
});
