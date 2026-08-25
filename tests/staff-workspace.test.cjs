'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const {
  STAFF_CATEGORY_NAME,
  STAFF_PANEL_MARKER,
  ADMIN_PANEL_MARKER,
  ROADMAP_PANEL_MARKER,
  MANAGED_TEXT_CHANNELS,
  STAFF_OFFICES_FORUM,
  MANAGED_VOICE_CHANNEL,
  normalizeName,
  isPrivateSafeText,
  findStaffCategory,
  staffCategoryOverwrites,
  permissionMask,
  overwriteSetMatches,
  adminCommandInventory,
  adminCommandsPayload,
  roadmapPayload,
  staffHubPayload,
  panelMatches,
  panelPayloadMatches,
  officeThreadName,
  officeThreadMatches,
  legacyOfficeChannelName
} = require('../src/sentinel/staff-workspace.cjs');
const { memberIsStaff, staffMembers, channelNamed } = require('../src/sentinel/staff-workspace-extension.cjs');

const IDS = Object.freeze({
  guild: '1016059608789434408',
  bot: '111111111111111111',
  staff: '222222222222222222',
  owner: '333333333333333333',
  user: '444444444444444444'
});

test('staff category detection adopts decorated STAFF categories', () => {
  const channels = new Map([
    ['a', { id: 'a', type: ChannelType.GuildCategory, name: 'INFORMATION' }],
    ['b', { id: 'b', type: ChannelType.GuildCategory, name: STAFF_CATEGORY_NAME }]
  ]);
  assert.equal(normalizeName(STAFF_CATEGORY_NAME), 'staff');
  assert.equal(findStaffCategory(channels)?.id, 'b');
});

test('managed staff workspace uses a real offices forum plus roadmap channel', () => {
  assert.deepEqual(MANAGED_TEXT_CHANNELS.map((item) => item.name), [
    'staff-hub', 'staff-ops', 'admin-commands', 'roadmap'
  ]);
  assert.equal(STAFF_OFFICES_FORUM.name, 'staff-offices');
  assert.deepEqual([...STAFF_OFFICES_FORUM.tags], ['Office', 'Handoff', 'Planning']);
  assert.equal(MANAGED_VOICE_CHANNEL.name, 'Staff Meeting Room');
});

