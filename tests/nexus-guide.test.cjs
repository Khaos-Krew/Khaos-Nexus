'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  GUIDE_CONFIG_PATH,
  loadGuideConfig,
  validateGuideConfig,
  buildGuideOverviewEmbed,
  buildTopicEmbed,
  buildGuideComponents
} = require('../src/sentinel/nexus-guide-extension.cjs');

const FORBIDDEN_PUBLIC_FEATURES = [
  /dino\s*caches?/i,
  /nexus\s*anomal(?:y|ies)/i
];

const FORBIDDEN_PUBLIC_ADMIN_TEXT = [
  /\/ark\s+restart/i,
  /\/ark\s+shutdown/i,
  /rollback/i,
  /rcon\s+password/i,
  /serveradminpassword/i
];

test('Nexus guide config is valid and within Discord menu limits', () => {
  const guide = loadGuideConfig();
  assert.equal(validateGuideConfig(guide), true);
  assert.ok(guide.topics.length > 0);
  assert.ok(guide.topics.length <= 25);
  assert.equal(new Set(guide.topics.map((topic) => topic.id)).size, guide.topics.length);
});

test('public Nexus guide does not advertise unvalidated features', () => {
  const raw = fs.readFileSync(GUIDE_CONFIG_PATH, 'utf8');
  for (const pattern of FORBIDDEN_PUBLIC_FEATURES) {
    assert.doesNotMatch(raw, pattern);
  }
});

test('public Nexus guide does not expose staff-only ARK controls or secrets', () => {
  const raw = fs.readFileSync(GUIDE_CONFIG_PATH, 'utf8');
  for (const pattern of FORBIDDEN_PUBLIC_ADMIN_TEXT) {
    assert.doesNotMatch(raw, pattern);
  }
});

test('public command guidance contains only the intended player ARK commands', () => {
  const guide = loadGuideConfig();
  const commands = guide.topics.find((topic) => topic.id === 'game-hubs-commands');
  assert.ok(commands, 'game-hubs-commands topic must exist');
  const text = [commands.summary, ...commands.details].join('\n');
  for (const command of ['/ark status', '/ark players', '/ark servers', '/ark mods', '/ark tame', '/guide']) {
    assert.match(text, new RegExp(command.replace('/', '\\/').replace(' ', '\\s+'), 'i'));
  }
});

test('every public guide topic renders a Discord-safe embed and selector', () => {
  const guide = loadGuideConfig();
  const overview = buildGuideOverviewEmbed(guide).toJSON();
  assert.ok(overview.title.length <= 256);
  assert.ok(overview.description.length <= 4096);
  const rows = buildGuideComponents(guide);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].toJSON().components[0].options.length, guide.topics.length);

  for (const topic of guide.topics) {
    const embed = buildTopicEmbed(topic).toJSON();
    assert.ok(embed.title.length <= 256);
    assert.ok(embed.description.length <= 4096);
  }
});
