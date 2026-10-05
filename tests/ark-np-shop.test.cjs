'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createEconomyServer,
  writeGate,
  requestScope,
  NP_SHOP_FINANCIAL_PATHS,
  ARK_NONECONOMY_PATHS,
  ARK_DELIVERY_ROUTES,
  DRAIN_MUTATION_PATHS,
  FINANCIAL_WRITE_PATHS
} = require('../src/economy-worker/server.cjs');
const { arkNpFlags } = require('../src/shared/ark-np-flags.cjs');
const { arkMemberText, orderStatusText, ledgerLineText } = require('../src/shared/ark-np-member-text.cjs');
const { loadArkNpCatalog, EXPECTED_PRICES, NOTIONAL_POINTS } = require('../src/shared/ark-np-catalog.cjs');
const { refundDecision, offlineBackoffMs } = require('../src/shared/ark-np-orders.cjs');
const { deliverPreparedOrder, runDeliveryPass } = require('../src/sentinel/ark-np-delivery.cjs');
const { PermissionFlagsBits } = require('discord.js');
const { isArkStaff, shopCommand, pointsCommand, adminCommand, formatActivity } = require('../src/sentinel/ark-np-shop-ui.cjs');
const { authorizeStaffRefundActor } = require('../src/economy-worker/ark-staff-auth.cjs');
const { PostgresArkShop } = require('../src/economy-worker/ark-np-postgres.cjs');
const { memberPointSumSql } = require('../src/shared/economy-system-accounts.cjs');
const {
  SNAPSHOT_AT,
  hashesEqual,
  canonicalListHash,
  classifyPopulation,
  evaluateExecuteGate,
  MAX_LEGACY_FLAT_GRANTS,
  ensureBatchSchema,
  dryRun,
  execute,
  reverseCredit,
  grantOne,
  legacyBankFlatEnabled,
  AMOUNT,
  MINT_ID
} = require('../src/economy-worker/legacy-bank-flat.cjs');
const { deterministicEconomicIdentityId } = require('../src/sentinel/nexus-economy-json-postgres-migration.cjs');

const BEFORE = '2026-10-01T00:00:00.000Z';
const AFTER = '2026-10-03T02:00:00.000Z';

function person(econId, { status = 'verified', discord = '111111111111111111', eos = ['EOS11111111'], discordAt = BEFORE, eosAt = BEFORE, createdAt = BEFORE } = {}) {
  return {
    econId,
    status,
    createdAt,
    discord: [{ id: discord, verifiedAt: discordAt }],
    eos: eos.map((id) => ({ id, verifiedAt: eosAt }))
  };
}

function callServer(runtime, { method = 'POST', pathname, token, body = '{}' }) {
  const payload = body == null ? null : Buffer.from(body);
  const req = {
    method,
    url: pathname,
    headers: {
      authorization: token ? `Bearer ${token}` : '',
      'content-length': payload ? String(payload.length) : '0'
    },
    async *[Symbol.asyncIterator]() {
      if (payload) yield payload;
    }
  };
  return new Promise((resolve, reject) => {
    const res = {
      writeHead(status) { this.status = status; },
      end(raw) { resolve({ status: this.status, body: JSON.parse(raw.toString()) }); }
    };
    Promise.resolve(runtime.server.listeners('request')[0](req, res)).catch(reject);
  });
}

test('ARK shop flags default off and dry-run defaults on', () => {
  const flags = arkNpFlags({});
  assert.equal(flags.shopEnabled, false);
  assert.equal(flags.shopDeliveryEnabled, false);
  assert.equal(flags.starterKitEnabled, false);
  assert.equal(flags.npShopWritesEnabled, false);
  assert.equal(flags.dryRun, true);
  assert.equal(arkNpFlags({ ARK_SHOP_DRY_RUN: 'false' }).dryRun, false);
});

test('catalog keeps the 1:1 cache prices and leaves the weekly cache out', () => {
  const catalog = loadArkNpCatalog();
  assert.deepEqual(catalog.items.map((item) => [item.sku, item.price]), Object.entries(EXPECTED_PRICES));
  assert.equal(catalog.items.some((item) => item.sku === 'weekly'), false);
  assert.equal(catalog.kit.notionalPoints, NOTIONAL_POINTS);
  assert.equal(catalog.kit.items.length > 0, true);
});

