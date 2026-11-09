'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { MemoryMcPoints, mcEarnEligible } = require('../src/economy-worker/mc-points-service.cjs');
const { PostgresMcPoints } = require('../src/economy-worker/mc-points-postgres.cjs');
const { createEconomyServer, craftRouteAllowed } = require('../src/economy-worker/server.cjs');
const { beginMinecraftLink } = require('../src/craft/mc-link-flow.cjs');
const { handleMcPointsCommand } = require('../src/craft/mc-points-commands.cjs');
const { isFloodgateUuid, isPremiumUuid, isRankSyncUuid, tellrawCommand, giveCommand } = require('../src/craft/mc-rcon-text.cjs');
const { mcMemberText } = require('../src/shared/mc-member-text.cjs');
const {
  DEFAULT_ROLE_MAP,
  RANK_LADDER,
  desiredGroups,
  parseLpListGroups,
  parseLpParentInfo,
  roleMapFromEnv,
  rolesChanged,
  mcRankSyncConfig,
  McRankSyncJournal,
  McLuckPermsRankSync,
  startMcRankSync
} = require('../src/craft/mc-rank-sync.cjs');

const UUID = '853c80ef-3c37-49fd-aa49-938b674adae6';
const FLOODGATE = '00000000-0000-0000-0009-0123456789ab';
const OFFLINE = '11111111-1111-3111-8111-111111111111';
const NIL = '00000000-0000-0000-0000-000000000000';
const DISCORD = '111111111111111111';
const CIPHER = '1539474083274563604';
const RAIDER = '1539475000216789042';
const WARDEN = '1539475462512971837';
const BOOSTER = '1019830450006528011';
const LEGEND = '1539453135981121626';
const FOUNDER = '1520530849475461280';
const DRAGON = '1539470000000000001';
const SHADE = '1539470000000000002';

function member(ids, id = DISCORD) {
  return { id, roles: { cache: new Map(ids.map((roleId) => [roleId, { id: roleId }])) } };
}

function journal() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rank-sync-'));
  return new McRankSyncJournal({ root, now: () => Date.parse('2026-10-20T17:00:00Z') });
}

function fakeRcon(initialGroups, parents = {}, options = {}) {
  const groups = new Set(initialGroups);
  const users = new Map(Object.entries(parents).map(([id, list]) => [id, new Set(list)]));
  const commands = [];
  return {
    groups, users, commands,
    async execute(command) {
      commands.push(command);
      if (command === 'lp listgroups') {
        return [`Groups: (${groups.size})`, ...[...groups].map((group) => `- ${group} - 0`)].join('\n');
      }
      const info = command.match(/^lp user (\S+) parent info$/);
      if (info) {
        const current = [...(users.get(info[1]) || [])];
        if (!current.length) return 'Player does not have any parents defined.';
        return [`Player's parents:`, ...current.map((group) => `> ${group}`)].join('\n');
      }
      const add = command.match(/^lp user (\S+) parent add (\S+)$/);
      if (add) {
        if (options.failAdd) return 'LuckPerms could not update that user.';
        const current = users.get(add[1]) || new Set();
        current.add(add[2]);
        users.set(add[1], current);
        return 'Player now inherits permissions from ' + add[2] + ' in context global.';
      }
      const remove = command.match(/^lp user (\S+) parent remove (\S+)$/);
      if (remove) {
        if (!options.failRemove) users.get(remove[1])?.delete(remove[2]);
        return 'Player no longer inherits permissions from ' + remove[2] + ' in context global.';
      }
      const create = command.match(/^lp creategroup (\S+)$/);
      if (create) {
        groups.add(create[1]);
        return `Group ${create[1]} was created.`;
      }
      throw new Error(`Unexpected command: ${command}`);
    }
  };
}

function service(rcon, { dryRun = false, provisionGroups = false, roleMap, minIntervalMs = 0, now, sleepImpl } = {}) {
  const book = journal();
  const sync = new McLuckPermsRankSync({
    rcon,
    roleMap: roleMap || roleMapFromEnv(''),
    journal: book,
    provisionGroups,
    dryRun,
    minIntervalMs,
    now,
    sleepImpl
  });
  return { sync, journal: book };
}

