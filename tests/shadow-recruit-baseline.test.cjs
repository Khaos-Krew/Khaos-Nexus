'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveShadowRecruitRole,
  ensureShadowRecruitRole,
  reconcileShadowRecruitBaseline
} = require('../src/sentinel/welcome-extension.cjs');

function role(id = '1001', name = 'Shadow Recruit', editable = true) {
  return { id, name, editable };
}

function member(id, roles = [], options = {}) {
  const cache = new Map(roles.map((item) => [String(item.id), item]));
  const added = [];
  const value = {
    id: String(id),
    user: { id: String(id), bot: options.bot === true },
    roles: {
      cache,
      async add(target) {
        if (options.addError) throw options.addError;
        added.push(String(target.id));
        cache.set(String(target.id), target);
      }
    }
  };
  value.added = added;
  return value;
}

function guildWith({ roles = [], members = [] } = {}) {
  const roleCache = new Map(roles.map((item) => [String(item.id), item]));
  const memberCache = new Map(members.map((item) => [String(item.id), item]));
  const guild = {
    id: 'guild-1',
    roles: {
      cache: roleCache,
      async fetch(id) {
        if (id) return roleCache.get(String(id)) || null;
        return roleCache;
      }
    },
    members: {
      cache: memberCache,
      async fetch() { return memberCache; }
    }
  };
  for (const item of members) item.guild = guild;
  return guild;
}

test('configured Shadow Recruit role ID is preferred over name fallback', async () => {
  const named = role('1001');
  const configured = role('2002', 'Community Baseline');
  const guild = guildWith({ roles: [named, configured] });
  const result = await resolveShadowRecruitRole(guild, { discord: { rankRoles: { 'shadow-recruit': '2002' } } });
  assert.equal(result.id, '2002');
});

test('Shadow Recruit role falls back to exact normalized role name', async () => {
  const baseline = role('1001', 'SHADOW RECRUIT');
  const guild = guildWith({ roles: [baseline] });
  const result = await resolveShadowRecruitRole(guild, { discord: { rankRoles: { 'shadow-recruit': '' } } });
  assert.equal(result.id, '1001');
});

test('bot members never receive the Shadow Recruit baseline', async () => {
  const baseline = role();
  const bot = member('9', [], { bot: true });
  bot.guild = guildWith({ roles: [baseline], members: [bot] });
  const result = await ensureShadowRecruitRole(bot, {}, { role: baseline });
  assert.equal(result.changed, false);
  assert.equal(result.skipped, 'bot-member');
  assert.deepEqual(bot.added, []);
});

test('members already holding Shadow Recruit are unchanged', async () => {
  const baseline = role();
  const user = member('10', [baseline]);
  user.guild = guildWith({ roles: [baseline], members: [user] });
  const result = await ensureShadowRecruitRole(user, {}, { role: baseline });
  assert.equal(result.changed, false);
  assert.equal(result.already, true);
  assert.deepEqual(user.added, []);
});

test('missing human member receives Shadow Recruit exactly once', async () => {
  const baseline = role();
  const user = member('11');
  user.guild = guildWith({ roles: [baseline], members: [user] });
  const first = await ensureShadowRecruitRole(user, {}, { role: baseline });
  const second = await ensureShadowRecruitRole(user, {}, { role: baseline });
  assert.equal(first.changed, true);
  assert.equal(second.already, true);
  assert.deepEqual(user.added, ['1001']);
});

test('startup reconciliation backfills missing humans, skips bots, and is idempotent', async () => {
  const baseline = role();
  const existing = member('12', [baseline]);
  const missing = member('13');
  const bot = member('14', [], { bot: true });
  const guild = guildWith({ roles: [baseline], members: [existing, missing, bot] });

  const first = await reconcileShadowRecruitBaseline(guild, {});
  assert.equal(first.ok, true);
  assert.equal(first.scanned, 2);
  assert.equal(first.added, 1);
  assert.equal(first.already, 1);
  assert.equal(first.botsSkipped, 1);
  assert.equal(first.failed, 0);

  const second = await reconcileShadowRecruitBaseline(guild, {});
  assert.equal(second.added, 0);
  assert.equal(second.already, 2);
  assert.equal(second.failed, 0);
  assert.deepEqual(missing.added, ['1001']);
});

test('missing or uneditable Shadow Recruit role fails closed', async () => {
  const user = member('15');
  const missingGuild = guildWith({ members: [user] });
  user.guild = missingGuild;
  const missing = await ensureShadowRecruitRole(user, {});
  assert.equal(missing.skipped, 'shadow-recruit-role-missing');

  const locked = role('1001', 'Shadow Recruit', false);
  const lockedGuild = guildWith({ roles: [locked], members: [user] });
  user.guild = lockedGuild;
  const uneditable = await ensureShadowRecruitRole(user, {}, { role: locked });
  assert.equal(uneditable.skipped, 'shadow-recruit-role-uneditable');
  assert.deepEqual(user.added, []);
});

test('baseline reconciliation never removes or rewrites supporter/staff roles', async () => {
  const baseline = role('1001');
  const supporter = role('2002', 'Cipher Runner');
  const staff = role('3003', 'Staff');
  const user = member('16', [supporter, staff]);
  const guild = guildWith({ roles: [baseline, supporter, staff], members: [user] });
  const result = await reconcileShadowRecruitBaseline(guild, {});
  assert.equal(result.added, 1);
  assert.equal(user.roles.cache.has('1001'), true);
  assert.equal(user.roles.cache.has('2002'), true);
  assert.equal(user.roles.cache.has('3003'), true);
});