test('member text says Points and hides raw errors', () => {
  const text = arkMemberText('insufficient-funds');
  assert.match(text, /Points/);
  assert.match(arkMemberText('verified-identity-required'), /\/ark link/);
  assert.match(arkMemberText('verified-eos-required'), /\/ark link/);
  assert.match(arkMemberText('restricted'), /restricted/);
  assert.doesNotMatch(arkMemberText('restricted'), /\/ark link/);
  assert.doesNotMatch(arkMemberText('minecraft-only'), /\/ark link/);
  assert.match(arkMemberText('minecraft-only'), /\/points/);
  assert.match(arkMemberText('minecraft-only'), /Minecraft/);
  assert.doesNotMatch(arkMemberText('verified-identity-required'), /Minecraft/);
  assert.doesNotMatch(arkMemberText('verified-eos-required'), /Minecraft/);
  assert.doesNotMatch(arkMemberText('insufficient-funds'), /Minecraft/);
  assert.match(arkMemberText('minecraft-only'), /one Points wallet/);
  assert.doesNotMatch(arkMemberText('minecraft-only'), /separate bank/);
  assert.match(ledgerLineText({ amount: 1500, createdAt: '2026-10-01T00:00:00.000Z', source: 'legacy_bank_flat' }), /<t:\d+:R>/);
  assert.doesNotMatch(text, /\bNP\b/);
  assert.match(formatActivity({ linked: false, reason: 'restricted' }), /restricted/);
  assert.doesNotMatch(formatActivity({ linked: false, reason: 'minecraft-only' }), /\/ark link/);
  assert.match(formatActivity({
    linked: true,
    balance: 10,
    entries: [{ amount: 5, source: 'legacy_bank_flat', createdAt: '2026-10-01T00:00:00.000Z' }],
    orders: []
  }), /<t:\d+:R>/);
  const hidden = arkMemberText('relation "secret" does not exist');
  assert.equal(hidden.includes('relation'), false);
  assert.equal(hidden.includes('secret'), false);
  assert.equal(orderStatusText('PLAYER_OFFLINE'), 'Queued (offline until you are on one map)');
  assert.equal(orderStatusText('SENT_UNCONFIRMED'), 'Needs staff');
  assert.equal(orderStatusText('DELIVERED'), 'Delivered');
});

test('guide explains spending Points on ARK', () => {
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/discord/nexus-guide.json'), 'utf8'));
  const entry = guide.topics.find((topic) => topic.id === 'spending-points-on-ark');
  assert.equal(entry.label, 'Spending Nexus Points on ARK');
  const body = entry.details.join('\n');
  assert.doesNotMatch(body, /ArkShop is gone/);
  assert.doesNotMatch(body, /use \/shop/i);
  assert.match(body, /not open yet/);
  assert.match(body, /once per player/);
  assert.doesNotMatch(body, /each ARK character/);
  assert.match(body, /\/points/);
  assert.match(body, /150/);
  assert.match(body, /550/);
  assert.match(body, /14 days/);
  assert.doesNotMatch(body, /\bNP\b/);
});

test('refund rules keep the 14 day window and refuse delivered orders', () => {
  const delivered = { status: 'DELIVERED', discordUserId: '1', paidAt: BEFORE };
  assert.equal(refundDecision(delivered, { staff: true, actor: '2', reason: 'lost' }).reason, 'illegal-transition');
  const unconfirmed = { status: 'SENT_UNCONFIRMED', discordUserId: '1' };
  assert.equal(refundDecision(unconfirmed, { staff: false }).ok, false);
  assert.equal(refundDecision(unconfirmed, { staff: true, actor: '1', reason: 'check' }).reason, 'self-refund');
  assert.equal(refundDecision(unconfirmed, { staff: true, actor: '2', reason: 'checked the log' }).ok, true);
  const young = { status: 'PAID', paidAt: new Date().toISOString() };
  assert.equal(refundDecision(young, { staff: false }).ok, false);
  const old = { status: 'PLAYER_OFFLINE', paidAt: '2020-01-01T00:00:00.000Z' };
  assert.equal(refundDecision(old, { staff: false }).ok, true);
  const failed = { status: 'DELIVERY_FAILED', paidAt: new Date().toISOString() };
  assert.equal(refundDecision(failed, { staff: false }).ok, true);
  assert.equal(offlineBackoffMs(1), 60 * 1000);
  assert.equal(offlineBackoffMs(45), 30 * 60 * 1000);
});

test('buy checks run after the advisory lock', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/economy-worker/ark-np-postgres.cjs'), 'utf8');
  const buy = src.slice(src.indexOf('async buy('), src.indexOf('async claimStarterKit('));
  const lock = buy.indexOf('pg_advisory_xact_lock');
  assert.ok(lock > 0);
  assert.ok(lock < buy.indexOf('FOR UPDATE'));
  assert.ok(lock < buy.indexOf("'quarantined'"));
  assert.ok(lock < buy.indexOf("'insufficient-funds'"));
  assert.ok(lock < buy.indexOf('#lockedMarker'));
  assert.equal(buy.includes('daily'), false);
  const claim = src.slice(src.indexOf('async claimStarterKit('), src.indexOf('async prepareDelivery('));
  assert.ok(claim.indexOf('pg_advisory_xact_lock') < claim.indexOf('#lockedMarker'));
  const refund = src.slice(src.indexOf('async refund('), src.indexOf('async sweepRefunds('));
  assert.match(refund, /#lockedMarker/);
  assert.match(refund, /NOW\(\), NOW\(\) \+ \(\$5::bigint \* INTERVAL '1 millisecond'\)/);
  assert.doesNotMatch(refund, /AUDIT_RETAIN_MS\)\.toISOString|new Date\(this\.now\(\) \+ AUDIT_RETAIN_MS\)/);
});

