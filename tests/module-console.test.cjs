'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getModule } = require('../src/backend/modules/catalog.cjs');
const { renderModuleConsole, parseActionId } = require('../src/sentinel/module-console.cjs');

function renderedText(payload) {
  return JSON.stringify(payload).toLowerCase();
}

function buttons(payload) {
  return payload.components.flatMap((row) => row.components);
}

test('console renders persistent controls for ARK', () => {
  const payload = renderModuleConsole('ark', {
    enabled: true,
    configured: true,
    connected: true,
    availableActions: ['status', 'players', 'save', 'broadcast']
  });
  assert.equal(payload.embeds.length, 1);
  assert.ok(buttons(payload).some((button) => button.label === 'Players'));
});

test('custom ids parse safely', () => {
  assert.deepEqual(parseActionId('nexusmod:division2:optimize'), { moduleId: 'division2', actionId: 'optimize' });
  assert.equal(parseActionId('bad'), null);
});

test('provider-less module controls are disabled and clearly request provider setup', () => {
  const payload = renderModuleConsole('ark', { enabled: true, configured: false, connected: false, availableActions: [] });
  const text = renderedText(payload);
  const players = buttons(payload).find((button) => button.label === 'Players');
  assert.equal(players.disabled, true);
  assert.equal(text.includes('provider setup needed'), true);
  assert.equal(text.includes('ready • connected'), false);
});

test('native Warframe provider enables all public-data quick actions without connected wording', () => {
  const availableActions = getModule('warframe').capabilities.map((capability) => capability.id);
  const payload = renderModuleConsole('warframe', {
    enabled: true,
    configured: true,
    connected: false,
    providerKind: 'public-data',
    providerAvailableActions: availableActions,
    availableActions
  });
  const actionButtons = buttons(payload).filter((button) => button.custom_id?.startsWith('nexusmod:warframe:') && !['Commands / Help', 'Refresh'].includes(button.label));
  assert.equal(actionButtons.length > 0, true);
  assert.equal(actionButtons.every((button) => button.disabled === false), true);
  assert.equal(renderedText(payload).includes('ready • connected'), false);
  assert.equal(renderedText(payload).includes('backend active'), true);
  assert.equal(renderedText(payload).includes('public-data'), true);
});

test('partial provider enables only supported quick actions', () => {
  const payload = renderModuleConsole('ark', {
    enabled: true,
    configured: true,
    connected: true,
    availableActions: ['status', 'players']
  });
  const byLabel = Object.fromEntries(buttons(payload).map((button) => [button.label, button]));
  assert.equal(byLabel.Status.disabled, false);
  assert.equal(byLabel.Players.disabled, false);
  assert.equal(byLabel.Servers.disabled, true);
  assert.equal(byLabel['Save All'].disabled, true);
  assert.equal(byLabel.Broadcast, undefined);
});

test('connected external module may show connection state', () => {
  const text = renderedText(renderModuleConsole('ark', {
    enabled: true,
    configured: true,
    connected: true,
    availableActions: ['status']
  }));
  assert.equal(text.includes('connected'), true);
});
