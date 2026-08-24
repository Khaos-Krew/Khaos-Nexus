'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderModuleConsole } = require('../src/sentinel/module-console.cjs');
const {
  panelMarker,
  payloadPanelModuleId,
  markedPanelPayload,
  messageMatchesPanel,
  reconcilePanelMessages
} = require('../src/sentinel/persistent-panel-extension.cjs');

function consolePayload(moduleId = 'warframe') {
  return renderModuleConsole(moduleId, {
    enabled:true,
    configured:true,
    connected:false,
    providerKind:'native-public-data',
    availableActions:['news','events'],
    providerAvailableActions:['news','events'],
    serviceAvailableActions:[]
  });
}

function fakeMessage(id, title, createdTimestamp, authorId = '999999999999999999') {
  const state = { edits:0, deletes:0, payload:null };
  return {
    id,
    createdTimestamp,
    author:{ id:authorId, bot:true },
    embeds:[{ title, footer:{ text:'Nexus 0.1 • Simple commands • Backend-first module console' } }],
    edit:async (payload) => { state.edits += 1; state.payload = payload; },
    delete:async () => { state.deletes += 1; },
    state
  };
}

test('module console payloads resolve to a stable managed hub key', () => {
  const payload = consolePayload('warframe');
  assert.equal(payloadPanelModuleId(payload), 'warframe');
  const marked = markedPanelPayload(payload, 'warframe');
  assert.equal(marked.embeds[0].footer.text, panelMarker('warframe'));
  assert.equal(payloadPanelModuleId(marked), 'warframe');
});

test('managed hub matching is restricted to the current Sentinal account', () => {
  const title = consolePayload('division2').embeds[0].title;
  const ours = fakeMessage('1', title, 1, 'bot');
  const otherBot = fakeMessage('2', title, 2, 'other');
  assert.equal(messageMatchesPanel(ours, 'division2', 'bot'), true);
  assert.equal(messageMatchesPanel(otherBot, 'division2', 'bot'), false);
});

test('hub reconciliation edits the newest existing panel instead of sending another and removes duplicates', async () => {
  const payload = consolePayload('warframe');
  const old = fakeMessage('100000000000000001', payload.embeds[0].title, 100, 'bot');
  const current = fakeMessage('100000000000000002', payload.embeds[0].title, 200, 'bot');
  const unrelated = fakeMessage('100000000000000003', 'Unrelated', 300, 'bot');
  const channel = {
    client:{ user:{ id:'bot' } },
    messages:{ fetch:async () => new Map([[old.id, old], [current.id, current], [unrelated.id, unrelated]]) }
  };

  const result = await reconcilePanelMessages(channel, 'warframe', payload, { botId:'bot', logger:{ warn(){} } });
  assert.equal(result.message.id, current.id);
  assert.equal(result.candidates, 2);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(current.state.edits, 1);
  assert.equal(current.state.payload.embeds[0].footer.text, panelMarker('warframe'));
  assert.equal(old.state.deletes, 1);
  assert.equal(unrelated.state.deletes, 0);
});