test('legacy flat credit does not use the shop writes flag', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/economy-worker/legacy-bank-flat.cjs'), 'utf8');
  assert.equal(src.includes('NEXUS_ECONOMY_NP_SHOP_WRITES_ENABLED'), false);
  assert.equal(src.includes('NEXUS_ECONOMY_WRITES_ENABLED'), false);
  assert.equal(legacyBankFlatEnabled({}), false);
  assert.equal(legacyBankFlatEnabled({ NEXUS_LEGACY_BANK_FLAT_ENABLED: 'true' }), true);
  assert.match(src, /approved-prefix=\$\{hashPrefix/);
  assert.equal(SNAPSHOT_AT, '2026-10-03T01:14:00.000Z');
  assert.equal(AMOUNT, 1500);
});

test('hash compare is constant-time and a swapped identity with the same count is refused', () => {
  assert.equal(hashesEqual('abcd', 'abcd'), true);
  assert.equal(hashesEqual('abcd', 'abce'), false);
  assert.equal(hashesEqual('abc', 'abcd'), false);
  const left = person('econ_a', { discord: '100000000000000001', eos: ['EOSAAAAAAA1'] });
  const right = person('econ_b', { discord: '100000000000000002', eos: ['EOSBBBBBBB2'] });
  const first = classifyPopulation([left, right]);
  const swapped = classifyPopulation([
    person('econ_a', { discord: '100000000000000002', eos: ['EOSBBBBBBB2'] }),
    person('econ_b', { discord: '100000000000000001', eos: ['EOSAAAAAAA1'] })
  ]);
  assert.equal(first.eligibleCount, 2);
  assert.equal(swapped.eligibleCount, 2);
  assert.equal(first.total, swapped.total);
  assert.notEqual(first.hash, swapped.hash);
  assert.equal(canonicalListHash({ rows: first.rows, eligibleCount: first.eligibleCount, total: first.total }), first.hash);
  const gate = evaluateExecuteGate({
    envHash: first.hash,
    computedHash: swapped.hash,
    eligibleCount: swapped.eligibleCount,
    total: swapped.total,
    approvedCount: 2,
    approvedTotal: 3000
  });
  assert.equal(gate.reason, 'hash-mismatch');
});

test('restricted identities are skipped and shared humans are held on both sides', () => {
  const restricted = classifyPopulation([
    person('econ_restricted', { status: 'restricted', discord: '100000000000000010', eos: ['EOSRESTRICT'] })
  ]);
  assert.equal(restricted.rows[0].skipReason, 'quarantined');
  assert.equal(restricted.rows[0].amount, 0);
  assert.equal(restricted.eligibleCount, 0);

  const shared = classifyPopulation([
    person('econ_one', { discord: '100000000000000021', eos: ['EOSSHARED01'] }),
    person('econ_two', { discord: '100000000000000022', eos: ['EOSSHARED01'] })
  ]);
  assert.deepEqual(shared.rows.map((row) => row.skipReason).sort(), ['duplicate_human', 'duplicate_human']);
  assert.equal(shared.eligibleCount, 0);

  const discord = '143909213712809984';
  const legacyId = deterministicEconomicIdentityId(discord);
  const named = classifyPopulation([
    person(legacyId, { status: 'restricted', discord, eos: ['EOSLEGACY01'] }),
    person('econ_owner', { discord, eos: ['EOSOWNER001'] })
  ]);
  const legacy = named.rows.find((row) => row.econId === legacyId);
  const owner = named.rows.find((row) => row.econId === 'econ_owner');
  assert.equal(legacy.skipReason, 'quarantined');
  assert.equal(legacy.duplicateHuman, true);
  assert.equal(owner.skipReason, 'duplicate_human');
  assert.equal(named.eligibleCount, 0);
});

test('a link verified after the snapshot is skipped', () => {
  const late = classifyPopulation([
    person('econ_late', { discord: '100000000000000031', eos: ['EOSLATE0001'], eosAt: AFTER })
  ]);
  assert.equal(late.rows[0].skipReason, 'not_verified');
  assert.equal(late.rows[0].amount, 0);
  const createdLate = classifyPopulation([
    person('econ_new', { discord: '100000000000000032', eos: ['EOSNEW00001'], createdAt: AFTER })
  ]);
  assert.equal(createdLate.rows[0].skipReason, 'not_verified');
});

test('a completed batch and a broken denylist fail closed', () => {
  assert.equal(evaluateExecuteGate({
    envHash: 'a'.repeat(64),
    computedHash: 'a'.repeat(64),
    complete: true,
    eligibleCount: 1,
    total: 1500,
    approvedCount: 1,
    approvedTotal: 1500
  }).reason, 'batch-complete');
  assert.equal(evaluateExecuteGate({ envHash: '', computedHash: 'abc', denylistError: null }).reason, 'missing-env');
  assert.equal(evaluateExecuteGate({ denylistError: new Error('down') }).reason, 'denylist-read-error');
  assert.equal(evaluateExecuteGate({
    envHash: 'aa',
    computedHash: 'aa',
    eligibleCount: 3,
    total: 4500,
    approvedCount: 2,
    approvedTotal: 4500
  }).reason, 'ceiling');
});

