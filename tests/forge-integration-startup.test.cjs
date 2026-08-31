'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FORGE_INTEGRATION_VERSION,
  forgeIntegrationStartupText,
  logForgeIntegrationInstalled
} = require('../src/sentinel/forge-integration-startup.cjs');
const { version: packageVersion } = require('../package.json');

test('Forge startup diagnostic confirms bridge installation with the current integration version', () => {
  const logs = [];
  logForgeIntegrationInstalled({
    log(message) { logs.push(message); }
  });

  assert.equal(FORGE_INTEGRATION_VERSION, packageVersion);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Forge Discord bridge installed/);
  assert.match(logs[0], new RegExp(`integration version ${packageVersion.replace(/\./g, '\\.')}`));
  assert.equal(logs[0], forgeIntegrationStartupText());
});