const MANAGED = ['blackoutlegend', 'booster', 'cipherrunner', 'khaoswarden', 'nexusraider', 'originfounder'];

test('rank sync flags default off and dry-run defaults on', () => {
  const config = mcRankSyncConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.dryRun, true);
  assert.equal(config.provisionGroups, false);
  assert.equal(config.intervalMinutes, 30);
  assert.equal(config.serverName, '');
  assert.equal(mcRankSyncConfig({ MC_RANK_SYNC_ENABLED: 'true', MC_RANK_SYNC_DRY_RUN: 'false', MC_RANK_SYNC_INTERVAL_MINUTES: '0' }).intervalMinutes, 1);
  assert.equal(mcRankSyncConfig({ MC_RANK_SYNC_DRY_RUN: 'false' }).dryRun, false);
});

test('role map accepts the built-in roles and rejects unsafe overrides', () => {
  const map = roleMapFromEnv('');
  assert.equal(map[CIPHER].group, 'cipherrunner');
  assert.equal(map[WARDEN].kind, 'sub');
  assert.equal(map[LEGEND].group, 'blackoutlegend');
  assert.equal(map['1539526708825165914'].group, 'blackoutlegend');
  assert.equal(map[FOUNDER].group, 'originfounder');
  assert.equal(map['1539471959165771866'].group, 'originfounder');
  assert.equal(map['1539474068804468788'], undefined);
  const merged = roleMapFromEnv(JSON.stringify({ [DRAGON]: { group: 'nexusdragon', kind: 'permanent' } }));
  assert.equal(merged[DRAGON].group, 'nexusdragon');
  assert.equal(merged[CIPHER].group, 'cipherrunner');
  assert.throws(() => roleMapFromEnv('{'), /valid JSON/);
  assert.throws(() => roleMapFromEnv(JSON.stringify({ [CIPHER]: { group: 'Bad Group', kind: 'sub' } })), /Invalid LuckPerms group/);
  assert.throws(() => roleMapFromEnv(JSON.stringify({ [CIPHER]: { group: 'shadecreeper', kind: 'sub' } })), /permanent/);
  assert.throws(() => roleMapFromEnv(JSON.stringify({
    [CIPHER]: { group: 'booster', kind: 'sub' },
    [BOOSTER]: { group: 'booster', kind: 'permanent' }
  })), /two kinds/);
});

test('LuckPerms listgroups and parent info output is parsed', () => {
  const listed = [
    '[12:00:00 INFO]: [LuckPerms] Groups: (3)',
    '[12:00:00 INFO]: [LuckPerms] - default - 0',
    '§a- §fcipherrunner - 15',
    '- member - 10'
  ].join('\n');
  assert.deepEqual([...parseLpListGroups(listed)].sort(), ['cipherrunner', 'default', 'member']);
  const parents = [
    "853c80ef-3c37-49fd-aa49-938b674adae6's parents:",
    '> member',
    '> khaoswarden (global)',
    '> booster'
  ].join('\n');
  assert.deepEqual([...parseLpParentInfo(parents)].sort(), ['booster', 'khaoswarden', 'member']);
  assert.equal(parseLpParentInfo('Steve does not have any parents defined.').size, 0);
});

test('a role change is the only guild member update that syncs', () => {
  const before = member([CIPHER, BOOSTER]);
  const after = member([CIPHER, BOOSTER]);
  assert.equal(rolesChanged(before, after), false);
  after.nickname = 'renamed';
  assert.equal(rolesChanged(before, after), false);
  assert.equal(rolesChanged(before, member([WARDEN, BOOSTER])), true);
  assert.equal(rolesChanged({}, member([CIPHER])), true);
});