test('multi-map delivery is held and dry-run makes no reward calls', async () => {
  let writes = 0;
  const held = await deliverPreparedOrder({
    orderId: '11111111-1111-1111-1111-111111111111',
    sku: 'coastal',
    eosIds: ['EOSMULTI001', 'EOSMULTI002'],
    roll: { blueprint: '/Game/PrimalEarth/Dinos/Raptor/Raptor_Character_BP.Raptor_Character_BP', level: 220, sex: 'male', saddle: '' }
  }, {
    findOnline: async (eosId) => ({ prefix: eosId === 'EOSMULTI001' ? 'ARK_GEN1' : 'ARK_MAP2', server: {} }),
    markOffline: async (_order, info) => ({ ok: true, info }),
    writeReward: async () => { writes += 1; },
    reload: async () => ({ response: 'Reloaded config' }),
    classifyReload: () => ({ ok: true }),
    markPreSendFailure: async () => ({ ok: true }),
    markInProgress: async () => ({ ok: true, order: { leaseToken: 'lease' } }),
    markDelivery: async () => ({ ok: true }),
    reward: async () => ({ response: 'Player rewarded!' }),
    classifyReward: () => ({ state: 'DELIVERED' })
  });
  assert.equal(held.multi, true);
  assert.equal(held.raCalled, false);
  assert.equal(writes, 0);

  let claimed = false;
  const skipped = await runDeliveryPass({
    flags: () => ({ shopDeliveryEnabled: true, dryRun: true }),
    claim: async () => { claimed = true; return { orderId: 'x' }; }
  });
  assert.equal(skipped.skipped, 'delivery-off');
  assert.equal(skipped.raCalled, false);
  assert.equal(claimed, false);
});

test('reload failure is pre-send and does not call the reward command', async () => {
  let rewarded = 0;
  let failed = 0;
  const result = await deliverPreparedOrder({
    orderId: '22222222-2222-2222-2222-222222222222',
    sku: 'coastal',
    eosIds: ['EOSONLY0001'],
    leaseToken: 'prepare',
    roll: { blueprint: '/Game/PrimalEarth/Dinos/Raptor/Raptor_Character_BP.Raptor_Character_BP', level: 210, sex: 'female', saddle: '' }
  }, {
    findOnline: async () => ({ prefix: 'ARK_GEN1', server: {} }),
    markOffline: async () => ({ ok: true }),
    writeReward: async () => ({ changed: true }),
    reload: async () => ({ response: 'failed to reload config' }),
    classifyReload: () => ({ ok: false, response: 'failed to reload config' }),
    markPreSendFailure: async () => { failed += 1; return { ok: true }; },
    markInProgress: async () => { throw new Error('should not progress'); },
    markDelivery: async () => ({ ok: true }),
    reward: async () => { rewarded += 1; },
    classifyReward: () => ({ state: 'DELIVERED' })
  });
  assert.equal(result.reason, 'delivery-failed');
  assert.equal(result.raCalled, false);
  assert.equal(failed, 1);
  assert.equal(rewarded, 0);
});

test('narrow shop writes are independent of the global write flag', async () => {
  assert.equal(NP_SHOP_FINANCIAL_PATHS.has('/np-shop/buy'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/wallet/credit'), true);
  assert.equal(DRAIN_MUTATION_PATHS.has('/np-shop/buy'), true);
  assert.equal(DRAIN_MUTATION_PATHS.has('/ark/starter-kit/claim'), true);
  assert.equal(ARK_NONECONOMY_PATHS.has('/np-shop/quote'), true);
  assert.equal(writeGate('/np-shop/buy', { writesEnabled: false, npShopWritesEnabled: true }), null);
  assert.equal(writeGate('/np-shop/buy', { writesEnabled: true, npShopWritesEnabled: false }).body.error, 'economy-np-shop-writes-not-enabled');
  assert.equal(writeGate('/wallet/credit', { writesEnabled: false, npShopWritesEnabled: true }).body.error, 'economy-write-cutover-not-enabled');

  let bought = 0;
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    arkToken: 'ark-token',
    writesEnabled: false,
    npShopWritesEnabled: true,
    worker: {
      health() { return { ok: true }; },
      arkShop: {
        buy: async () => { bought += 1; return { ok: true, order: { orderId: 'o1' }, balance: 1 }; },
        prepareDelivery: async () => ({ orderId: 'claimed', leaseToken: 'lease' })
      }
    },
    shop: { listCatalog() { return []; }, pendingBuyOrders() { return []; } }
  });
  const sentinal = await callServer(runtime, { pathname: '/np-shop/buy', token: 'sentinal-token', body: '{}' });
  assert.equal(sentinal.status, 200);
  assert.equal(bought, 1);
  const craft = await callServer(runtime, { pathname: '/np-shop/buy', token: 'craft-token', body: '{}' });
  assert.equal(craft.status, 403);
  assert.equal(craft.body.error, 'craft-token-scope');
  const arkBuy = await callServer(runtime, { pathname: '/np-shop/buy', token: 'ark-token', body: '{}' });
  assert.equal(arkBuy.status, 403);
  assert.equal(arkBuy.body.error, 'ark-token-scope');
  const arkClaim = await callServer(runtime, { pathname: '/np-shop/claim', token: 'ark-token', body: '{}' });
  assert.equal(arkClaim.status, 200);
  assert.equal(arkClaim.body.order.orderId, 'claimed');
  const credit = await callServer(runtime, { pathname: '/wallet/credit', token: 'sentinal-token', body: '{}' });
  assert.equal(credit.status, 503);
  assert.equal(credit.body.error, 'economy-write-cutover-not-enabled');
  const req = { headers: { authorization: 'Bearer ark-token' } };
  assert.equal(requestScope(req, { token: 'sentinal-token', craftToken: 'craft-token', arkToken: 'ark-token' }), 'ark');
  assert.equal(ARK_DELIVERY_ROUTES.has('POST /np-shop/claim'), true);
  runtime.server.close();
});

