'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const {
  ACTIVE_PARTICIPANT_ALLOW,
  isStaff,
  reportAccessOverwrites,
  reconcileReportAccess
} = require('../src/sentinel/safety-report-access.cjs');
const { COMMUNITY_MANAGER_ROLE_ID, permissionMask, overwriteMask } = require('../src/sentinel/staff-workspace.cjs');

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
    guild: { id: IDS.guild },
    roles: { cache: new Map(roleIds.map((id) => [String(id), { id: String(id), managed: false }])) },
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

test('empty safety and operator lists do not treat moderation roles as staff', async () => {
  const guild = guildFixture();
  const config = { discord: { safetyStaffRoleIds: [], operatorRoleIds: [], ownerUserIds: [] } };
  assert.equal(await isStaff(guild, IDS.modUser, config), false);
  assert.equal(await isStaff(guild, IDS.formerStaff, config), false);
  assert.equal(await isStaff(guild, IDS.owner, config), true);
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

test('case reconciliation revokes former staff and leaves unmanaged overwrites untouched', async () => {
  const cm = COMMUNITY_MANAGER_ROLE_ID;
  const bots = '1541540961937526916';
  const ownerRole = '1541540961937526917';
  const randomRole = '1541540961937526918';
  const reporterAllow = permissionMask(ACTIVE_PARTICIPANT_ALLOW);
  const cmAllow = permissionMask([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageMessages]);
  const cmDeny = permissionMask([PermissionFlagsBits.MentionEveryone]);
  const botsAllow = permissionMask([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  const ownerAllow = permissionMask([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
  const ownerRoleAllow = permissionMask([PermissionFlagsBits.Administrator]);
  const randomAllow = permissionMask([PermissionFlagsBits.ViewChannel]);
  const randomDeny = permissionMask([PermissionFlagsBits.SendMessages]);
  const initial = [
    { id: IDS.guild, type: OverwriteType.Role, allow: 0n, deny: permissionMask([PermissionFlagsBits.ViewChannel]) },
    { id: cm, type: OverwriteType.Role, allow: cmAllow, deny: cmDeny },
    { id: bots, type: OverwriteType.Role, allow: botsAllow, deny: 0n },
    { id: ownerRole, type: OverwriteType.Role, allow: ownerRoleAllow, deny: 0n },
    { id: IDS.owner, type: OverwriteType.Member, allow: ownerAllow, deny: 0n },
    { id: IDS.reporter, type: OverwriteType.Member, allow: reporterAllow, deny: 0n },
    { id: IDS.oldRole, type: OverwriteType.Role, allow: permissionMask([PermissionFlagsBits.ViewChannel]), deny: 0n },
    { id: IDS.formerStaff, type: OverwriteType.Member, allow: permissionMask([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]), deny: 0n },
    { id: '1541540961937526919', type: OverwriteType.Member, allow: permissionMask([PermissionFlagsBits.ManageMessages]), deny: 0n },
    { id: randomRole, type: OverwriteType.Role, allow: randomAllow, deny: randomDeny }
  ];
  const cache = new Map(initial.map((entry) => [`${entry.type}:${entry.id}`, {
    id: entry.id,
    type: entry.type,
    allow: { bitfield: entry.allow },
    deny: { bitfield: entry.deny }
  }]));
  let writes = 0;
  const channel = {
    id: IDS.channel,
    type: ChannelType.GuildText,
    permissionOverwrites: {
      cache,
      set: async (next) => {
        writes += 1;
        channel.lastWrite = next;
        cache.clear();
        for (const entry of next) {
          const type = Number(entry.type ?? OverwriteType.Role);
          const id = String(entry.id);
          const key = `${type}:${id}`;
          const current = cache.get(key) || { id, type, allow: 0n, deny: 0n };
          const allow = overwriteMask(Array.isArray(entry.allow) ? permissionMask(entry.allow) : entry.allow);
          const deny = overwriteMask(Array.isArray(entry.deny) ? permissionMask(entry.deny) : entry.deny);
          current.allow = (typeof current.allow === 'bigint' ? current.allow : overwriteMask(current.allow)) | allow;
          current.deny = (typeof current.deny === 'bigint' ? current.deny : overwriteMask(current.deny)) | deny;
          current.allow &= ~current.deny;
          cache.set(key, {
            id,
            type,
            allow: { bitfield: current.allow },
            deny: { bitfield: current.deny }
          });
        }
      }
    }
  };
  const roles = new Map([
    [IDS.guild, { id: IDS.guild, name: '@everyone', managed: false }],
    [IDS.safetyRole, { id: IDS.safetyRole, name: 'Safety', managed: false }],
    [cm, { id: cm, name: 'Community Manager', managed: false }],
    [bots, { id: bots, name: 'Bots', managed: true }],
    [ownerRole, { id: ownerRole, name: 'Owner', managed: false }],
    [IDS.oldRole, { id: IDS.oldRole, name: 'Retired Staff', managed: false }],
    [randomRole, { id: randomRole, name: 'Custom', managed: false }]
  ]);
  const guild = {
    id: IDS.guild,
    ownerId: IDS.owner,
    roles: { fetch: async () => roles },
    channels: { fetch: async () => channel }
  };
  const report = {
    caseId: 'NX-20260824-A1B2',
    channelId: IDS.channel,
    reporterId: IDS.reporter,
    status: 'open',
    participants: [],
    staffParticipants: [IDS.formerStaff],
    staffRoleIds: [IDS.oldRole, cm, bots, ownerRole, IDS.guild],
    ownerIds: [IDS.owner, IDS.configuredOwner, '1541540961937526919']
  };
  const config = { discord: { safetyStaffRoleIds: [IDS.safetyRole], operatorRoleIds: [], ownerUserIds: [IDS.configuredOwner] } };
  const store = { set() {} };
  await reconcileReportAccess(guild, { user: { id: IDS.bot } }, config, store, report, channel);
  assert.equal(writes, 1);
  const writtenIds = channel.lastWrite.map((entry) => String(entry.id));
  assert.equal(writtenIds.includes(IDS.oldRole), false);
  assert.equal(writtenIds.includes(IDS.formerStaff), false);
  assert.equal(writtenIds.includes('1541540961937526919'), false);
  assert.equal(writtenIds.includes(IDS.configuredOwner), true);
  const find = (id) => channel.lastWrite.find((entry) => String(entry.id) === id);
  const kept = (id, allow, deny = 0n) => {
    const entry = find(id);
    assert.ok(entry, `missing ${id}`);
    assert.equal(overwriteMask(Array.isArray(entry.allow) ? permissionMask(entry.allow) : entry.allow), allow);
    assert.equal(overwriteMask(Array.isArray(entry.deny) ? permissionMask(entry.deny) : entry.deny), deny);
  };
  kept(cm, cmAllow, cmDeny);
  kept(bots, botsAllow);
  kept(ownerRole, ownerRoleAllow);
  kept(IDS.owner, ownerAllow);
  kept(IDS.reporter, reporterAllow);
  kept(randomRole, randomAllow, randomDeny);
  await reconcileReportAccess(guild, { user: { id: IDS.bot } }, config, store, report, channel);
  assert.equal(writes, 1);
});
