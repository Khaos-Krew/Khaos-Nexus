'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');
const { ensureReviewChannel, CHANNEL_TOPIC } = require('../src/sentinel/suggestion-review-extension.cjs');
const { ensureAlertChannel } = require('../src/sentinel/shield-extension.cjs');
const { ensureInfrastructure } = require('../src/sentinel/safety-report-extension.cjs');
const { applyOverwriteSet, lockCategoryChildren } = require('../src/sentinel/category-order.cjs');
const { ensureChannel: ensureArkClusterPlanChannel } = require('../src/sentinel/ark-cluster-plan-extension.cjs');
const { ensureChannel: ensureArkShopPlanChannel } = require('../src/sentinel/ark-shop-plan-extension.cjs');
const { ensureCreatorFeedChannel, CREATOR_FEED_TOPIC } = require('../src/sentinel/creator-program-extension.cjs');
const { ensureHelpChannel } = require('../src/sentinel/shield-isolation-extension.cjs');
const { reconcileReportAccess } = require('../src/sentinel/safety-report-access.cjs');
const { reconcileArnIntake } = require('../src/sentinel/arn-intake-extension.cjs');
const { applyOverwriteSet: applyHqOverwriteSet } = require('../src/sentinel/nexus-hq.cjs');

const GUILD = '1516602943670059108';
const CM = '1521219329360920767';
const BOTS = '1541540961937526916';
const OWNER_KEEP = '1516602943670059102';
const OWNER = '1516602943670059101';
const BOT = '1516602943670059199';
const STAFF = '1516640233389822042';

function bits(value) {
  if (typeof value === 'bigint') return value;
  if (Array.isArray(value)) return value.reduce((mask, item) => mask | bits(item), 0n);
  if (value?.bitfield !== undefined) return BigInt(value.bitfield);
  if (value === undefined || value === null) return 0n;
  return BigInt(value);
}

function unmanaged() {
  return [
    { id: CM, type: OverwriteType.Role, allow: PermissionFlagsBits.ViewChannel, deny: 0n },
    { id: BOTS, type: OverwriteType.Role, allow: PermissionFlagsBits.SendMessages, deny: 0n },
    { id: OWNER_KEEP, type: OverwriteType.Member, allow: PermissionFlagsBits.ViewChannel, deny: 0n }
  ];
}

function cacheFrom(entries) {
  return new Map(entries.map((entry) => {
    const type = Number(entry.type ?? OverwriteType.Role);
    const id = String(entry.id);
    return [`${type}:${id}`, {
      id,
      type,
      allow: { bitfield: bits(entry.allow) },
      deny: { bitfield: bits(entry.deny) }
    }];
  }));
}

function track(channel, entries = unmanaged()) {
  const cache = cacheFrom(entries);
  channel.permissionOverwrites = {
    cache,
    set: async (next) => {
      channel.writes = (channel.writes || 0) + 1;
      channel.lastWrite = next;
      const merged = new Map();
      for (const entry of next) {
        const id = String(entry?.id || '');
        if (!id) continue;
        const type = Number(entry.type ?? OverwriteType.Role);
        const key = `${type}:${id}`;
        const current = merged.get(key) || { id, type, allow: 0n, deny: 0n };
        current.allow |= bits(entry.allow);
        current.deny |= bits(entry.deny);
        current.allow &= ~current.deny;
        merged.set(key, current);
      }
      cache.clear();
      for (const entry of merged.values()) {
        cache.set(`${entry.type}:${entry.id}`, {
          id: entry.id,
          type: entry.type,
          allow: { bitfield: entry.allow },
          deny: { bitfield: entry.deny }
        });
      }
    }
  };
  return channel;
}

function assertKept(entries, label) {
  const ids = new Set((entries || []).map((entry) => String(entry.id)));
  assert.ok(ids.has(CM), `${label} dropped Community Manager`);
  assert.ok(ids.has(BOTS), `${label} dropped Bots`);
  assert.ok(ids.has(OWNER_KEEP), `${label} dropped Owner`);
}

async function stays(label, channel, run) {
  await run();
  assert.ok(channel.writes >= 1, `${label} did not write overwrites`);
  assertKept(channel.lastWrite, label);
  const writes = channel.writes;
  await run();
  assert.equal(channel.writes, writes, `${label} was not idempotent`);
  assertKept(channel.lastWrite, label);
}

