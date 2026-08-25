'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { MODULES } = require('../src/backend/modules/catalog.cjs');
const { LAYOUTS } = require('../src/sentinel/module-layouts.cjs');
const { ROADMAP_GAME_MODULES, registerRoadmapGameModules } = require('../src/sentinel/roadmap-game-module-registry.cjs');
const {
  RETIRED_GAMES_MARKER_PREFIX,
  isRetiredGamesSelfRoleMessage,
  findRolesChannel
} = require('../src/sentinel/retired-games-self-role-cleanup.cjs');

function fakeTextChannel(id, name) {
  return { id, name, isTextBased: () => true };
}

test('roadmap module registry adds 7 Days to Die, Conan Exiles, and Destiny 2 once', () => {
  registerRoadmapGameModules();
  registerRoadmapGameModules();
  for (const definition of ROADMAP_GAME_MODULES) {
    const matching = MODULES.filter((module) => module.id === definition.id);
    assert.equal(matching.length, 1, `${definition.id} should be registered exactly once`);
    assert.ok(LAYOUTS[definition.id], `${definition.id} should have a Discord layout`);
    assert.equal(LAYOUTS[definition.id].consoleChannel, definition.layout.consoleChannel);
  }
});

test('new roadmap modules begin access-only without advertising unavailable provider actions', () => {
  registerRoadmapGameModules();
  for (const moduleId of ['7daystodie', 'conanexiles', 'destiny2']) {
    const module = MODULES.find((item) => item.id === moduleId);
    assert.deepEqual(module.capabilities, []);
    assert.equal(module.console, true);
  }
});

test('retired Games self-role marker family is recognized only on Sentinal-authored messages', () => {
  const message = {
    author: { id: 'bot-1' },
    embeds: [{ footer: { text: `${RETIRED_GAMES_MARKER_PREFIX}-89814846:v1` } }]
  };
  assert.equal(isRetiredGamesSelfRoleMessage(message, 'bot-1'), true);
  assert.equal(isRetiredGamesSelfRoleMessage(message, 'other-bot'), false);
  assert.equal(isRetiredGamesSelfRoleMessage({ ...message, embeds: [{ footer: { text: 'nexus-sentinal:self-role:name-colors:v1' } }] }, 'bot-1'), false);
});

test('roles-channel lookup prefers explicit configured channel and otherwise adopts #roles', () => {
  const channels = new Map([
    ['1', fakeTextChannel('1', 'roles')],
    ['2', fakeTextChannel('2', 'other')]
  ]);
  assert.equal(findRolesChannel(channels, '2').id, '2');
  assert.equal(findRolesChannel(channels, '').id, '1');
});
