'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const {
  ACCESS_AUDIT_MARKER,
  extractButtonBindings,
  viewAllowed,
  accessAuditPayload,
  auditPanelMatches,
  findRoadmapChannel
} = require('../src/sentinel/module-access-audit.cjs');

const BOT = '111111111111111111';

test('access preflight extracts live module button bindings only from Sentinal-owned messages', () => {
  const messages = [{
    author: { id: BOT },
    components: [{ components: [
      { custom_id: 'nexus:module-access:ark' },
      { custom_id: 'nexus:module-access:minecraft' },
      { custom_id: 'not-nexus' }
    ] }]
  }, {
    author: { id: '222222222222222222' },
    components: [{ components: [{ custom_id: 'nexus:module-access:warframe' }] }]
  }];
  const bindings = extractButtonBindings(messages, BOT);
  assert.deepEqual([...bindings].sort(), ['ark', 'minecraft']);
});

test('viewAllowed uses Discord effective ViewChannel permission rather than overwrite guesses', () => {
  const visible = {
    permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel])
  };
  const hidden = {
    permissionsFor: () => new PermissionsBitField([])
  };
  assert.equal(viewAllowed(visible, { id: 'role' }), true);
  assert.equal(viewAllowed(hidden, { id: 'role' }), false);
  assert.equal(viewAllowed(null, { id: 'role' }), false);
});

test('roadmap panel summarizes automated evidence without claiming human acceptance', () => {
  const payload = accessAuditPayload({
    auditedAt: '2026-08-24T23:30:00.000Z',
    counts: { modules: 2, ready: 1, attention: 0, pending: 1, buttonBindings: 2, staffMembers: 3 },
    modules: [
      { moduleId: 'ark', name: 'ARK Survival Ascended', status: 'ready', accessRoleName: 'ARK Access' },
      { moduleId: 'dnd', name: 'Nexus D&D', status: 'pending', reason: 'managed-category-missing' }
    ]
  });
  const embed = payload.embeds[0];
  assert.equal(embed.footer.text, ACCESS_AUDIT_MARKER);
  assert.match(embed.description, /1\/2 ready/);
  assert.match(embed.description, /does not replace a real normal-member button test/i);
  assert.match(JSON.stringify(embed), /ARK Survival Ascended/);
  assert.match(JSON.stringify(embed), /Nexus D&D/);
});

test('access audit panel ownership is scoped to Sentinal', () => {
  const message = { author: { id: BOT }, embeds: [{ footer: { text: ACCESS_AUDIT_MARKER } }] };
  assert.equal(auditPanelMatches(message, BOT), true);
  assert.equal(auditPanelMatches(message, '333333333333333333'), false);
});

test('roadmap lookup only adopts the staff roadmap text channel shape', () => {
  const channels = new Map([
    ['1', { id: '1', type: ChannelType.GuildVoice, name: 'roadmap' }],
    ['2', { id: '2', type: ChannelType.GuildText, name: 'Road Map' }],
    ['3', { id: '3', type: ChannelType.GuildText, name: 'roadmap' }]
  ]);
  assert.equal(findRoadmapChannel(channels)?.id, '3');
});
