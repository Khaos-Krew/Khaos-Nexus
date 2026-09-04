'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RETIRED_MODULE_IDS, isRetiredModuleId, activeSentinelModules, retireSentinelModuleRegistry } = require('../src/sentinel/retired-module-policy.cjs');
const { FEEDS } = require('../src/sentinel/event-feed.cjs');

test('Once Human is centrally retired from active Sentinal surfaces', () => {
  assert.equal(RETIRED_MODULE_IDS.has('oncehuman'), true);
  assert.equal(isRetiredModuleId('OnceHuman'), true);
  assert.deepEqual(activeSentinelModules([{ id:'oncehuman' }, { id:'ark' }]).map((item) => item.id), ['ark']);
});

test('retired modules are removed in place from the live Sentinal module registry', () => {
  const registry = [{ id: 'ark' }, { id: 'oncehuman' }, { id: 'warframe' }];
  const reference = registry;
  assert.deepEqual(retireSentinelModuleRegistry(registry), ['oncehuman']);
  assert.equal(registry, reference);
  assert.deepEqual(registry.map((item) => item.id), ['ark', 'warframe']);
  assert.deepEqual(retireSentinelModuleRegistry(registry), []);
});

test('persistent feed registry never schedules a retired module', () => {
  assert.equal(FEEDS.some((feed) => isRetiredModuleId(feed.moduleId)), false);
  assert.equal(FEEDS.some((feed) => feed.moduleId === 'oncehuman'), false);
  assert.equal(FEEDS.some((feed) => feed.moduleId === 'ark'), true);
});