test('desired groups keep the highest sub, booster, and the highest permanent rank', () => {
  const map = roleMapFromEnv(JSON.stringify({
    [DRAGON]: { group: 'nexusdragon', kind: 'permanent' },
    [SHADE]: { group: 'shadecreeper', kind: 'permanent' }
  }));
  const held = desiredGroups(member([CIPHER, WARDEN, BOOSTER, LEGEND, SHADE, DRAGON]), map);
  assert.deepEqual([...held].sort(), ['blackoutlegend', 'booster', 'khaoswarden', 'nexusdragon']);
  assert.equal(held.has('cipherrunner'), false);
  assert.equal(held.has('shadecreeper'), false);
  assert.deepEqual(RANK_LADDER.at(-1), 'nexusdragon');
});

test('multi-group reconcile adds every desired group and leaves unmanaged parents', async () => {
  const rcon = fakeRcon(MANAGED, { [UUID]: ['default', 'member'] });
  const { sync } = service(rcon);
  sync.markReady(true);
  const result = await sync.reconcile({
    mcUuid: UUID,
    discordUserId: DISCORD,
    member: member([WARDEN, BOOSTER, LEGEND, FOUNDER]),
    source: 'guild-member-update'
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.added, ['blackoutlegend', 'booster', 'khaoswarden', 'originfounder']);
  assert.deepEqual(result.removed, []);
  assert.equal(rcon.users.get(UUID).has('default'), true);
  assert.equal(rcon.users.get(UUID).has('member'), true);
  assert.equal(rcon.commands.some((command) => command.startsWith('lp user ') && command.includes(' parent add ')), true);
});

test('permanent groups are not removed when the role is gone', async () => {
  const rcon = fakeRcon(MANAGED, { [UUID]: ['default', 'blackoutlegend', 'originfounder', 'booster'] });
  const { sync } = service(rcon);
  sync.markReady(true);
  const result = await sync.reconcile({ mcUuid: UUID, discordUserId: DISCORD, member: member([]) });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.removed, ['booster']);
  assert.equal(rcon.users.get(UUID).has('blackoutlegend'), true);
  assert.equal(rcon.users.get(UUID).has('originfounder'), true);
  assert.equal(rcon.users.get(UUID).has('default'), true);
  assert.equal(rcon.commands.some((command) => command.includes('parent remove blackoutlegend')), false);
  assert.equal(rcon.commands.some((command) => command.includes('parent remove originfounder')), false);
});