test('staff command names and the owner allow-list', () => {
  assert.equal(shopCommand().name, 'shop');
  assert.equal(pointsCommand().name, 'points');
  assert.equal(adminCommand().name, 'arkshop-admin');
  const config = { discord: { ownerUserIds: ['999'] } };
  assert.equal(isArkStaff({ user: { id: '999' }, memberPermissions: { has: () => false } }, config), true);
  assert.equal(isArkStaff({
    user: { id: '1' },
    memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator }
  }, config), true);
  assert.equal(isArkStaff({ user: { id: '1' }, memberPermissions: { has: () => false } }, config), false);
  const adminRole = '222222222222222222';
  assert.equal(isArkStaff({
    user: { id: '5' },
    memberPermissions: { has: () => false },
    member: { roles: { cache: { keys: () => [adminRole] } } }
  }, config, { NEXUS_STAFF_ADMIN_ROLE_IDS: adminRole }), true);
  assert.equal(isArkStaff({
    user: { id: '42' },
    guild: { ownerId: '42' },
    memberPermissions: { has: () => false }
  }, config, {}), true);
  const guildId = '444444444444444444';
  function staffInteraction(roleList, { userId = '333333333333333333', perms = [] } = {}) {
    return {
      user: { id: userId },
      guild: { id: guildId, ownerId: '999999999999999999' },
      member: {
        guild: { id: guildId },
        roles: { cache: new Map(roleList.map((role) => [role.id, role])) }
      },
      memberPermissions: { has: (bit) => perms.includes(bit) }
    };
  }
  const everyoneRole = { id: guildId, name: '@everyone', managed: false };
  const managedRole = '555555555555555555';
  const bothLists = '666666666666666666';
  const communityManager = '1521219329360920767';
  const ownerRole = '1616602943670059102';
  assert.equal(isArkStaff(staffInteraction([everyoneRole]), config, { NEXUS_STAFF_ADMIN_ROLE_IDS: guildId }), false);
  assert.equal(isArkStaff(staffInteraction([
    everyoneRole,
    { id: managedRole, name: 'Bots', managed: true, permissions: 8 }
  ]), config, { NEXUS_STAFF_ADMIN_ROLE_IDS: managedRole }), false);
  assert.equal(isArkStaff(staffInteraction([
    everyoneRole,
    { id: bothLists, name: 'Mod', managed: false }
  ]), config, {
    NEXUS_STAFF_ADMIN_ROLE_IDS: bothLists,
    NEXUS_STAFF_MOD_ROLE_IDS: bothLists
  }), false);
  assert.equal(isArkStaff(staffInteraction([
    everyoneRole,
    { id: communityManager, name: 'Community Manager', managed: false, permissions: 8 }
  ]), config, { NEXUS_STAFF_ADMIN_ROLE_IDS: communityManager }), false);
  assert.equal(isArkStaff(staffInteraction([
    everyoneRole,
    { id: ownerRole, name: 'Owner', managed: false, permissions: 8 }
  ]), config, { NEXUS_STAFF_ADMIN_ROLE_IDS: ownerRole }), false);
  assert.equal(isArkStaff(staffInteraction([
    everyoneRole,
    { id: communityManager, name: 'Community Manager', managed: false },
    { id: ownerRole, name: 'Owner', managed: false, permissions: 8 },
    { id: adminRole, name: 'Admin', managed: false }
  ]), config, { NEXUS_STAFF_ADMIN_ROLE_IDS: adminRole }), true);
});

