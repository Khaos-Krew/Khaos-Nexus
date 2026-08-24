'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLegacyRoleMenuTitle,
  shouldInspectLegacyRoleMessage,
  canonicalLegacyRoleName,
  resolveLegacyRole,
  augmentedRolesForLegacyMenu
} = require('../src/sentinel/legacy-self-role-aliases.cjs');

const role = (id, name, extra = {}) => ({ id, name, color: 0, hexColor: '#000000', ...extra });
const buttonMessage = (title, label = 'PC') => ({
  author: { bot: true },
  embeds: [{ title, footer: { text: `Khaos Nexus • ${title}` } }],
  components: [{ type: 1, components: [{ type: 2, label, custom_id: `legacy:${label}` }] }]
});

test('only the eleven observed Khaos Nexus role panels are migration titles', () => {
  assert.equal(isLegacyRoleMenuTitle('Platforms'), true);
  assert.equal(isLegacyRoleMenuTitle('Name Color — Page 2'), true);
  assert.equal(isLegacyRoleMenuTitle('KHAOS NEXUS • COMMUNITY RULES'), false);
});

test('rules buttons and ordinary testing polls are excluded before role parsing', () => {
  assert.equal(shouldInspectLegacyRoleMessage(buttonMessage('Platforms')), true);
  assert.equal(shouldInspectLegacyRoleMessage({
    author: { bot: true },
    embeds: [{ title: 'KHAOS NEXUS • COMMUNITY RULES', footer: { text: 'Khaos Nexus • Safe Space' } }],
    components: [{ type: 1, components: [{ type: 2, label: 'Open Private Report', custom_id: 'report:open' }] }]
  }), false);
  assert.equal(shouldInspectLegacyRoleMessage({
    author: { bot: true },
    embeds: [{ title: '🧪 Testing Needed • Khaos Nexus 0.41.2', description: 'React with ✅ if it works or ❌ if it fails.' }],
    reactions: { cache: new Map([['yes', { emoji: { name: '✅' } }]]) }
  }), false);
});

test('live renamed preference and notification roles use explicit aliases', () => {
  assert.equal(canonicalLegacyRoleName('Content Preferences', 'Fashion'), 'Screenshots / Fashion');
  assert.equal(canonicalLegacyRoleName('Content Preferences', 'Lore'), 'Lore Discussion');
  assert.equal(canonicalLegacyRoleName('Notification Pings', 'Events'), 'Events Ping');
  assert.equal(canonicalLegacyRoleName('Notification Pings', 'Ko-fi / Supporter Updates'), 'Supporter Updates');
});

test('name-color pages resolve only through the exact Color prefix', () => {
  const roles = [role('1', 'Color: Gold', { color: 0xffcc00, hexColor: '#ffcc00' }), role('2', 'Color: Prime Gold')];
  const resolved = resolveLegacyRole('Name Color — Page 1', 'Gold', roles);
  assert.equal(resolved.source, 'alias');
  assert.equal(resolved.role.id, '1');
  assert.equal(resolved.target, 'Color: Gold');
});

test('games resolve to the existing manageable module access role names', () => {
  const roles = [role('1', 'Warframe Access'), role('2', 'Minecraft Access'), role('3', 'Nexus D&D Access')];
  assert.equal(resolveLegacyRole('Games', 'Warframe', roles).role.id, '1');
  assert.equal(resolveLegacyRole('Games', 'Minecraft', roles).role.id, '2');
  assert.equal(resolveLegacyRole('Games', 'Dungeons & Dragons', roles).role.id, '3');
});

test('alias augmentation preserves the real role id while presenting the old button label to the legacy parser', () => {
  const roles = [role('1', 'Events Ping'), role('2', 'Giveaways Ping')];
  const augmented = augmentedRolesForLegacyMenu('Notification Pings', ['Events', 'Giveaways'], roles);
  const events = augmented.find((item) => item.name === 'Events');
  const giveaways = augmented.find((item) => item.name === 'Giveaways');
  assert.equal(events.id, '1');
  assert.equal(events.__nexusLegacyAlias, 'Events Ping');
  assert.equal(giveaways.id, '2');
});

test('ambiguous duplicate exact roles are never guessed', () => {
  const roles = [role('1', 'PC'), role('2', 'PC')];
  const resolved = resolveLegacyRole('Platforms', 'PC', roles);
  assert.equal(resolved.role, null);
  assert.equal(resolved.source, 'unresolved');
  const augmented = augmentedRolesForLegacyMenu('Platforms', ['PC'], roles);
  assert.equal(augmented.length, 2);
});

test('generic LFG remains unresolved rather than being guessed as a game-specific LFG role', () => {
  const roles = [role('1', 'LFG Casual'), role('2', 'LFG Warframe'), role('3', 'LFG Minecraft')];
  const resolved = resolveLegacyRole('Game Types & Playstyle', 'LFG', roles);
  assert.equal(resolved.role, null);
});
