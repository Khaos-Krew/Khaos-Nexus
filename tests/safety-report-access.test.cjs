'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  isStaff,
  reportAccessOverwrites,
  reconcileReportAccess
} = require('../src/sentinel/safety-report-access.cjs');

function role(id, permissions = []) {
  return {
    id,
    managed: false,
    permissions: { has: (permission) => permissions.includes(permission) }
  };
}

function member(roleIds = [], permissions = []) {
  return {
    roles: { cache: { has: (id) => roleIds.includes(String(id)) } },
    permissions: { has: (permission) => permissions.includes(permission) }
  };
}

function guildFixture() {
  const safety = role('role-safety');
  const moderator = role('role-mod', [PermissionFlagsBits.ModerateMembers]);
  const roles = new Map([[safety.id, safety], [moderator.id, moderator]]);
  const members = new Map([
    ['staff-user', member([safety.id])],
    ['mod-user', member([moderator.id], [PermissionFlagsBits.ModerateMembers])],
    ['former-staff', member([])]
  ]);
  return {
    id: 'guild-1',
    ownerId: 'guild-owner',
    roles: { fetch: async () => roles },
    members: { fetch: async (id) => members.get(String(id)) || null }
  };
}

test('explicit safety/operator roles are authoritative over generic moderation permissions', async () => {
  const guild = guildFixture();
  const config = { discord: { safetyStaffRoleIds: ['role-safety'], operatorRoleIds: [], ownerUserIds: [] } };
  assert.equal(await isStaff(guild, 'staff-user', config), true);
  assert.equal(await isStaff(guild, 'mod-user', config), false);
  assert.equal(await isStaff(guild, 'guild-owner', config), true);
});

test('moderation roles remain the fallback only when no explicit safety/operator role is configured', async () => {
  const guild = guildFixture();
  const config = { discord: { safetyStaffRoleIds: [], operatorRoleIds: [], ownerUserIds: [] } };
  assert.equal(await isStaff(guild, 'mod-user', config), true);
  assert.equal(await isStaff(guild, 'former-staff', config), false);
});

test('closed report access drops stale explicit staff and leaves reporter/participants read-only', () => {
  const guild = { id: 'guild-1' };
  const overwrites = reportAccessOverwrites(guild, 'bot-1', {
    caseId: 'NX-20260824-A1B2',
    status: 'closed',
    reporterId: 'reporter',
    participants: ['participant'],
    staffParticipants: ['former-staff']
  }, ['role-safety'], ['owner-1']);

  assert.equal(overwrites.some((item) => item.id === 'former-staff'), false);
  const reporter = overwrites.find((item) => item.id === 'reporter');
  const participant = overwrites.find((item) => item.id === 'participant');
  const staff = overwrites.find((item) => item.id === 'role-safety');
  assert.ok(reporter.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.equal(reporter.allow.includes(PermissionFlagsBits.SendMessages), false);
  assert.ok(participant.allow.includes(PermissionFlagsBits.ReadMessageHistory));
  assert.equal(participant.allow.includes(PermissionFlagsBits.SendMessages), false);
  assert.ok(staff.allow.includes(PermissionFlagsBits.ManageMessages));
});

test('report reconciliation replaces stale overwrites and refreshes stored authority', async () => {
  const guild = guildFixture();
  let applied = null;
  const channel = {
    id: 'channel-1',
    type: ChannelType.GuildText,
    permissionOverwrites: { set: async (overwrites) => { applied = overwrites; } }
  };
  const writes = [];
  const store = { set: (caseId, value) => writes.push({ caseId, value }) };
  const client = { user: { id: 'bot-1' } };
  const config = { discord: { safetyStaffRoleIds: ['role-safety'], operatorRoleIds: [], ownerUserIds: ['owner-1'] } };
  const report = {
    caseId: 'NX-20260824-A1B2',
    channelId: 'channel-1',
    reporterId: 'reporter',
    status: 'open',
    participants: [],
    staffParticipants: ['former-staff'],
    staffRoleIds: ['old-role']
  };
  const result = await reconcileReportAccess(guild, client, config, store, report, channel);
  assert.equal(result.ok, true);
  assert.equal(applied.some((item) => item.id === 'former-staff'), false);
  assert.equal(applied.some((item) => item.id === 'old-role'), false);
  assert.equal(applied.some((item) => item.id === 'role-safety'), true);
  assert.deepEqual(writes[0], {
    caseId: report.caseId,
    value: { staffRoleIds: ['role-safety'], ownerIds: ['owner-1'] }
  });
});