test('post-snapshot identities stay out of the approval hash', () => {
  const base = classifyPopulation([person('econ_a', { discord: '100000000000000041', eos: ['EOSPOST0001'] })]);
  const extra = classifyPopulation([
    person('econ_a', { discord: '100000000000000041', eos: ['EOSPOST0001'] }),
    person('econ_late', { discord: '100000000000000042', eos: ['EOSPOST0001'], createdAt: AFTER })
  ]);
  assert.equal(extra.rows.find((row) => row.econId === 'econ_a').skipReason, '');
  assert.equal(extra.rows.find((row) => row.econId === 'econ_late').skipReason, 'not_verified');
  assert.equal(base.eligibleCount, extra.eligibleCount);
  assert.equal(base.hash, extra.hash);
  assert.equal(evaluateExecuteGate({
    envHash: base.hash,
    computedHash: extra.hash,
    eligibleCount: extra.eligibleCount,
    total: extra.total,
    approvedCount: extra.eligibleCount,
    approvedTotal: extra.total
  }).ok, true);
  assert.equal(evaluateExecuteGate({
    envHash: 'aa',
    computedHash: 'aa',
    eligibleCount: 2,
    total: 1500,
    approvedCount: 2,
    approvedTotal: 3000
  }).reason, 'total-mismatch');
  assert.equal(evaluateExecuteGate({
    envHash: 'aa',
    computedHash: 'aa',
    eligibleCount: MAX_LEGACY_FLAT_GRANTS + 1,
    total: (MAX_LEGACY_FLAT_GRANTS + 1) * AMOUNT,
    approvedCount: MAX_LEGACY_FLAT_GRANTS + 1,
    approvedTotal: (MAX_LEGACY_FLAT_GRANTS + 1) * AMOUNT
  }).reason, 'hard-cap');
  assert.equal(evaluateExecuteGate({
    envHash: 'aa',
    computedHash: 'aa',
    eligibleCount: 1,
    total: AMOUNT,
    approvedCount: MAX_LEGACY_FLAT_GRANTS + 1,
    approvedTotal: AMOUNT
  }).reason, 'hard-cap');
});

test('mint balance migration is locked, idempotent, and absent when the flag is off', async () => {
  await assert.rejects(
    () => ensureBatchSchema({ async connect() { throw new Error('should not connect'); } }, 'public', {}),
    /legacy-bank-flat-disabled/
  );
  const strict = [
    { conname: 'nexus_economic_identities_status_check', relname: 'nexus_economic_identities', def: "CHECK (status IN ('verified', 'restricted', 'disabled'))" },
    { conname: 'nexus_economy_wallets_balance_check', relname: 'nexus_economy_wallets', def: 'CHECK (balance >= 0)' },
    { conname: 'nexus_economy_ledger_balance_after_check', relname: 'nexus_economy_ledger', def: 'CHECK (balance_after >= 0)' }
  ];
  async function run(rows) {
    const sql = [];
    const client = {
      async query(text) {
        sql.push(String(text));
        if (String(text).includes('pg_constraint')) return { rows };
        return { rowCount: 1, rows: [] };
      },
      release() {}
    };
    await ensureBatchSchema({ async connect() { return client; } }, 'public', { NEXUS_LEGACY_BANK_FLAT_ENABLED: 'true' });
    return sql.join('\n');
  }
  const migrated = await run(strict);
  assert.match(migrated, /BEGIN/);
  assert.match(migrated, /lock_timeout = '5s'/);
  assert.ok(migrated.indexOf('lock_timeout') < migrated.indexOf('CREATE TABLE'));
  assert.match(migrated, /pg_advisory_xact_lock/);
  assert.match(migrated, /DROP CONSTRAINT IF EXISTS/);
  assert.match(migrated, /NOT VALID/);
  assert.match(migrated, /VALIDATE CONSTRAINT/);
  assert.match(migrated, /COMMIT/);
  const again = await run(strict.map((row) => ({
    ...row,
    def: row.relname === 'nexus_economic_identities'
      ? "CHECK (status IN ('verified', 'restricted', 'disabled', 'system'))"
      : `${row.def.slice(0, -1)} OR economic_identity_id LIKE 'system:mint:%')`
  })));
  assert.doesNotMatch(again, /ALTER TABLE/);
  let rolledBack = false;
  await assert.rejects(async () => {
    await ensureBatchSchema({
      async connect() {
        return {
          async query(text) {
            if (String(text) === 'ROLLBACK') rolledBack = true;
            if (/pg_advisory_xact_lock/.test(String(text))) {
              const error = new Error('canceling statement due to lock timeout');
              error.code = '55P03';
              throw error;
            }
            return { rows: [] };
          },
          release() {}
        };
      }
    }, 'public', { NEXUS_LEGACY_BANK_FLAT_ENABLED: 'true' });
  }, (error) => error.code === 'lock-timeout');
  assert.equal(rolledBack, true);
});

