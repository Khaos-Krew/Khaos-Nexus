'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { configuredDiscordRole } = require('../src/sentinel/discord-command-role.cjs');
const { cephalonCommandRole } = require('../src/sentinel/cephalon-bot.cjs');
const { pokemonGoCommandRole } = require('../src/sentinel/pokemon-go-extension.cjs');
const { divisionLootCommandRole } = require('../src/sentinel/division2-targeted-loot-extension.cjs');
const { hostedServerManagerAuthorized } = require('../src/sentinel/hosted-server-manager-extension.cjs');
const { memberIsStaff } = require('../src/sentinel/staff-workspace-extension.cjs');
const { isReviewer } = require('../src/sentinel/creator-program-extension.cjs');
const { isStaff, resolveStaffRoleIds } = require('../src/sentinel/safety-report-access.cjs');
const { staffRoleIdsFromSnapshot, staffSubjectsFromSnapshot } = require('../src/sentinel/module-access-audit.cjs');
const { isAuthorizedPollManager, pollManagerRoleIds } = require('../src/sentinel/poll-ui.cjs');
const { loadConfig } = require('../src/shared/config.cjs');
const { cardCommandDefinition } = require('../src/sentinel/card/card-commands.cjs');

const GUILD = '1516602943670059108';
const REAL = '1516640233389822042';
const MANAGED = '1541540961937526916';
const USER = '1516602943670059222';
const OWNER = '1516602943670059101';

function role(id, name, managed = false, perm = false) {
  return {
    id,
    name,
    managed,
    guild: { id: GUILD },
    permissions: { has: () => perm }
  };
}

const everyone = role(GUILD, '@everyone');
const managedRole = role(MANAGED, 'Bots', true);
const realRole = role(REAL, 'Operator', false);

function interaction(roles) {
  return {
    user: { id: USER },
    guild: { id: GUILD, ownerId: OWNER },
    member: {
      id: USER,
      user: { id: USER, bot: false },
      guild: { id: GUILD, ownerId: OWNER },
      permissions: { has: () => false },
      roles: { cache: new Map(roles.map((item) => [item.id, item])) }
    }
  };
}

function person(roles) {
  return interaction(roles).member;
}

function roleMap(roles) {
  return new Map(roles.map((item) => [item.id, item]));
}

test('guild id and managed roles do not grant operator access at each command site', async () => {
  const deniedConfig = { discord: { operatorRoleIds: [GUILD, MANAGED, 'operator-role'], ownerUserIds: [] } };
  const allowedConfig = { discord: { operatorRoleIds: [REAL, GUILD, MANAGED], ownerUserIds: [] } };
  const denied = interaction([everyone, managedRole]);
  const allowed = interaction([everyone, realRole, managedRole]);
  const sites = [
    ['sentinal bot', (subject, config) => configuredDiscordRole(subject, config)],
    ['cephalon', (subject, config) => cephalonCommandRole(subject, config, null)],
    ['pokemon go', (subject, config) => pokemonGoCommandRole(subject, config, null)],
    ['division loot', (subject, config) => divisionLootCommandRole(subject, config, null)],
    ['hosted server manager', (subject, config) => hostedServerManagerAuthorized(subject, config)]
  ];
  for (const [name, allow] of sites) {
    const blocked = await allow(denied, deniedConfig);
    const passed = await allow(allowed, allowedConfig);
    if (name === 'hosted server manager') {
      assert.equal(blocked, false, name);
      assert.equal(passed, true, name);
    } else {
      assert.equal(blocked, 'viewer', name);
      assert.equal(passed, 'operator', name);
    }
  }
  const sourceHits = [
    'src/sentinel/bot.cjs',
    'src/sentinel/cephalon-bot.cjs',
    'src/sentinel/pokemon-go-extension.cjs',
    'src/sentinel/division2-targeted-loot-extension.cjs',
    'src/sentinel/hosted-server-manager-extension.cjs'
  ];
  for (const file of sourceHits) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(text, /operatorRoleIds[\s\S]{0,120}\.some\(/, file);
  }
});

