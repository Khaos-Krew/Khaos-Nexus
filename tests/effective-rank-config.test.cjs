'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { effectiveRankConfig, adminRankSettings } = require('../src/sentinel/effective-rank-config.cjs');

const base = {
  discord: {
    guildId: 'guild-1',
    rankRoles: { 'cipher-runner': 'static-role', 'nexus-raider': 'static-raider' },
    rankSkus: { 'cipher-runner': ['static-sku'], 'nexus-raider': ['static-raider-sku'] }
  },
  modules: { ark: { enabled: true } }
};

test('effective rank config overlays accepted runtime mappings without changing unrelated config', () => {
  const effective = effectiveRankConfig(base, {
    rankRoles: { 'cipher-runner': 'runtime-role' },
    rankSkus: { 'cipher-runner': ['runtime-sku'] }
  });
  assert.equal(effective.discord.guildId, 'guild-1');
  assert.equal(effective.discord.rankRoles['cipher-runner'], 'runtime-role');
  assert.equal(effective.discord.rankRoles['nexus-raider'], 'static-raider');
  assert.deepEqual(effective.discord.rankSkus['cipher-runner'], ['runtime-sku']);
  assert.deepEqual(effective.discord.rankSkus['nexus-raider'], ['static-raider-sku']);
  assert.equal(effective.modules.ark.enabled, true);
});

test('StateStore-like source is read at call time so setup changes do not require restart', () => {
  let settings = { rankRoles: { 'cipher-runner': 'first-role' }, rankSkus: {} };
  const state = { getAdminSettings: () => settings };
  assert.equal(effectiveRankConfig(base, state).discord.rankRoles['cipher-runner'], 'first-role');
  settings = { rankRoles: { 'cipher-runner': 'second-role' }, rankSkus: { 'cipher-runner': ['new-sku'] } };
  const second = effectiveRankConfig(base, state);
  assert.equal(second.discord.rankRoles['cipher-runner'], 'second-role');
  assert.deepEqual(second.discord.rankSkus['cipher-runner'], ['new-sku']);
});

test('accepted empty mapping values intentionally override static mappings', () => {
  const effective = effectiveRankConfig(base, {
    rankRoles: { 'cipher-runner': '' },
    rankSkus: { 'cipher-runner': [] }
  });
  assert.equal(effective.discord.rankRoles['cipher-runner'], '');
  assert.deepEqual(effective.discord.rankSkus['cipher-runner'], []);
});

test('admin rank settings safely normalizes absent sources', () => {
  assert.deepEqual(adminRankSettings(null), { rankRoles: {}, rankSkus: {} });
  assert.deepEqual(adminRankSettings({}), { rankRoles: {}, rankSkus: {} });
});
