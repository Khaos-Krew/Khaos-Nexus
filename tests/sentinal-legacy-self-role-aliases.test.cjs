'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isLegacyRoleMenuTitle,
  canonicalLegacyRoleName,
  resolveLegacyRole
} = require('../src/sentinel/legacy-self-role-aliases.cjs');

const role = (id, name, extra = {}) => ({ id, name, color: 0, hexColor: '#000000', ...extra });

test('only the eleven observed Khaos Nexus role panels are migration titles', () => {
  assert.equal(isLegacyRoleMenuTitle('Platforms'), true);
  assert.equal(isLegacyRoleMenuTitle('Name Color — Page 2'), true);
  assert.equal(isLegacyRoleMenuTitle('KHAOS NEXUS • COMMUNITY RULES'), false);
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

test('ambiguous duplicate exact roles are never guessed', () => {
  const roles = [role('1', 'PC'), role('2', 'PC')];
  const resolved = resolveLegacyRole('Platforms', 'PC', roles);
  assert.equal(resolved.role, null);
  assert.equal(resolved.source, 'unresolved');
});

test('generic LFG remains unresolved rather than being guessed as a game-specific LFG role', () => {
  const roles = [role('1', 'LFG Casual'), role('2', 'LFG Warframe'), role('3', 'LFG Minecraft')];
  const resolved = resolveLegacyRole('Game Types & Playstyle', 'LFG', roles);
  assert.equal(resolved.role, null);
});
