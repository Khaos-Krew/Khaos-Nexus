'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_STATUS, statusEnvName, resolveStatusText, applyBotStatus } = require('../src/shared/bot-status.cjs');

function fakeClient() {
  const calls = [];
  return { calls, user: { setPresence: (presence) => calls.push(presence) } };
}

test('each bot has its default status line', () => {
  assert.equal(resolveStatusText('sentinal', {}), 'Watching over the Nexus ⚔️');
  assert.equal(resolveStatusText('cephalon', {}), 'Scanning the Origin System');
  assert.equal(resolveStatusText('ascended', {}), 'Taming chaos on the Ark 🦖');
  assert.equal(resolveStatusText('sanctuary', {}), 'Hunting demons in Sanctuary 🔥');
  assert.equal(resolveStatusText('vanguard', {}), 'Forming fireteams for the Vanguard');
  assert.equal(resolveStatusText('craft', {}), 'Building worlds in the Nexus ⛏️');
  assert.equal(Object.keys(DEFAULT_STATUS).length, 6);
});

test('env var overrides, trims, caps length, and "off" clears', () => {
  assert.equal(statusEnvName('craft'), 'NEXUS_STATUS_CRAFT');
  assert.equal(resolveStatusText('craft', { NEXUS_STATUS_CRAFT: '  Event night!  ' }), 'Event night!');
  assert.equal(resolveStatusText('craft', { NEXUS_STATUS_CRAFT: '   ' }), DEFAULT_STATUS.craft);
  assert.equal(resolveStatusText('craft', { NEXUS_STATUS_CRAFT: 'OFF' }), '');
  assert.equal(resolveStatusText('craft', { NEXUS_STATUS_CRAFT: 'x'.repeat(200) }).length, 128);
  assert.equal(resolveStatusText('unknown', {}), '');
});

test('applyBotStatus sets a custom status and never throws', () => {
  const client = fakeClient();
  assert.deepEqual(applyBotStatus(client, 'vanguard', {}), { applied: true, text: DEFAULT_STATUS.vanguard });
  assert.deepEqual(client.calls[0], {
    status: 'online',
    activities: [{ name: 'Custom Status', state: DEFAULT_STATUS.vanguard, type: 4 }]
  });
  const cleared = fakeClient();
  applyBotStatus(cleared, 'vanguard', { NEXUS_STATUS_VANGUARD: 'off' });
  assert.deepEqual(cleared.calls[0].activities, []);
  assert.equal(applyBotStatus({}, 'craft', {}).applied, false);
  const broken = { user: { setPresence: () => { throw new Error('boom'); } } };
  assert.equal(applyBotStatus(broken, 'craft', {}).applied, false);
});

test('every bot entry applies its status on ready', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  assert.match(read('src/game-bots/start.cjs'), /applyBotStatus\(ready, key\)/);
  assert.match(read('src/sentinel/bot.cjs'), /applyBotStatus\(client, 'sentinal'\)/);
  assert.match(read('src/craft/bot.cjs'), /applyBotStatus\(ready, 'craft', env\)/);
});
