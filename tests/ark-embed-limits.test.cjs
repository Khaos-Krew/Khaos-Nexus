'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EMBED_LIMITS,
  embedCharacterCount,
  paginateEmbed,
  buildEmbedMessagePages
} = require('../src/sentinel/discord-embed-limits.cjs');
const { buildServerStatsPayloadPages } = require('../src/sentinel/ark-cluster-public-actions.cjs');

function makeField(index, valueLength = 1000) {
  return {
    name: `Field ${index}`,
    value: `${index}: ${'x'.repeat(Math.max(0, valueLength - String(index).length - 2))}`,
    inline: false
  };
}

test('paginates embeds below Discord aggregate character limit', () => {
  const pages = paginateEmbed({
    title: 'ARK Server Stats & Rates',
    fields: Array.from({ length: 12 }, (_, index) => makeField(index + 1))
  });
  assert.ok(pages.length > 1);
  for (const page of pages) assert.ok(embedCharacterCount(page) <= EMBED_LIMITS.totalCharacters);
});

test('uses one embed per message for multiple server embeds', () => {
  const messages = buildEmbedMessagePages([
    { title: 'Astraeos', fields: Array.from({ length: 5 }, (_, index) => makeField(index + 1)) },
    { title: 'Khaos Nexus (Gen 1)', fields: Array.from({ length: 5 }, (_, index) => makeField(index + 1)) }
  ]);
  assert.ok(messages.length >= 2);
  for (const message of messages) {
    assert.equal(message.embeds.length, 1);
    assert.ok(embedCharacterCount(message.embeds[0]) <= EMBED_LIMITS.totalCharacters);
  }
});

test('ARK stats builder splits the two-map response that previously overflowed Discord', () => {
  const largeSection = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [
    `Setting${index + 1}`,
    `Configured value ${index + 1} ${'x'.repeat(80)}`
  ]));
  const snapshot = (serverName) => ({
    serverName,
    version: '1.0.0',
    checkedAt: '2026-09-09T17:10:00.000Z',
    coreRates: largeSection,
    playerStats: largeSection,
    dinoStats: largeSection,
    breeding: largeSection,
    qualityOfLife: largeSection
  });
  const messages = buildServerStatsPayloadPages([
    snapshot('Astraeos'),
    snapshot('Khaos Nexus (Gen 1)')
  ]);
  assert.ok(messages.length >= 2);
  for (const message of messages) {
    assert.equal(message.embeds.length, 1);
    assert.ok(embedCharacterCount(message.embeds[0]) <= EMBED_LIMITS.totalCharacters);
  }
});
