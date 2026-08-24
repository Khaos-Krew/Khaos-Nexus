'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getModule } = require('../src/backend/modules/catalog.cjs');
const { renderModuleConsole, renderHelp, parseActionId } = require('../src/sentinel/module-console.cjs');

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

test('ARK help is capability-driven and keeps easy commands visible', () => {
  const payload = renderHelp('ark');
  const text = renderedText(payload);
  const embed = payload.embeds[0];
  assert.equal(embed.title, 'ARK: Survival Ascended • Features & Commands');
  assert.equal(text.includes('player features'), true);
  assert.equal(text.includes('operator / admin features'), true);
  assert.equal(text.includes('owner controls'), true);
  assert.equal(text.includes('status'), true);
  assert.equal(text.includes('save all'), true);
  assert.equal(text.includes('restart'), true);
  assert.equal(text.includes('raw rcon'), true);
  assert.equal(text.includes('/ark status'), true);
  assert.equal(text.includes('/ark schedule list'), true);
  assert.equal(text.includes('permission-gated'), true);
});

test('Warframe help exposes public companion-ready capabilities from the backend manifest', () => {
  const payload = renderHelp('warframe');
  const text = renderedText(payload);
  assert.equal(text.includes('alerts'), true);
  assert.equal(text.includes('fissures'), true);
  assert.equal(text.includes('nightwave'), true);
  assert.equal(text.includes('market'), true);
  assert.equal(text.includes('build helper'), true);
  assert.equal(text.includes('/warframe market'), true);
  assert.equal(text.includes('backend capability contract'), true);
});

test('module help obeys Discord embed field limits', () => {
  for (const moduleId of ['ark', 'warframe', 'pokemongo', 'division2']) {
    const payload = renderHelp(moduleId);
    const embed = payload.embeds[0];
    assert.ok(embed.fields.length <= 25, `${moduleId} has too many fields`);
    assert.ok(embed.description.length <= 4000, `${moduleId} description too long`);
    for (const field of embed.fields) {
      assert.ok(field.name.length <= 256, `${moduleId} field name too long`);
      assert.ok(field.value.length <= 1024, `${moduleId} field value too long`);
    }
  }
});

test('D&D help preserves Veyra as the normal interaction surface', () => {
  const payload = renderHelp('dnd');
  const text = renderedText(payload);
  assert.equal(text.includes('veyra'), true);
  assert.equal(text.includes('features & commands'), true);
});