test('staff category permissions hide everyone while allowing forum participation', () => {
  const guild = { id: IDS.guild };
  const overwrites = staffCategoryOverwrites(guild, IDS.bot, [IDS.staff], [IDS.owner]);
  const everyone = overwrites.find((item) => item.id === IDS.guild);
  const staff = overwrites.find((item) => item.id === IDS.staff);
  const owner = overwrites.find((item) => item.id === IDS.owner);
  const bot = overwrites.find((item) => item.id === IDS.bot);

  assert.equal(everyone.type, OverwriteType.Role);
  assert.ok(everyone.deny.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(staff.allow.includes(PermissionFlagsBits.ViewChannel));
  assert.ok(staff.allow.includes(PermissionFlagsBits.SendMessagesInThreads));
  assert.ok(staff.allow.includes(PermissionFlagsBits.CreatePublicThreads));
  assert.equal(staff.allow.includes(PermissionFlagsBits.ManageThreads), false);
  assert.ok(owner.allow.includes(PermissionFlagsBits.ManageThreads));
  assert.ok(bot.allow.includes(PermissionFlagsBits.ManageThreads));
});

test('already-correct staff category overwrites are recognized without a Discord write', () => {
  const guild = { id: IDS.guild };
  const desired = staffCategoryOverwrites(guild, IDS.bot, [IDS.staff], [IDS.owner]);
  const cache = new Map(desired.map((entry) => [String(entry.id), {
    id: String(entry.id),
    type: Number(entry.type ?? OverwriteType.Role),
    allow: { bitfield: permissionMask(entry.allow || []) },
    deny: { bitfield: permissionMask(entry.deny || []) }
  }]));
  assert.equal(overwriteSetMatches({ permissionOverwrites: { cache } }, desired), true);
});

test('staff membership accepts configured staff role or owner only', () => {
  const withRole = {
    id: IDS.user,
    user: { bot: false },
    roles: { cache: new Map([[IDS.staff, { id: IDS.staff }]]) }
  };
  const owner = { id: IDS.owner, user: { bot: false }, roles: { cache: new Map() } };
  const normal = { id: IDS.user, user: { bot: false }, roles: { cache: new Map() } };
  const bot = { id: IDS.user, user: { bot: true }, roles: { cache: new Map([[IDS.staff, {}]]) } };
  assert.equal(memberIsStaff(withRole, [IDS.staff], [IDS.owner]), true);
  assert.equal(memberIsStaff(owner, [IDS.staff], [IDS.owner]), true);
  assert.equal(memberIsStaff(normal, [IDS.staff], [IDS.owner]), false);
  assert.equal(memberIsStaff(bot, [IDS.staff], [IDS.owner]), false);
});

test('staff member discovery uses the maintained member cache without issuing a full guild fetch', async () => {
  let fetches = 0;
  const staff = {
    id: IDS.user,
    user: { bot: false },
    roles: { cache: new Map([[IDS.staff, { id: IDS.staff }]]) }
  };
  const normal = {
    id: '555555555555555555',
    user: { bot: false },
    roles: { cache: new Map() }
  };
  const guild = {
    members: {
      cache: new Map([[staff.id, staff], [normal.id, normal]]),
      fetch: async () => { fetches += 1; throw new Error('full member fetch must not run when cache is populated'); }
    }
  };
  const result = await staffMembers(guild, [IDS.staff], [IDS.owner]);
  assert.deepEqual(result.map((member) => member.id), [IDS.user]);
  assert.equal(fetches, 0);
});

test('managed channel lookup requires the intended type and staff parent', () => {
  const channels = new Map([
    ['1', { id: '1', type: ChannelType.GuildText, name: 'staff-hub', parentId: 'staff-cat' }],
    ['2', { id: '2', type: ChannelType.GuildText, name: 'staff-hub', parentId: 'wrong-cat' }],
    ['3', { id: '3', type: ChannelType.GuildVoice, name: 'Staff Meeting Room', parentId: 'staff-cat' }],
    ['4', { id: '4', type: ChannelType.GuildForum, name: 'staff-offices', parentId: 'staff-cat' }]
  ]);
  assert.equal(channelNamed(channels, 'staff-hub', ChannelType.GuildText, 'staff-cat')?.id, '1');
  assert.equal(channelNamed(channels, 'Staff Meeting Room', ChannelType.GuildVoice, 'staff-cat')?.id, '3');
  assert.equal(channelNamed(channels, 'staff-offices', ChannelType.GuildForum, 'staff-cat')?.id, '4');
  assert.equal(channelNamed(channels, 'staff-hub', ChannelType.GuildText, 'missing'), null);
});

test('legacy staff offices text channel receives a deterministic preserved name', () => {
  assert.equal(legacyOfficeChannelName('1516602958668632237'), 'staff-offices-legacy-2237');
  assert.equal(legacyOfficeChannelName(''), 'staff-offices-legacy');
});

test('admin reference contains core staff controls and only privileged backend capabilities', () => {
  const inventory = adminCommandInventory();
  const commands = inventory.map((item) => item.command);
  assert.ok(commands.includes('/clear amount:<1-100>'));
  assert.ok(commands.includes('/nexus-pair'));
  assert.ok(commands.includes('/nexus setup'));
  assert.ok(commands.includes('/nexus repair-all'));
  assert.ok(commands.includes('/xp'));

  assert.ok(commands.includes('/nexus run module:ark action:save'));
  assert.ok(commands.includes('/nexus run module:ark action:restart'));
  assert.ok(commands.includes('/nexus run module:minecraft action:rcon'));
  assert.equal(commands.includes('/nexus run module:ark action:status'), false);
  assert.equal(commands.includes('/nexus run module:warframe action:market'), false);
  assert.equal(commands.includes('/nexus run module:division2 action:gear'), false);
});

test('staff command payload is completely free of restricted private-only terms', () => {
  const payload = adminCommandsPayload();
  const serialized = JSON.stringify(payload);
  assert.equal(isPrivateSafeText(serialized), true);
  for (const term of ['thora', 'asta', 'private assistant', 'household assistant']) {
    assert.equal(serialized.toLowerCase().includes(term), false);
  }
  assert.equal(payload.embeds[0].footer.text, ADMIN_PANEL_MARKER);
  assert.match(payload.embeds[0].description, /access checks, confirmations, and audit boundaries/i);
});

test('staff roadmap panel separates automated green from human acceptance and does not overclaim role authority', () => {
  const payload = roadmapPayload();
  const text = JSON.stringify(payload);
  assert.equal(payload.embeds[0].footer.text, ROADMAP_PANEL_MARKER);
  assert.match(text, /Community XP & Leveling/);
  assert.match(text, /Staff Workspace/);
  assert.match(text, /Discord Roles & Permissions/);
  assert.match(text, /Nexus D&D/);
  assert.match(text, /66%/);
  assert.match(text, /100%/);
  assert.match(text, /automated implementation green; live member interaction remains/i);
  assert.doesNotMatch(text, /Sentinal Discord Role Authority[^]*100% accepted/i);
});

test('staff hub links roadmap and forum-based offices while keeping reports separate', () => {
  const payload = staffHubPayload({
    'staff-ops': { id: '555555555555555555' },
    'admin-commands': { id: '666666666666666666' },
    roadmap: { id: '777777777777777777' },
    'staff-offices': { id: '888888888888888888' }
  });
  assert.equal(payload.embeds[0].footer.text, STAFF_PANEL_MARKER);
  const text = JSON.stringify(payload);
  assert.match(text, /forum-based staff offices/i);
  assert.match(text, /current milestones, acceptance gates/i);
  assert.match(text, /sensitive safety reports remain in the separate restricted report system/i);
});

test('office forum post names remain stable for a staff member across display-name changes', () => {
  const first = officeThreadName({ id: IDS.user, displayName: 'Khaos Loki', user: { username: 'loki' } });
  const renamed = officeThreadName({ id: IDS.user, displayName: 'Loki Updated', user: { username: 'loki' } });
  assert.match(first, /^Office • Khaos Loki • 444444$/);
  assert.equal(officeThreadMatches({ name: first }, IDS.user), true);
  assert.equal(officeThreadMatches({ name: renamed }, IDS.user), true);
  assert.equal(officeThreadMatches({ name: first }, IDS.owner), false);
});

test('managed panel matching requires both marker and bot ownership when supplied', () => {
  const message = {
    author: { id: IDS.bot },
    embeds: [{ footer: { text: ADMIN_PANEL_MARKER } }]
  };
  assert.equal(panelMatches(message, ADMIN_PANEL_MARKER, IDS.bot), true);
  assert.equal(panelMatches(message, ADMIN_PANEL_MARKER, IDS.owner), false);
  assert.equal(panelMatches(message, STAFF_PANEL_MARKER, IDS.bot), false);
});

test('managed staff panels avoid edits when the rendered payload is unchanged', () => {
  const payload = staffHubPayload({
    'staff-ops': { id: '555555555555555555' },
    'admin-commands': { id: '666666666666666666' },
    roadmap: { id: '777777777777777777' },
    'staff-offices': { id: '888888888888888888' }
  });
  const message = {
    content: '',
    embeds: payload.embeds.map((embed) => ({ toJSON: () => embed }))
  };
  assert.equal(panelPayloadMatches(message, payload), true);
});

test('staff member discovery never falls back to an opcode-8 full guild fetch when cache is empty', async () => {
  let fetches = 0;
  const guild = {
    members: {
      cache: new Map(),
      async fetch() { fetches += 1; return new Map(); }
    }
  };
  assert.deepEqual(await staffMembers(guild, ['staff'], ['owner']), []);
  assert.equal(fetches, 0);
});
