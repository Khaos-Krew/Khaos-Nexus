'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RANKS_MARKER,
  FUNDING_FIELD_VALUE,
  AUTHORITY_FIELD_VALUE,
  FOUNDER_FIELD_VALUE,
  rankMatchCount,
  isLegacyRankPanel,
  buildManagedPayload,
  fallbackRankPayload
} = require('../src/sentinel/ranks-extension.cjs');

function legacyMessage() {
  return {
    id: '1',
    author: { id: 'legacy-bot', bot: true },
    embeds: [{
      title: 'Khaos Nexus Ranks',
      description: 'Shadow Recruit • Cipher Runner • Nexus Raider • Khaos Warden • Blackout Legend • Origin Founder',
      fields: [{ name: 'Existing Benefits', value: 'Preserve the legacy rank content.' }],
      footer: { text: 'Old embed bot' }
    }]
  };
}

test('legacy rank detection requires a bot-authored panel with most Nexus rank names', () => {
  const message = legacyMessage();
  assert.equal(rankMatchCount(message), 6);
  assert.equal(isLegacyRankPanel(message, 'sentinal'), true);
  assert.equal(isLegacyRankPanel({ ...message, author: { id: 'person', bot: false } }, 'sentinal'), false);
  assert.equal(isLegacyRankPanel({ ...message, author: { id: 'sentinal', bot: true } }, 'sentinal'), false);
});

test('managed payload preserves legacy content while adding authority, founder, and funding disclosures', () => {
  const payload = buildManagedPayload(legacyMessage());
  const embed = payload.embeds[0];
  assert.equal(embed.title, 'Khaos Nexus Ranks');
  assert.ok(embed.fields.some((field) => field.name === 'Existing Benefits' && /Preserve/.test(field.value)));
  assert.ok(embed.fields.some((field) => field.value === AUTHORITY_FIELD_VALUE));
  assert.ok(embed.fields.some((field) => field.value === FOUNDER_FIELD_VALUE));
  assert.ok(embed.fields.some((field) => field.value === FUNDING_FIELD_VALUE));
  assert.match(FOUNDER_FIELD_VALUE, /never sold/i);
  assert.match(FOUNDER_FIELD_VALUE, /legacy recognition/i);
  assert.match(FUNDING_FIELD_VALUE, /All profits from purchases are used to maintain the Nexus bots and game servers as they are added/);
  assert.equal(embed.footer.text, RANKS_MARKER);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('fallback ranks panel separates purchasable ranks from Origin Founder and avoids stale hard-coded pricing', () => {
  const payload = fallbackRankPayload();
  const text = JSON.stringify(payload);
  for (const name of ['Shadow Recruit', 'Cipher Runner', 'Nexus Raider', 'Khaos Warden', 'Blackout Legend', 'Origin Founder']) {
    assert.match(text, new RegExp(name));
  }
  const shopField = payload.embeds[0].fields.find((field) => field.name === '⚡ Discord Server Shop Ranks');
  assert.ok(shopField);
  assert.doesNotMatch(shopField.value, /Origin Founder/);
  assert.match(text, /Origin Founder is permanent legacy recognition/);
  assert.match(text, /never sold/);
  assert.match(text, /Current pricing and purchase details are shown in Discord's Server Shop/);
  assert.match(text, /All profits from purchases/);
  assert.equal(payload.embeds[0].footer.text, RANKS_MARKER);
});