test('guild id and managed roles do not grant staff-list access', async () => {
  const deniedMember = person([everyone, managedRole]);
  const allowedMember = person([everyone, realRole]);
  assert.equal(memberIsStaff(deniedMember, [GUILD, MANAGED], []), false);
  assert.equal(memberIsStaff(allowedMember, [GUILD, REAL], []), true);
  assert.equal(isReviewer(interaction([everyone, managedRole]), { discord: {} }, [GUILD, MANAGED]), false);
  assert.equal(isReviewer(interaction([everyone, realRole]), { discord: {} }, [REAL]), true);

  const roles = roleMap([everyone, managedRole, realRole]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    roles: { fetch: async () => roles },
    members: {
      fetch: async () => deniedMember,
      cache: new Map([
        ['denied', deniedMember],
        ['allowed', allowedMember]
      ])
    }
  };
  const listed = { discord: { safetyStaffRoleIds: [GUILD, MANAGED, REAL], operatorRoleIds: [GUILD, MANAGED], ownerUserIds: [] } };
  assert.deepEqual(await resolveStaffRoleIds(guild, listed), [REAL]);
  assert.equal(await isStaff(guild, USER, listed), false);
  guild.members.fetch = async () => allowedMember;
  assert.equal(await isStaff(guild, USER, listed), true);

  assert.deepEqual(staffRoleIdsFromSnapshot(roles, guild, listed), [REAL]);
  const subjects = staffSubjectsFromSnapshot(guild, roles, listed);
  assert.deepEqual(subjects.cachedMembers.map((member) => member.id), [allowedMember.id]);

  const pollConfig = { discord: { operatorRoleIds: [GUILD, MANAGED, REAL], safetyStaffRoleIds: [GUILD] } };
  assert.equal(isAuthorizedPollManager(deniedMember, { discord: { operatorRoleIds: [GUILD, MANAGED], safetyStaffRoleIds: [MANAGED] } }, guild), false);
  assert.equal(isAuthorizedPollManager(allowedMember, pollConfig, guild), true);
  assert.deepEqual(pollManagerRoleIds(roles, pollConfig), [REAL]);
});

test('config load drops the guild id from operator roles and keeps short ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-operator-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({
    discord: { guildId: GUILD, operatorRoleIds: [GUILD, 'operator-role', REAL] }
  }));
  const previous = {
    NEXUS_OPERATOR_ROLE_IDS: process.env.NEXUS_OPERATOR_ROLE_IDS,
    NEXUS_DISCORD_GUILD_ID: process.env.NEXUS_DISCORD_GUILD_ID
  };
  try {
    delete process.env.NEXUS_OPERATOR_ROLE_IDS;
    delete process.env.NEXUS_DISCORD_GUILD_ID;
    const fromFile = loadConfig({ requestedPath: file });
    assert.deepEqual(fromFile.discord.operatorRoleIds, ['operator-role', REAL]);
    process.env.NEXUS_DISCORD_GUILD_ID = GUILD;
    process.env.NEXUS_OPERATOR_ROLE_IDS = `${GUILD},operator-role,${MANAGED}`;
    const fromEnv = loadConfig({ requestedPath: file });
    assert.deepEqual(fromEnv.discord.operatorRoleIds, ['operator-role', MANAGED]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('card admin help text says staff Admin in plain words', () => {
  const json = cardCommandDefinition().toJSON();
  const admin = json.options.find((option) => option.name === 'admin');
  assert.equal(admin.description, 'Staff Admin player-card tools');
  assert.doesNotMatch(admin.description, /O9|allow-list|Administrator/);
});

test('ARK staff denials tell the member to ask an Admin', () => {
  const dir = path.join(__dirname, '../src/sentinel');
  const files = fs.readdirSync(dir).filter((name) => name.startsWith('ark') && name.endsWith('.cjs'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const denials = text.match(/['"`][^'"`\n]*(?:Nexus staff authorization|restricted to Nexus staff|limited to Nexus staff)[^'"`\n]*['"`]/g) || [];
    for (const denial of denials) {
      assert.match(denial, /Ask an Admin/, `${name} ${denial}`);
    }
  }
});