function roles() {
  const items = [
    { id: GUILD, name: '@everyone', managed: false, permissions: { has: () => false } },
    { id: BOTS, name: 'Bots', managed: true, permissions: { has: () => false } },
    { id: STAFF, name: 'Admin', managed: false, permissions: { has: () => true } }
  ];
  return new Map(items.map((item) => [item.id, item]));
}

function staffConfig() {
  return { discord: { guildId: GUILD, safetyStaffRoleIds: [STAFF], operatorRoleIds: [], ownerUserIds: [OWNER] } };
}

test('suggestion review keeps unmanaged overwrites', async () => {
  const channel = track({
    id: 'suggestion',
    name: 'suggestion-review',
    parentId: 'staff',
    topic: CHANNEL_TOPIC,
    isTextBased: () => true,
    setTopic: async () => {},
    setParent: async () => {}
  });
  const channels = new Map([
    ['staff', { id: 'staff', name: 'STAFF', type: ChannelType.GuildCategory }],
    [channel.id, channel]
  ]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    channels: { fetch: async () => channels, create: async () => { throw new Error('channel exists'); } }
  };
  await stays('suggestion-review', channel, () => ensureReviewChannel(guild, staffConfig(), BOT));
});

test('shield alerts keep unmanaged overwrites', async () => {
  const channel = track({
    id: 'alerts',
    name: 'shield-alerts',
    type: ChannelType.GuildText,
    parentId: 'staff',
    setParent: async () => {}
  });
  const channels = new Map([
    ['staff', { id: 'staff', name: 'STAFF', type: ChannelType.GuildCategory }],
    [channel.id, channel]
  ]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    channels: { fetch: async () => channels },
    roles: { fetch: async () => roles() }
  };
  await stays('shield-alerts', channel, () => ensureAlertChannel(guild, { user: { id: BOT } }, staffConfig()));
});

test('safety report category and archive keep unmanaged overwrites', async () => {
  const category = track({ id: 'reports', name: 'private reports', type: ChannelType.GuildCategory });
  const archive = track({
    id: 'archive',
    name: 'report-archive',
    type: ChannelType.GuildText,
    parentId: category.id,
    setParent: async () => {}
  });
  const channels = new Map([[category.id, category], [archive.id, archive]]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    channels: {
      fetch: async (id) => (id ? null : channels),
      create: async () => { throw new Error('channels exist'); }
    },
    roles: { fetch: async () => roles() }
  };
  const store = { getInfrastructure: () => ({}), setInfrastructure: () => {} };
  const run = () => ensureInfrastructure(guild, { user: { id: BOT } }, staffConfig(), store);
  await stays('safety-report-category', category, run);
  assertKept(archive.lastWrite, 'safety-report-archive');
  const archiveWrites = archive.writes;
  await run();
  assert.equal(archive.writes, archiveWrites);
});

test('category order merges child overwrites and keeps unmanaged roles', async () => {
  const parent = {
    id: 'parent',
    permissionOverwrites: {
      cache: cacheFrom([{ id: GUILD, type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.ViewChannel }])
    }
  };
  const child = track({ id: 'child', parentId: parent.id, permissionsLocked: false });
  const skipped = {
    id: 'skipped',
    parentId: parent.id,
    permissionsLocked: true,
    permissionOverwrites: { set: async () => { throw new Error('locked child was rewritten'); } }
  };
  await stays('category-order', child, () => lockCategoryChildren(parent, new Map([
    [child.id, child],
    [skipped.id, skipped]
  ]), 'merge'));
  const direct = track({ id: 'direct' });
  await stays('category-order-set', direct, () => applyOverwriteSet(direct, [
    { id: GUILD, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] }
  ], 'merge'));
});