test('sub upgrade removes the lower sub and a rank upgrade keeps the lower permanent group', async () => {
  const map = roleMapFromEnv(JSON.stringify({
    [DRAGON]: { group: 'nexusdragon', kind: 'permanent' },
    [SHADE]: { group: 'shadecreeper', kind: 'permanent' }
  }));
  const rcon = fakeRcon([...MANAGED, 'shadecreeper', 'nexusdragon'], {
    [UUID]: ['default', 'shadecreeper', 'cipherrunner', 'blackoutlegend']
  });
  const { sync } = service(rcon, { roleMap: map });
  sync.markReady(true);
  const result = await sync.reconcile({
    mcUuid: UUID,
    discordUserId: DISCORD,
    member: member([WARDEN, DRAGON])
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.added, ['khaoswarden', 'nexusdragon']);
  assert.deepEqual(result.removed, ['cipherrunner']);
  assert.equal(rcon.users.get(UUID).has('shadecreeper'), true);
  assert.equal(rcon.users.get(UUID).has('blackoutlegend'), true);
  assert.equal(rcon.users.get(UUID).has('nexusdragon'), true);
  assert.equal(rcon.commands.some((command) => command.includes('parent remove shadecreeper')), false);
  assert.ok(rcon.commands.indexOf(`lp user ${UUID} parent add khaoswarden`) < rcon.commands.indexOf(`lp user ${UUID} parent remove cipherrunner`));
});

test('a failed add does not remove the previous sub', async () => {
  const rcon = fakeRcon(MANAGED, { [UUID]: ['cipherrunner'] }, { failAdd: true });
  const { sync } = service(rcon);
  sync.markReady(true);
  const result = await sync.reconcile({ mcUuid: UUID, discordUserId: DISCORD, member: member([WARDEN]) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rank-add-readback-failed');
  assert.equal(rcon.commands.some((command) => command.includes('parent remove')), false);
  assert.equal(rcon.users.get(UUID).has('cipherrunner'), true);
});

test('dry run journals the plan and sends no LuckPerms writes', async () => {
  const rcon = fakeRcon(MANAGED, { [UUID]: ['cipherrunner', 'blackoutlegend'] });
  const { sync, journal: book } = service(rcon, { dryRun: true });
  sync.markReady(true);
  const result = await sync.reconcile({ mcUuid: UUID, discordUserId: DISCORD, member: member([WARDEN, BOOSTER]) });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.plannedAdds, ['booster', 'khaoswarden']);
  assert.deepEqual(result.plannedRemoves, ['cipherrunner']);
  assert.deepEqual(rcon.commands, [`lp user ${UUID} parent info`]);
  const raw = fs.readFileSync(book.file, 'utf8');
  assert.equal(raw.includes(UUID), false);
  assert.match(raw, /rank-sync-planned/);
  assert.match(raw, /mcUuidDigest/);
  const forced = await sync.reconcile({ mcUuid: UUID, discordUserId: DISCORD, member: member([WARDEN]), dryRun: false });
  assert.equal(forced.dryRun, true);
  assert.equal(rcon.commands.some((command) => command.includes('parent add')), false);
});

test('missing managed groups fail closed unless provisioning is enabled and dry run is off', async () => {
  const blocked = fakeRcon(['default']);
  const dry = await service(blocked, { dryRun: true, provisionGroups: true }).sync.ensureGroups();
  assert.equal(dry.reason, 'managed-groups-missing');
  assert.equal(blocked.commands.some((command) => command.startsWith('lp creategroup')), false);
  const closed = fakeRcon(['default']);
  const noProvision = await service(closed, { dryRun: false, provisionGroups: false }).sync.ensureGroups();
  assert.equal(noProvision.ok, false);
  assert.equal(closed.commands.some((command) => command.startsWith('lp creategroup')), false);
  const open = fakeRcon(['default', 'member']);
  const created = await service(open, { dryRun: false, provisionGroups: true }).sync.ensureGroups();
  assert.equal(created.ok, true, created.reason);
  assert.equal(created.created.length, 6);
});

test('unlink revoke removes subs only and refuses when readback still has the sub', async () => {
  const rcon = fakeRcon(MANAGED, { [UUID]: ['default', 'blackoutlegend', 'khaoswarden'] });
  const { sync, journal: book } = service(rcon);
  sync.markReady(true);
  const removed = await sync.revokeSubs({ mcUuid: UUID, discordUserId: DISCORD, source: 'self-service-unlink' });
  assert.equal(removed.ok, true, removed.reason);
  assert.deepEqual(removed.removed, ['khaoswarden']);
  assert.equal(rcon.users.get(UUID).has('blackoutlegend'), true);
  assert.equal(rcon.users.get(UUID).has('default'), true);
  assert.equal(fs.readFileSync(book.file, 'utf8').includes(UUID), false);

  const stuck = fakeRcon(MANAGED, { [UUID]: ['booster'] }, { failRemove: true });
  const failing = service(stuck).sync;
  failing.markReady(true);
  const refused = await failing.revokeSubs({ mcUuid: UUID, discordUserId: DISCORD });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'rank-revoke-not-verified');
  assert.equal(stuck.users.get(UUID).has('booster'), true);

  const planned = fakeRcon(MANAGED, { [FLOODGATE]: ['cipherrunner'] });
  const dry = service(planned, { dryRun: true }).sync;
  dry.markReady(true);
  const unverified = await dry.revokeSubs({ mcUuid: FLOODGATE, discordUserId: DISCORD });
  assert.equal(unverified.reason, 'dry-run-revoke-unverified');
  assert.deepEqual(planned.commands, [`lp user ${FLOODGATE} parent info`]);
});

test('the unlink command does not clear the link when revoke fails', async () => {
  let unlinked = false;
  const replies = [];
  const interaction = {
    commandName: 'mc',
    user: { id: DISCORD },
    deferred: false,
    replied: false,
    options: { getSubcommand: () => 'unlink', getSubcommandGroup: () => null },
    async deferReply() { interaction.deferred = true; },
    async editReply(payload) { replies.push(payload.content); },
    async reply(payload) { replies.push(payload.content); }
  };
  await handleMcPointsCommand(interaction, {
    ephemeral: (text) => ({ content: text }),
    ephemeralFlags: 64,
    points: { async unlink() { unlinked = true; return { ok: true, cooldownUntil: '2026-11-19' }; } },
    beforeMinecraftUnlink: async () => ({ ok: false, reason: 'rank-revoke-not-verified' })
  });
  assert.equal(unlinked, false);
  assert.equal(replies[0], mcMemberText('rank-revoke-not-verified'));
});

test('a confirmed link asks rank sync to run and a failed confirm does not', async () => {
  const calls = [];
  const ok = {
    commandName: 'mc',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'confirm', getSubcommandGroup: () => 'link', getString: () => 'ABC-234' },
    async reply(payload) { calls.push(payload.content); }
  };
  await handleMcPointsCommand(ok, {
    ephemeral: (text) => ({ content: text }),
    points: { async confirm() { return { ok: true, mcUuid: UUID }; } },
    onMinecraftLinked: (_interaction, result) => { calls.push(result.mcUuid); }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.includes(UUID), true);
  assert.ok(calls.some((line) => /Minecraft is linked/.test(String(line))));
  const failed = [];
  await handleMcPointsCommand({
    commandName: 'mc',
    user: { id: DISCORD },
    options: { getSubcommand: () => 'confirm', getSubcommandGroup: () => 'link', getString: () => 'NOPE' },
    async reply(payload) { failed.push(payload.content); }
  }, {
    ephemeral: (text) => ({ content: text }),
    points: { async confirm() { return { ok: false, reason: 'code-mismatch' }; } },
    onMinecraftLinked: () => { failed.push('synced'); }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed.includes('synced'), false);
});

test('Floodgate UUIDs sync and can link, and they do not earn Points', async () => {
  assert.equal(isFloodgateUuid(FLOODGATE), true);
  assert.equal(isPremiumUuid(FLOODGATE), false);
  assert.equal(isRankSyncUuid(FLOODGATE), true);
  assert.equal(isFloodgateUuid(NIL), false);
  assert.equal(isRankSyncUuid(OFFLINE), false);
  assert.match(tellrawCommand(FLOODGATE, 'code'), new RegExp(`^tellraw ${FLOODGATE} \\{`));
  assert.throws(() => giveCommand(FLOODGATE, 'minecraft:stone', 1), /invalid-player-uuid/);

  const rcon = fakeRcon(MANAGED, { [FLOODGATE]: ['default'] });
  const { sync } = service(rcon);
  sync.markReady(true);
  const result = await sync.reconcile({ mcUuid: FLOODGATE, discordUserId: DISCORD, member: member([BOOSTER]) });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.added, ['booster']);
  assert.equal(rcon.commands.some((command) => command.startsWith(`lp user ${FLOODGATE} parent add booster`)), true);
  const rejected = await sync.reconcile({ mcUuid: OFFLINE, discordUserId: DISCORD, member: member([BOOSTER]) });
  assert.equal(rejected.reason, 'uuid-not-syncable');

  let now = Date.parse('2026-10-20T17:00:00Z');
  const points = new MemoryMcPoints({
    now: () => now,
    wallet: {
      async resolve(discordUserId) {
        return { economicIdentityId: `econ_${discordUserId}`, status: 'verified', verifiedAt: '2026-01-01T00:00:00.000Z', holdReason: '' };
      }
    },
    env: { MC_POINTS_ENABLED: 'true', MC_LINK_CODE_SECRET: 'mc-link-code-hmac-secret-32chars!' }
  });
  let fetched = false;
  const commands = [];
  const linked = await beginMinecraftLink({
    username: '.Bedrock',
    discordUserId: DISCORD,
    rcon: async (command) => {
      commands.push(command);
      return command === 'list uuids'
        ? `There are 1 of a max of 20 players online: .Bedrock (${FLOODGATE})`
        : 'ok';
    },
    points,
    env: { MC_POINTS_ENABLED: 'true' },
    fetchImpl: async () => { fetched = true; return { ok: true, json: async () => ({}) }; }
  });
  assert.equal(linked.ok, true, linked.reason);
  assert.equal(fetched, false);
  assert.equal(points.challenges.get(DISCORD).mcUuid, FLOODGATE);
  const code = commands.find((command) => command.startsWith('tellraw')).match(/Code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)[1];
  const saved = await points.confirm({ discordUserId: DISCORD, code });
  assert.equal(saved.ok, true, saved.reason);
  assert.equal(mcEarnEligible(
    { status: 'verified', verifiedAt: '2026-01-01T00:00:00.000Z' },
    { verifiedAt: '2026-10-20T17:00:00.000Z', mcUuid: FLOODGATE }
  ), false);
  points.links.set(OFFLINE, {
    mcUuid: OFFLINE,
    discordUserId: '222222222222222222',
    verifiedAt: '2026-10-20T17:00:00.000Z',
    unlinkedAt: null
  });
  points.links.set(UUID, {
    mcUuid: UUID,
    discordUserId: '333333333333333333',
    verifiedAt: '2026-10-20T17:00:00.000Z',
    unlinkedAt: '2026-10-21T17:00:00.000Z'
  });
  assert.deepEqual(points.listVerifiedLinks(), [{ discordUserId: DISCORD, mcUuid: FLOODGATE }]);
  assert.equal(typeof PostgresMcPoints.prototype.listVerifiedLinks, 'function');
  const offline = await beginMinecraftLink({
    username: 'Steve',
    discordUserId: '444444444444444444',
    rcon: async () => `There are 1 of a max of 20 players online: Steve (${OFFLINE})`,
    points,
    env: { MC_POINTS_ENABLED: 'true' },
    fetchImpl: async () => { throw new Error('mojang should not be called'); }
  });
  assert.equal(offline.reason, 'uuid-not-premium');
  assert.equal(now > 0, true);
});

test('GET /mc/links is a craft route and is not treated as a single-user link status', async () => {
  assert.equal(craftRouteAllowed('GET', '/mc/links'), true);
  assert.equal(craftRouteAllowed('GET', '/mc/link/s'), false);
  assert.equal(craftRouteAllowed('POST', '/mc/links'), false);
  let statusCalls = 0;
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: false,
    mcRoutesEnabled: true,
    worker: {
      health: () => ({ ok: true }),
      minecraft: {
        async status() { statusCalls += 1; return { ok: true, linked: false }; },
        async listVerifiedLinks() { return [{ discordUserId: DISCORD, mcUuid: UUID }]; }
      }
    },
    shop: { listCatalog: () => [], pendingBuyOrders: () => [] }
  });
  await new Promise((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  try {
    const listed = await request({ port, path: '/mc/links', token: 'craft-token' });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.links, [{ discordUserId: DISCORD, mcUuid: UUID }]);
    assert.equal(statusCalls, 0);
    const denied = await request({ port, path: '/mc/links' });
    assert.equal(denied.status, 401);
  } finally {
    await new Promise((resolve) => runtime.server.close(resolve));
  }
});

test('RCON commands for one player are at least a second apart', async () => {
  let now = 5000;
  const sleeps = [];
  const rcon = fakeRcon(MANAGED, { [UUID]: [] });
  const { sync } = service(rcon, {
    minIntervalMs: 1000,
    now: () => now,
    sleepImpl: async (ms) => { sleeps.push(ms); now += ms; }
  });
  sync.markReady(true);
  await sync.reconcile({ mcUuid: UUID, discordUserId: DISCORD, member: member([BOOSTER]) });
  assert.ok(sleeps.length >= 2);
  assert.ok(sleeps.every((ms) => ms >= 1000));
});

test('disabled rank sync does not block unlink', async () => {
  const controller = startMcRankSync({ env: {}, store: {}, client: {} });
  assert.equal(controller.enabled, false);
  assert.equal((await controller.beforeUnlink({ mcUuid: UUID, discordUserId: DISCORD })).ok, true);
  assert.equal(DEFAULT_ROLE_MAP[BOOSTER].group, 'booster');
});

function request({ port, path: pathname, token = '' }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch { body = { raw }; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