test('legacy dry-run does not write and a missing contra aborts', async () => {
  const sql = [];
  const client = {
    async query(text) {
      const query = String(text);
      sql.push(query);
      if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(query)) throw new Error(`write ${query}`);
      if (/to_regclass/.test(query)) return { rows: [{ reg: 'present' }] };
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const preview = await dryRun({ pool, schema: 'public', operator: 'reader' });
  assert.equal(preview.ok, true);
  assert.equal(preview.eligibleCount, 0);
  assert.equal(sql.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
  const missing = await dryRun({
    pool: {
      async connect() {
        return {
          async query(text) {
            if (/to_regclass/.test(String(text))) return { rows: [{ reg: null }] };
            if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(String(text))) throw new Error('write');
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    operator: 'reader'
  });
  assert.equal(missing.reason, 'schema-missing');
  let wrote = false;
  await assert.rejects(grantOne({
    async connect() {
      return {
        async query(text) {
          const query = String(text);
          if (/\bCOMMIT\b/.test(query)) wrote = true;
          if (/SELECT status/.test(query)) return { rows: [{ status: 'verified' }] };
          if (/legacy_bank_flat_contra/.test(query)) return { rowCount: 0, rows: [] };
          if (/INSERT INTO/.test(query) && /nexus_economy_ledger/.test(query)) return { rowCount: 1, rows: [{ id: 1 }] };
          if (/SELECT balance/.test(query)) return { rows: [{ balance: 0 }] };
          return { rowCount: 1, rows: [] };
        },
        release() {}
      };
    }
  }, 'public', { econId: 'econ_x', eosIds: ['EOSXXXX0001'], amount: 1500, skipReason: '' }, {
    env: {},
    operator: 'op',
    host: 'host',
    sha: 'abc',
    batchName: 'legacy-bank-flat-2026-10',
    approvalRef: 'ref',
    listHash: 'hash',
    denylistHash: 'deny'
  }), /contra-insert-missing/);
  assert.equal(wrote, false);
  const disabled = await execute({
    pool: { async query() { throw new Error('called'); }, async connect() { throw new Error('called'); } },
    operator: 'op',
    approvalRef: 'ref',
    approvedCount: 0,
    approvedTotal: 0,
    env: {}
  });
  assert.equal(disabled.reason, 'legacy-bank-flat-disabled');
  const reversed = await reverseCredit({
    pool: { async query() { throw new Error('called'); }, async connect() { throw new Error('called'); } },
    econId: 'econ_x',
    operator: 'op',
    confirm: true,
    env: {}
  });
  assert.equal(reversed.reason, 'legacy-bank-flat-disabled');
  assert.equal(MINT_ID.startsWith('system:mint:'), true);
  assert.match(memberPointSumSql('public'), /NOT LIKE 'system:%'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../docs/ops/LEGACY_BANK_FLAT.md'), 'utf8'), /incomplete marker/);
  const plan = fs.readFileSync(path.join(__dirname, '../docs/architecture/ARK_NP_SHOP_REBUILD_PLAN_2026-10-02.md'), 'utf8');
  assert.match(plan, /−1500 × grants/);
  assert.equal((plan.match(/−1500 × grants/g) || []).length >= 2, true);
});

test('points reads do not create schema and staff refund actors are checked on the server', async () => {
  const sql = [];
  const shop = new PostgresArkShop({
    pool: {
      async connect() {
        return {
          async query(text) {
            const query = String(text);
            sql.push(query);
            if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)) throw new Error(`write ${query}`);
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    env: {}
  });
  const activity = await shop.activity('100000000000000099');
  assert.equal(activity.linked, false);
  assert.equal(sql.some((query) => /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(query)), false);
  const blocked = await shop.refund({ staff: true, actor: '100000000000000077', orderId: 'order', reason: 'check', administrator: true });
  assert.equal(blocked.reason, 'staff-required');
  const actor = '333333333333333333';
  const adminRole = '222222222222222222';
  const env = {
    NEXUS_DISCORD_GUILD_ID: '444444444444444444',
    NEXUS_SENTINAL_DISCORD_TOKEN: 'token',
    NEXUS_STAFF_ADMIN_ROLE_IDS: adminRole
  };
  function discordFetch({ owner = '9', memberRoles = [], permissions = {}, managed = {}, names = {} }) {
    return async (url) => {
      if (String(url).includes('/members/')) return { ok: true, json: async () => ({ roles: memberRoles }) };
      if (String(url).endsWith('/roles')) {
        return {
          ok: true,
          json: async () => memberRoles.map((id) => ({
            id,
            name: names[id] || '',
            permissions: String(permissions[id] || 0),
            managed: managed[id] === true
          }))
        };
      }
      return { ok: true, json: async () => ({ owner_id: owner }) };
    };
  }
  const allowed = await authorizeStaffRefundActor({
    actor,
    env,
    fetchImpl: discordFetch({ memberRoles: [adminRole] })
  });
  assert.equal(allowed.ok, true);
  const denied = await authorizeStaffRefundActor({
    actor,
    env,
    fetchImpl: discordFetch({ memberRoles: ['555555555555555555'] }),
    administrator: true,
    roleIds: [adminRole]
  });
  assert.equal(denied.reason, 'staff-required');
  const administrator = await authorizeStaffRefundActor({
    actor,
    env: { ...env, NEXUS_STAFF_ADMIN_ROLE_IDS: '' },
    fetchImpl: discordFetch({ memberRoles: ['555555555555555555'], permissions: { '555555555555555555': 8 } })
  });
  assert.equal(administrator.ok, true);
  const owner = await authorizeStaffRefundActor({
    actor,
    env: { NEXUS_DISCORD_GUILD_ID: env.NEXUS_DISCORD_GUILD_ID, NEXUS_SENTINAL_DISCORD_TOKEN: 'token' },
    fetchImpl: discordFetch({ owner: actor, memberRoles: [] })
  });
  assert.equal(owner.ok, true);
  const offline = await authorizeStaffRefundActor({
    actor,
    env: { NEXUS_DISCORD_GUILD_ID: env.NEXUS_DISCORD_GUILD_ID },
    fetchImpl: async () => { throw new Error('should not fetch'); }
  });
  assert.equal(offline.reason, 'staff-required');
  const managedRole = await authorizeStaffRefundActor({
    actor,
    env,
    fetchImpl: discordFetch({ memberRoles: [adminRole, env.NEXUS_DISCORD_GUILD_ID], managed: { [adminRole]: true } })
  });
  assert.equal(managedRole.reason, 'staff-required');
  const everyone = await authorizeStaffRefundActor({
    actor,
    env: { ...env, NEXUS_STAFF_ADMIN_ROLE_IDS: env.NEXUS_DISCORD_GUILD_ID },
    fetchImpl: discordFetch({ memberRoles: [env.NEXUS_DISCORD_GUILD_ID] })
  });
  assert.equal(everyone.reason, 'staff-required');
  const bothLists = '666666666666666666';
  const listedTwice = await authorizeStaffRefundActor({
    actor,
    env: { ...env, NEXUS_STAFF_ADMIN_ROLE_IDS: bothLists, NEXUS_STAFF_MOD_ROLE_IDS: bothLists },
    fetchImpl: discordFetch({ memberRoles: [bothLists] })
  });
  assert.equal(listedTwice.reason, 'staff-required');
  const communityManager = '1521219329360920767';
  const ownerRole = '1616602943670059102';
  const community = await authorizeStaffRefundActor({
    actor,
    env: { ...env, NEXUS_STAFF_ADMIN_ROLE_IDS: communityManager },
    fetchImpl: discordFetch({
      memberRoles: [communityManager],
      permissions: { [communityManager]: 8 },
      names: { [communityManager]: 'Community Manager' }
    })
  });
  assert.equal(community.reason, 'staff-required');
  const ownerRoleDenied = await authorizeStaffRefundActor({
    actor,
    env: { ...env, NEXUS_STAFF_ADMIN_ROLE_IDS: ownerRole },
    fetchImpl: discordFetch({
      memberRoles: [ownerRole],
      permissions: { [ownerRole]: 8 },
      names: { [ownerRole]: 'Owner' }
    })
  });
  assert.equal(ownerRoleDenied.reason, 'staff-required');
  const managedAdminBit = await authorizeStaffRefundActor({
    actor,
    env,
    fetchImpl: discordFetch({
      memberRoles: [adminRole],
      permissions: { [adminRole]: 8 },
      managed: { [adminRole]: true }
    })
  });
  assert.equal(managedAdminBit.reason, 'staff-required');
  const shopSource = fs.readFileSync(path.join(__dirname, '../src/economy-worker/ark-np-postgres.cjs'), 'utf8');
  const activitySource = shopSource.slice(shopSource.indexOf('async activity('), shopSource.indexOf('async #authorizeStaff('));
  assert.equal(activitySource.includes('ensureSchema'), false);
  const refundSource = shopSource.slice(shopSource.indexOf('async refund('), shopSource.indexOf('async sweepRefunds('));
  assert.equal(refundSource.includes('Checked again inside the lock'), false);
  assert.match(refundSource, /#authorizeStaff/);
  assert.match(shopSource, /ark-staff-refund:/);
  const capSource = shopSource.slice(shopSource.indexOf('async #staffCap'));
  assert.match(capSource, /now\(\) AT TIME ZONE 'America\/Chicago'/);
  assert.doesNotMatch(capSource, /this\.now\(\)/);
  const shared = new PostgresArkShop({
    pool: {
      async connect() {
        return {
          async query(text) {
            const query = String(text);
            if (/nexus_mc_orders|nexus_mc_links/.test(query)) {
              const error = new Error('relation does not exist');
              error.code = '42P01';
              throw error;
            }
            if (/nexus_economic_identities/.test(query)) return { rows: [{ economic_identity_id: 'econ_shared', status: 'verified' }] };
            if (/provider = 'eos'/.test(query)) return { rows: [{ external_id: 'EOSSHARED01' }] };
            if (/nexus_economy_wallets/.test(query)) return { rows: [{ balance: 1500 }] };
            if (/nexus_economy_ledger/.test(query)) return { rows: [] };
            return { rows: [] };
          },
          release() {}
        };
      }
    },
    env: {}
  });
  const points = await shared.activity('100000000000000099');
  assert.equal(points.linked, true);
  assert.equal(points.balance, 1500);
  assert.deepEqual(points.orders, []);
  assert.notEqual(points.reason, 'schema-missing');
});