test('ARK plan channels merge category overwrites and keep unmanaged roles', async () => {
  async function run(ensure, name) {
    const category = {
      id: 'staff',
      name: 'STAFF',
      type: ChannelType.GuildCategory,
      permissionOverwrites: {
        cache: cacheFrom([{ id: GUILD, type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.ViewChannel }])
      }
    };
    const channel = track({
      id: name,
      name,
      type: ChannelType.GuildText,
      parentId: category.id,
      setParent: async (parent, options) => {
        if (options?.lockPermissions) throw new Error(`${name} used lockPermissions`);
      },
      setTopic: async () => {},
      lockPermissions: async () => { throw new Error(`${name} called lockPermissions`); }
    });
    const guild = {
      channels: {
        fetch: async () => new Map([[category.id, category], [channel.id, channel]]),
        create: async () => { throw new Error('channel exists'); }
      }
    };
    await stays(name, channel, () => ensure(guild));
  }
  await run(ensureArkClusterPlanChannel, 'ark-cluster-plan');
  await run(ensureArkShopPlanChannel, 'ark-shop-plan');
});

test('creator feed keeps unmanaged overwrites', async () => {
  const channel = track({
    id: 'feed',
    name: 'creator-feed',
    parentId: 'info',
    topic: CREATOR_FEED_TOPIC,
    isTextBased: () => true,
    setParent: async () => {},
    setTopic: async () => {}
  });
  const guild = {
    id: GUILD,
    channels: {
      fetch: async () => new Map([
        ['info', { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory }],
        [channel.id, channel]
      ]),
      create: async () => { throw new Error('feed exists'); }
    }
  };
  await stays('creator-feed', channel, () => ensureCreatorFeedChannel(guild, BOT, channel.id));
});

test('shield isolation help keeps unmanaged overwrites', async () => {
  const channel = track({
    id: 'help',
    name: 'verification-help',
    type: ChannelType.GuildText,
    parentId: 'info',
    isTextBased: () => true,
    setParent: async () => {},
    setTopic: async () => {},
    messages: {
      fetch: async () => new Map([
        ['m', { author: { id: BOT }, content: '🛡️ **Nexus Sentinel Shield — Verification Help**' }]
      ])
    }
  });
  const channels = new Map([
    ['info', { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory }],
    [channel.id, channel]
  ]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    channels: { fetch: async () => channels },
    roles: { fetch: async () => roles() }
  };
  const role = { id: '1516640233389822001', name: 'Nexus Quarantine' };
  await stays('shield-isolation', channel, () => ensureHelpChannel(guild, { user: { id: BOT } }, staffConfig(), role));
});

test('safety report access reconciliation keeps unmanaged overwrites', async () => {
  const channel = track({ id: 'case', type: ChannelType.GuildText });
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    roles: { fetch: async () => roles() },
    channels: { fetch: async () => channel }
  };
  const report = { caseId: 'R1', channelId: channel.id, status: 'open', reporterId: '1516602943670059333', participants: [] };
  await stays('safety-report-access', channel, () => reconcileReportAccess(
    guild,
    { user: { id: BOT } },
    staffConfig(),
    { set() {} },
    report,
    channel
  ));
});

test('ARN intake keeps unmanaged overwrites', async () => {
  const category = track({
    id: 'staff',
    name: 'STAFF',
    type: ChannelType.GuildCategory
  }, [
    { id: GUILD, type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.ViewChannel },
    ...unmanaged()
  ]);
  const channel = track({
    id: 'arn',
    name: 'arn-ingest',
    type: ChannelType.GuildText,
    parentId: category.id,
    topic: 'Private ARN intake bus for per-map Shiny! Dinos webhooks. Read by Nexus Sentinel.',
    setParent: async () => {},
    setName: async () => {},
    setTopic: async () => {},
    fetchWebhooks: async () => new Map()
  });
  const channels = new Map([[category.id, category], [channel.id, channel]]);
  const guild = {
    id: GUILD,
    ownerId: OWNER,
    channels: { fetch: async () => channels, create: async () => { throw new Error('exists'); } },
    roles: { fetch: async () => roles() }
  };
  const client = { user: { id: BOT }, guilds: { fetch: async () => guild } };
  await stays('arn-intake', channel, () => reconcileArnIntake(client, staffConfig(), { reason: 'test' }));
  assertKept(category.lastWrite, 'arn-intake-category');
});

test('Nexus HQ overwrite apply keeps unmanaged roles', async () => {
  const channel = track({ id: 'hq' });
  await stays('nexus-hq', channel, () => applyHqOverwriteSet(channel, [
    { id: GUILD, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] }
  ], 'Nexus HQ'));
});
