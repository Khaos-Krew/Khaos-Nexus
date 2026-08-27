'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FUNCTIONAL_ROLE } = require('../bot/sentinel-permissions.cjs');
const { adminCommandCatalog, renderAdminCommandPanel } = require('../bot/sentinel-admin-surface.cjs');

test('admin catalog derives from executable command policy and excludes member/D&D surfaces', () => {
  const catalog = adminCommandCatalog();
  const names = catalog.map((entry) => entry.name);

  assert.ok(names.includes('saveworld'));
  assert.ok(names.includes('forcestop'));
  assert.ok(names.includes('rcon'));
  assert.equal(names.includes('status'), false);
  assert.equal(names.includes('campaign'), false);
  assert.equal(names.includes('roll'), false);
});

test('owner-only commands retain configured owner identity requirement in admin catalog', () => {
  const catalog = adminCommandCatalog();
  for (const name of ['ban', 'unban', 'shutdown', 'forcestop', 'rcon']) {
    const command = catalog.find((entry) => entry.name === name);
    assert.equal(command.requiredFunctionalRole, FUNCTIONAL_ROLE.OWNER);
    assert.equal(command.ownerIdentityRequired, true);
    assert.equal(command.highRisk, true);
  }
});

test('admin panel excludes Thora and marks owner-risk commands without enabling mentions', () => {
  const payload = renderAdminCommandPanel();
  const text = JSON.stringify(payload);

  assert.doesNotMatch(text, /thora/i);
  assert.match(text, /\/rcon/);
  assert.match(text, /Owner identity required/);
  assert.match(text, /⚠️/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('disabled modules disappear from the generated admin surface automatically', () => {
  const catalog = adminCommandCatalog({ isModuleEnabled: (moduleId) => moduleId !== 'game-server-control' });
  const names = catalog.map((entry) => entry.name);
  assert.equal(names.includes('saveworld'), false);
  assert.equal(names.includes('forcestop'), false);
  assert.ok(names.includes('managerrestart'));
});
