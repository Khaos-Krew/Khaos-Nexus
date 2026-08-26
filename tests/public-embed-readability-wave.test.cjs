'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderAboutPanel } = require('../src/sentinel/about-extension.cjs');
const { panelPayload, suggestionPayload, suggestionSettings } = require('../src/sentinel/suggestions-extension.cjs');
const { rulesPanel, ticketPayload } = require('../src/sentinel/safety-report-model.cjs');
const { renderNexusStatusPanel } = require('../src/sentinel/nexus-status.cjs');

function sampleSuggestion() {
  return {
    id: 'SUG-0042',
    title: 'Readable cards everywhere',
    category: 'Discord',
    details: 'Keep Nexus community cards easy to scan on desktop and mobile.',
    submitterId: '111111111111111111',
    createdAt: '2026-08-25T00:00:00.000Z',
    closesAt: '2026-08-28T00:00:00.000Z',
    status: 'voting',
    votes: { one: 'up', two: 'down' }
  };
}

test('About panel keeps long-form community information in separated blocks', () => {
  const payload = renderAboutPanel('https://discord.gg/example');
  const embed = payload.embeds[0];
  assert.match(embed.description, /\n\n/);
  assert.ok(embed.fields.length >= 6);
  assert.equal(embed.fields.every((field) => field.inline === false), true);
  assert.match(embed.fields.at(-1).value, /\n\n/);
});

test('community suggestion intake and vote cards use spaced sections instead of compressed stat lines', () => {
  const settings = suggestionSettings({});
  const intake = panelPayload(settings).embeds[0];
  assert.match(intake.description, /\n\n/);
  assert.ok(intake.fields.every((field) => field.inline === false));
  assert.ok(intake.fields.some((field) => /\n\n/.test(field.value)));

  const card = suggestionPayload(sampleSuggestion(), settings).embeds[0];
  const vote = card.fields.find((field) => field.name === 'Community Vote');
  const closes = card.fields.find((field) => field.name === 'Voting Closes');
  assert.match(vote.value, /\*\*Upvotes\*\*\n/);
  assert.match(vote.value, /\n\n/);
  assert.match(closes.value, /\*\*Closes\*\*\n/);
  assert.match(closes.value, /\*\*Remaining\*\*\n/);
});

test('rules and private report cards separate policy, privacy, and next-step information', () => {
  const rules = rulesPanel().embeds[0];
  assert.match(rules.description, /\n\n/);
  assert.ok(rules.fields.some((field) => /\n\n/.test(field.value)));

  const report = ticketPayload('NX-20260825-A1B2', '111111111111111111', {
    summary: 'Need help',
    details: 'A community situation needs staff review.'
  }).embeds[0];
  const overview = report.fields.find((field) => field.name === 'Case Overview');
  const next = report.fields.find((field) => field.name === 'Next steps');
  assert.match(overview.value, /\*\*Reporter\*\*\n/);
  assert.match(overview.value, /\n\n/);
  assert.match(next.value, /\n\n/);
});

test('Nexus service status separates individual components and timestamp details', () => {
  const payload = renderNexusStatusPanel({
    checkedAt: '2026-08-25T23:00:00.000Z',
    sentinal: {
      state: 'online',
      discord: { state: 'online', label: 'Connected', uptimeSec: 3600 },
      backend: { state: 'online', label: 'Healthy' }
    },
    veyra: {
      state: 'online',
      lore: { state: 'online', label: 'Healthy' },
      gateway: { state: 'online', label: 'Connected' }
    }
  }).embeds[0];
  assert.match(payload.fields[0].value, /\n\n/);
  assert.match(payload.fields[1].value, /\n\n/);
  assert.match(payload.fields[2].value, /\*\*Updated\*\*\n/);
  assert.match(payload.fields[2].value, /\n\n/);
});
