'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  isStaff,
  reportAccessOverwrites,
  reconcileReportAccess
} = require('../src/sentinel/safety-report-access.cjs');

const IDS = Object.freeze({
  guild: '1016059608789434408',
  owner: '1016059608789434409',
  configuredOwner: '1016059608789434410',
  safetyRole: '1016059608789434411',
  moderatorRole: '1016059608789434412',
  oldRole: '1016059608789434413',
  staffUser: '1016059608789434414',
  modUser: '1016059608789434415',
  formerStaff: '1016059608789434416',
  reporter: '1016059608789434417',
  participant: '1016059608789434418',
  bot: '1016059608789434419',
  channel: '1016059608789434420'
});

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
  const safety = role(IDS.safetyRole);
  const moderator = role(IDS.moderatorRole, [PermissionFlagsBits.ModerateMembers]);
  const roles = new Map([[safety.id, safety], [moderator.id, moderator]]);
  const members = new Map([
    [IDS.staffUser, member([safety.id])],
    [IDS.modUser, member([moderator.id], [PermissionFlagsBits.ModerateMembers])],
    [IDS.formerStaff, member([])]
  ]);
  return {
    id: IDS.guild,
    ownerId: IDS.owner,
    roles: { fetch: async () => roles },
    members: { fetch: async (id) => members.get(String(id)) || null }
  };
}

test('explicit safety/operator roles are authoritative over generic moderation permissions', async () => {
  const guild = guildFixture();
  const config = { discord: { safetyStaffRoleIds: [IDS.safetyRole], operatorRoleIds: [], ownerUserIds: [] } };
  assert.equal(await isStaff(guild, IDS.staffUser, config), true);
  assert.equal(await isStaff(guild, IDS.modUser, config), false);
  assert.equal(await isStaff(guild, IDS.owner, config), true);
});

test('moderation roles remain the fallback only when no explicit safety/operator role is configured', async () => {
  const guild = guildFixture();
  const config = { discord: { safetyStaffRoleIds: [], operatorRoleIds: [], ownerUserIds: [] } };
  assert.equal(await isStaff(guild, IDS.modUser, config), true);
  assert.equal(await isStaff(guild, IDS.formerStaff, config), false);
});

test('closed report access drops stale explicit staff and leaves reporter/participants read-only', () => {
  const guild = { id: IDS.guild };
  const overwrites = reportAccessOverwrites(guild, IDS.bot, {
    caseId: 'NX-20260824-A1B2',
    status: 'closed',
    reporterId: IDS.reporter,
    participants: [IDS.participant],
    staffParticipants: [IDS.formerStaff]
  }, [IDS.safetyRole], [IDS.configuredOwner]);

  assert.equal(overwrites.some((item) => item.id === IDS.formerStaff), false);
  const reporter = overwrites.find((item) => item.id === IDS.reporter);
  const participant = overwrites.find((item) => item.id === IDS.participant);
  const staff = overwrites.find((item) => item.id === IDS.safetyRole);
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
    id: IDS.channel,
    type: ChannelType.GuildText,
    permissionOverwrites: { set: async (overwrites) => { applied = overwrites; } }
  };
  const writes = [];
  const store = { set: (caseId, value) => writes.push({ caseId, value }) };
  const client = { user: { id: IDS.bot } };
  const config = { discord: { safetyStaffRoleIds: [IDS.safetyRole], operatorRoleIds: [], ownerUserIds: [IDS.configuredOwner] } };
  const report = {
    caseId: 'NX-20260824-A1B2',
    channelId: IDS.channel,
    reporterId: IDS.reporter,
    status: 'open',
    participants: [],
    staffParticipants: [IDS.formerStaff],
    staffRoleIds: [IDS.oldRole]
  };
  const result = await reconcileReportAccess(guild, client, config, store, report, channel);
  assert.equal(result.ok, true);
  assert.equal(applied.some((item) => item.id === IDS.formerStaff), false);
  assert.equal(applied.some((item) => item.id === IDS.oldRole), false);
  assert.equal(applied.some((item) => item.id === IDS.safetyRole), true);
  assert.deepEqual(writes[0], {
    caseId: report.caseId,
    value: { staffRoleIds: [IDS.safetyRole], ownerIds: [IDS.configuredOwner] }
  });
});
