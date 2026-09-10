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

test('paginates aggregate ARK-style embed content below Discord 6000-character limit', () => {
  const embed = {
    title: '📊 Khaos Nexus • Server Stats & Rates',
    description: 'Live GameUserSettings.ini + Game.ini values',
    footer: { text: 'Sentinel live config read' },
    fields: Array.from({ length: 12 }, (_, index) => makeField(index + 1))
  };

  const pages = paginateEmbed(embed);
  assert.ok(pages.length > 1, 'large embed should be split into multiple pages');
  for (const page of pages) {
    assert.ok(page.fields.length <= EMBED_LIMITS.fields);
    assert.ok(embedCharacterCount(page) <= EMBED_LIMITS.totalCharacters);
  }
});

test('splits field values that exceed Discord field-value limit', () => {
  const pages = paginateEmbed({
    title: 'ARK Mod List',
    fields: [{ name: 'Astraeos', value: 'm'.repeat(3500), inline: false }]
  });

  assert.ok(pages.length >= 1);
  const fields = pages.flatMap((page) => page.fields || []);
  assert.ok(fields.length >= 4);
  for (const field of fields) {
    assert.ok(field.name.length <= EMBED_LIMITS.fieldName);
    assert.ok(field.value.length <= EMBED_LIMITS.fieldValue);
  }
});

test('uses one embed per Discord message so multi-server stats cannot overflow aggregate embed budget', () => {
  const serverEmbed = (name) => ({
    title: `📊 ${name} • Server Stats & Rates`,
    description: 'Source: live configuration',
    fields: Array.from({ length: 5 }, (_, index) => makeField(index + 1))
  });

  const messages = buildEmbedMessagePages([
    serverEmbed('Astraeos'),
    serverEmbed('Khaos Nexus (Gen 1)')
  ]);

  assert.ok(messages.length >= 2);
  for (const message of messages) {
    assert.equal(message.embeds.length, 1);
    assert.ok(embedCharacterCount(message.embeds[0]) <= EMBED_LIMITS.totalCharacters);
  }
});

test('live ARK stats builder splits the two-map response that previously overflowed Discord', () => {
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

  assert.ok(messages.length >= 2, 'each large map response must be sent as a safe page');
  for (const message of messages) {
    assert.equal(message.embeds.length, 1);
    assert.ok(embedCharacterCount(message.embeds[0]) <= EMBED_LIMITS.totalCharacters);
  }
});
