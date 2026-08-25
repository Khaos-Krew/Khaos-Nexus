'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readablePollCardFrom, readableChoiceLine } = require('../src/sentinel/poll-ui-readability-patch.cjs');

test('poll readability wrapper separates details and choice result lines without changing controls', () => {
  const base = {
    embeds: [{
      title: '📊 Best option?',
      description: 'Vote below.',
      fields: [
        { name: 'Status', value: '🟢 Open', inline: true },
        { name: 'Profile', value: 'community-pulse', inline: true },
        { name: 'Closes', value: '<t:1787702400:R>', inline: true },
        { name: 'Choices', value: '**Alpha** — 3 votes (60%)\n**Beta** — 2 votes (40%)', inline: false },
        { name: 'Quorum', value: '5 / 5 voters required', inline: true }
      ]
    }],
    components: [{ type: 1, components: [{ type: 2, custom_id: 'nxpoll:v:POLL-0001:OPT-1' }] }]
  };
  const output = readablePollCardFrom(base, { id: 'POLL-0001' });
  assert.match(output.embeds[0].description, /\n\n/);
  assert.match(output.embeds[0].fields.find((field) => field.name === '🧭 Poll Details').value, /\n\n/);
  assert.match(output.embeds[0].fields.find((field) => field.name === '🗳️ Choices').value, /Alpha\*\*\n3 votes/);
  assert.match(output.embeds[0].fields.find((field) => field.name === '🗳️ Choices').value, /\n\n/);
  assert.deepEqual(output.components, base.components);
  assert.equal(readableChoiceLine('**Alpha** — 3 votes (60%)'), '**Alpha**\n3 votes (60%)');
});
