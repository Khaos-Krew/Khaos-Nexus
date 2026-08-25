'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { getModule } = require('../src/backend/modules/catalog.cjs');
const {
  ACCESS_AUDIT_MARKER,
  extractButtonBindings,
  viewAllowed,
  staffRoleIdsFromSnapshot,
  staffSubjectsFromSnapshot,
  delegatedSurface,
  delegatedAccessResult,
  accessAuditPayload,
  auditPanelMatches,
  findRoadmapChannel
} = require('../src/sentinel/module-access-audit.cjs');

const IDS = Object.freeze({
  guild: '1016059608789434408',
  bot: '111111111111111111',
  staff: '222222222222222222',
  owner: '333333333333333333',
  member: '444444444444444444',
  dndRole: '555555555555555555'
});

test('access preflight extracts live module button bindings only from Sentinal-owned messages', () => {
  const messages = [{
    author: { id: IDS.bot },
    components: [{ components: [
      { custom_id: 'nexus:module-access:ark' },
      { custom_id: 'nexus:module-access:minecraft' },
      { custom_id: 'not-nexus' }
    ] }]
  }, {
    author: { id: IDS.staff },
    components: [{ components: [{ custom_id: 'nexus:module-access:warframe' }] }]
  }];
  const bindings = extractButtonBindings(messages, IDS.bot);
  assert.deepEqual([...bindings].sort(), ['ark', 'minecraft']);
});

test('viewAllowed uses Discord effective ViewChannel permission rather than overwrite guesses', () => {
  const visible = { permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel]) };
  const hidden = { permissionsFor: () => new PermissionsBitField([]) };
  assert.equal(viewAllowed(visible, { id: 'role' }), true);
  assert.equal(viewAllowed(hidden, { id: 'role' }), false);
  assert.equal(viewAllowed(null, { id: 'role' }), false);
});

test('staff visibility subjects come from role and member cache snapshots without member fetches', () => {
  const staffRole = {
    id: IDS.staff,
    name: 'Staff',
    managed: false,
    permissions: new PermissionsBitField([PermissionFlagsBits.ModerateMembers])
  };
  const roles = new Map([[IDS.staff, staffRole]]);
  const member = {
    id: IDS.member,
    user: { bot: false },
    roles: { cache: new Map([[IDS.staff, staffRole]]) }
  };
  const owner = { id: IDS.owner, user: { bot: false }, roles: { cache: new Map() } };
  const guild = {
    id: IDS.guild,
    members: {
      cache: new Map([[IDS.member, member], [IDS.owner, owner]]),
      fetch: () => { throw new Error('bulk fetch must not be used'); }
    }
  };
  const config = { discord: { safetyStaffRoleIds: [IDS.staff], ownerUserIds: [IDS.owner] } };
  assert.deepEqual(staffRoleIdsFromSnapshot(roles, guild, config), [IDS.staff]);
  const subjects = staffSubjectsFromSnapshot(guild, roles, config);
  assert.deepEqual(subjects.roleSubjects.map((item) => item.id), [IDS.staff]);
  assert.deepEqual(subjects.cachedMembers.map((item) => item.id).sort(), [IDS.owner, IDS.member].sort());
});

test('Nexus D&D access is delegated to Veyra instead of requiring a Sentinal-managed category', () => {
  const module = getModule('dnd');
  const definition = { moduleId: 'dnd', label: 'Nexus D&D' };
  const accessRole = { id: IDS.dndRole, name: 'Nexus D&D Access' };
  assert.equal(module.console, false);
  assert.equal(delegatedSurface(module), 'veyra');
  const result = delegatedAccessResult(definition, module, accessRole, true);
  assert.equal(result.status, 'delegated');
  assert.equal(result.ok, true);
  assert.equal(result.surface, 'veyra');
  assert.equal(result.categoryManagedBySentinal, false);
  assert.equal(result.reason, 'visibility-delegated:veyra');
});

test('delegated access still requires its role and self-service button to exist', () => {
  const module = getModule('dnd');
  const result = delegatedAccessResult({ moduleId: 'dnd', label: 'Nexus D&D' }, module, null, false);
  assert.equal(result.status, 'attention');
  assert.equal(result.ok, false);
  assert.match(result.reason, /access-role-missing/);
  assert.match(result.reason, /button-binding-missing/);
});

test('roadmap panel summarizes automated evidence without claiming human acceptance', () => {
  const payload = accessAuditPayload({
    auditedAt: '2026-08-24T23:30:00.000Z',
    counts: { modules: 2, ready: 1, delegated: 1, attention: 0, pending: 0, buttonBindings: 2, staffRoles: 3 },
    modules: [
      { moduleId: 'ark', name: 'ARK Survival Ascended', status: 'ready', accessRoleName: 'ARK Access' },
      { moduleId: 'dnd', name: 'Nexus D&D', status: 'delegated', accessRoleName: 'Nexus D&D Access', surface: 'veyra' }
    ]
  });
  const embed = payload.embeds[0];
  assert.equal(embed.footer.text, ACCESS_AUDIT_MARKER);
  assert.match(embed.description, /1 Sentinel-ready/);
  assert.match(embed.description, /1 delegated/);
  assert.match(embed.description, /3 staff roles checked/i);
  assert.match(embed.description, /does not replace a real normal-member button test/i);
  assert.match(JSON.stringify(embed), /ARK Survival Ascended/);
  assert.match(JSON.stringify(embed), /Nexus D&D/);
  assert.match(JSON.stringify(embed), /visibility delegated to veyra/i);
});

test('access audit panel ownership is scoped to Sentinal', () => {
  const message = { author: { id: IDS.bot }, embeds: [{ footer: { text: ACCESS_AUDIT_MARKER } }] };
  assert.equal(auditPanelMatches(message, IDS.bot), true);
  assert.equal(auditPanelMatches(message, IDS.owner), false);
});

test('roadmap lookup only adopts the staff roadmap text channel shape', () => {
  const channels = new Map([
    ['1', { id: '1', type: ChannelType.GuildVoice, name: 'roadmap' }],
    ['2', { id: '2', type: ChannelType.GuildText, name: 'Road Map' }],
    ['3', { id: '3', type: ChannelType.GuildText, name: 'roadmap' }]
  ]);
  assert.equal(findRoadmapChannel(channels)?.id, '3');
});
