'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CoinShopService } = require('../src/economy-worker/coin-shop-service.cjs');
const {
  createEconomyServer,
  writeGate,
  COIN_SHOP_FINANCIAL_PATHS,
  FINANCIAL_WRITE_PATHS
} = require('../src/economy-worker/server.cjs');
const { coinShopFlags, purchaseCeiling } = require('../src/shared/coin-shop-flags.cjs');
const { ITEMS, OMITTED, catalogItem } = require('../src/shared/coin-shop-catalog.cjs');
const { purchaseKey, refundKey, chicagoDayKey, coinShopReceiptRef } = require('../src/shared/coin-shop-limits.cjs');
const { GATE_OFF, COSMETIC_FOOTER, INELIGIBLE, coinShopMemberText, memberReceipt } = require('../src/shared/coin-shop-copy.cjs');
const { isCoinShopAdmin, acceptVerifiedStaff } = require('../src/economy-worker/coin-shop-staff.cjs');
const { COMMUNITY_MANAGER_ROLE_ID, OWNER_ROLE_ID } = require('../src/economy-worker/ark-staff-auth.cjs');
const { WalletCosmeticsService } = require('../src/backend/services/wallet-cosmetics-service.cjs');
const { walletEquipRow } = require('../src/sentinel/wallet-cosmetics-ui.cjs');
const { handleWalletInteraction, syncWalletView } = require('../src/sentinel/wallet-cosmetics-extension.cjs');
const { handleCoinShopInteraction, parseCoinCustomId, shopCommand, shopAdminCommand, registerCoinShopCommands, artFile, artForEmbed } = require('../src/sentinel/coin-shop-ui.cjs');
const { EmbedBuilder } = require('discord.js');

const USER = '123456789012345678';
const OTHER = '223456789012345678';
const DAY = Date.parse('2026-10-06T18:00:00.000Z');

function shop(overrides = {}) {
  let now = overrides.nowMs || DAY;
  const service = new CoinShopService({
    now: () => now,
    env: {
      NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED: 'true',
      NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '1000',
      ...(overrides.env || {})
    },
    authorizeStaff: async (input) => ({ ok: true, actor: String(input?.actor || '424242424242424242') })
  });
  service.seed({
    discordUserId: overrides.discordUserId || USER,
    econId: overrides.econId || 'econ-1',
    coins: overrides.coins == null ? 420 : overrides.coins,
    points: overrides.points == null ? 80 : overrides.points,
    status: overrides.status || 'verified',
    holdReason: overrides.holdReason || '',
    verifiedAt: Object.prototype.hasOwnProperty.call(overrides, 'verifiedAt') ? overrides.verifiedAt : '2026-01-01T00:00:00.000Z',
    linkSource: overrides.linkSource || '',
    rankId: overrides.rankId || 'cipher-runner'
  });
  service.moveClock = (value) => { now = value; };
  return service;
}

async function buy(service, sku = 'ttl_night_owl', discordUserId = USER) {
  const quoted = await service.quote({ discordUserId, sku });
  assert.equal(quoted.ok, true, quoted.reason);
  const result = await service.purchase({ discordUserId, sku, nonce: quoted.quote.nonce });
  return { quoted, result };
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

function mockInteraction(partial = {}) {
  const interaction = {
    commandName: partial.commandName || '',
    customId: partial.customId || '',
    values: partial.values || [],
    user: { id: partial.userId || USER },
    deferred: false,
    replied: false,
    replies: [],
    updates: [],
    isChatInputCommand: () => partial.kind === 'command',
    isButton: () => partial.kind === 'button',
    isStringSelectMenu: () => partial.kind === 'select',
    options: partial.options || {},
    async reply(payload) { interaction.replied = true; interaction.replies.push(payload); },
    async deferReply() { interaction.deferred = true; },
    async update(payload) { interaction.updates.push(payload); },
    async editReply(payload) { interaction.updates.push(payload); }
  };
  return interaction;
}

test('coin shop flags and the purchase ceiling default closed', () => {
  assert.equal(coinShopFlags({}).shopEnabled, false);
  assert.equal(coinShopFlags({}).spendEnabled, false);
  assert.equal(purchaseCeiling({}), 1000);
  assert.equal(purchaseCeiling({ NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '1000' }), 1000);
  assert.equal(purchaseCeiling({ NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '250' }), 250);
  assert.equal(purchaseCeiling({ NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '5000' }), 1000);
  assert.equal(purchaseCeiling({ NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: 'nope' }), null);
  assert.equal(COIN_SHOP_FINANCIAL_PATHS.has('/coin-shop/purchase'), true);
  assert.equal(COIN_SHOP_FINANCIAL_PATHS.has('/coin-shop/refund'), true);
  assert.equal(FINANCIAL_WRITE_PATHS.has('/wallet/credit'), true);
  assert.equal(writeGate('/coin-shop/purchase', { writesEnabled: false, coinShopSpendEnabled: false }).body.error, 'economy-coin-shop-spend-not-enabled');
  assert.equal(writeGate('/coin-shop/purchase', { writesEnabled: false, coinShopSpendEnabled: true }), null);
  assert.equal(writeGate('/wallet/credit', { writesEnabled: false, coinShopSpendEnabled: true }).body.error, 'economy-write-cutover-not-enabled');
  assert.equal(writeGate('/wallet/spend', { writesEnabled: false, coinShopSpendEnabled: true }).body.error, 'economy-write-cutover-not-enabled');
  assert.equal(writeGate('/np-shop/buy', { writesEnabled: false, coinShopSpendEnabled: true }).body.error, 'economy-np-shop-writes-not-enabled');
});

test('catalog keeps spine items only and leaves frame, flair, and colour roles out', () => {
  assert.deepEqual(ITEMS.map((item) => [item.sku, item.price, item.slot]), [
    ['thm_nebula', 285, 'theme'],
    ['thm_circuit', 315, 'theme'],
    ['ttl_night_owl', 195, 'title']
  ]);
  assert.deepEqual(OMITTED.map((item) => item.sku), ['frm_steel', 'flr_spark', 'timed-colour-roles']);
  assert.equal(ITEMS.some((item) => /frame|flair|role|colour|color/i.test(item.sku)), false);
  for (const item of ITEMS) assert.ok(catalogItem(item.sku));
});

test('purchase happy path debits Coins, writes the sink ledger, and grants an entitlement', async () => {
  const service = shop();
  const { quoted, result } = await buy(service);
  assert.equal(quoted.quote.balance, 420);
  assert.equal(quoted.quote.balanceAfter, 225);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.balance, 225);
  assert.equal(result.ledgerRef, purchaseKey('econ-1', 'ttl_night_owl', quoted.quote.nonce));
  assert.equal(service.coinBalance(USER), 225);
  assert.equal(service.pointBalance(USER), 80);
  assert.equal(service.ledger.length, 1);
  assert.equal(service.ledger[0].currency, 'NEXUS_COINS');
  assert.equal(service.ledger[0].source, 'sink:coin-shop');
  assert.equal(service.ledger[0].amount, -195);
  assert.equal(result.entitlement.status, 'active');
  assert.equal(result.entitlement.sku, 'ttl_night_owl');
});

test('insufficient Coins, owned, cap, ceiling, and unknown SKU spend nothing', async () => {
  const poor = shop({ coins: 10 });
  const denied = await poor.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(denied.reason, 'insufficient-coins');
  assert.equal(denied.shortfall, 185);
  const shortCopy = coinShopMemberText(denied.reason, denied);
  assert.match(shortCopy, /185 more Coins/);
  assert.match(shortCopy, /chatting/);
  assert.match(shortCopy, /voice/);
  assert.match(shortCopy, /levelling up/);
  assert.match(shortCopy, /events/);
  assert.equal(poor.coinBalance(USER), 10);
  assert.equal(poor.ledger.length, 0);

  const owned = shop();
  await buy(owned);
  const again = await owned.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(again.reason, 'owned');
  assert.equal(owned.coinBalance(USER), 225);

  const capped = shop({ coins: 2000 });
  capped.seedSpend('econ-1', { at: DAY, amount: 1400 });
  const over = await capped.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(over.reason, 'daily-cap');
  assert.equal(capped.coinBalance(USER), 2000);
  assert.equal(chicagoDayKey(DAY), '2026-10-06');

  const lowCeiling = shop({ env: { NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '100' } });
  const tooBig = await lowCeiling.quote({ discordUserId: USER, sku: 'thm_nebula' });
  assert.equal(tooBig.reason, 'ceiling');
  assert.equal(lowCeiling.coinBalance(USER), 420);

  const unset = shop({ env: { NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: 'nope' } });
  const closed = await unset.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(closed.reason, 'ceiling-unset');
  assert.equal(unset.ledger.length, 0);

  const unknown = shop();
  const missing = await unknown.purchase({ discordUserId: USER, sku: 'frm_steel', nonce: 'n1' });
  assert.equal(missing.reason, 'unknown-sku');
  assert.equal(unknown.coinBalance(USER), 420);
  assert.equal(unknown.pointBalance(USER), 80);
});

test('Points are rejected and never move', async () => {
  const service = shop();
  const result = await service.purchase({
    discordUserId: USER,
    sku: 'ttl_night_owl',
    nonce: 'np-1',
    currency: 'NEXUS_POINTS'
  });
  assert.equal(result.reason, 'currency-rejected');
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.pointBalance(USER), 80);
  assert.equal(service.ledger.length, 0);
  const gift = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl', recipientUserId: OTHER });
  assert.equal(gift.reason, 'no-gifting');
  assert.equal(service.coinBalance(USER), 420);
});

test('the spend gate returns 503 and still refuses global writes', async () => {
  let called = 0;
  const closed = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: false,
    coinShopSpendEnabled: false,
    worker: {
      health() { return { ok: true }; },
      coinShop: { purchase: async () => { called += 1; return { ok: true }; } }
    },
    shop: { listCatalog() { return []; }, pendingBuyOrders() { return []; } }
  });
  const blocked = await callServer(closed, { pathname: '/coin-shop/purchase', token: 'sentinal-token', body: '{}' });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.error, 'economy-coin-shop-spend-not-enabled');
  assert.equal(called, 0);
  const credit = await callServer(closed, { pathname: '/wallet/credit', token: 'sentinal-token', body: '{}' });
  assert.equal(credit.status, 503);
  assert.equal(credit.body.error, 'economy-write-cutover-not-enabled');
  closed.server.close();

  const service = shop();
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    writesEnabled: false,
    coinShopSpendEnabled: true,
    worker: { health() { return { ok: true }; }, coinShop: service },
    shop: { listCatalog() { return []; }, pendingBuyOrders() { return []; } }
  });
  const quoted = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  const bought = await callServer(runtime, {
    pathname: '/coin-shop/purchase',
    token: 'sentinal-token',
    body: JSON.stringify({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce })
  });
  assert.equal(bought.status, 200);
  assert.equal(bought.body.balance, 225);
  assert.equal(service.pointBalance(USER), 80);
  const craft = await callServer(runtime, { pathname: '/coin-shop/purchase', token: 'craft-token', body: '{}' });
  assert.equal(craft.status, 403);
  const points = await callServer(runtime, {
    pathname: '/coin-shop/purchase',
    token: 'sentinal-token',
    body: JSON.stringify({ discordUserId: USER, sku: 'thm_nebula', nonce: 'x', currency: 'NEXUS_POINTS' })
  });
  assert.equal(points.status, 409);
  assert.equal(points.body.reason, 'currency-rejected');
  assert.equal(service.pointBalance(USER), 80);
  runtime.server.close();
});

test('replay is idempotent and a second nonce is in flight', async () => {
  const service = shop({ coins: 2000 });
  const quoted = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  const first = await service.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
  const replay = await service.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: quoted.quote.nonce });
  assert.equal(first.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.balance, 2000 - 195);
  assert.equal(service.ledger.filter((row) => row.amount < 0).length, 1);
  assert.equal(replay.ledgerRef, first.ledgerRef);

  const fresh = shop({ coins: 2000 });
  const night = await fresh.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  const nebula = await fresh.quote({ discordUserId: USER, sku: 'thm_nebula' });
  const left = fresh.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: night.quote.nonce });
  const right = fresh.purchase({ discordUserId: USER, sku: 'thm_nebula', nonce: nebula.quote.nonce });
  assert.equal((await right).reason, 'in-flight');
  assert.equal((await left).ok, true);
  assert.equal(fresh.coinBalance(USER), 2000 - 195);
  assert.equal(fresh.ledger.filter((row) => row.amount < 0).length, 1);

  const doubled = shop({ coins: 2000 });
  const once = await doubled.quote({ discordUserId: USER, sku: 'thm_circuit' });
  const a = doubled.purchase({ discordUserId: USER, sku: 'thm_circuit', nonce: once.quote.nonce });
  const b = doubled.purchase({ discordUserId: USER, sku: 'thm_circuit', nonce: once.quote.nonce });
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb);
  assert.equal(ra.ok, true);
  assert.equal(doubled.coinBalance(USER), 2000 - 315);
  assert.equal(doubled.pointBalance(USER), 80);
});

test('five attempts in ten minutes is the limit', async () => {
  const service = shop();
  for (let index = 0; index < 5; index += 1) {
    const result = await service.purchase({ discordUserId: USER, sku: 'not-a-sku', nonce: `bad-${index}` });
    assert.equal(result.reason, 'unknown-sku');
  }
  const blocked = await service.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: 'later' });
  assert.equal(blocked.reason, 'rate-limited');
  assert.equal(service.coinBalance(USER), 420);
});

test('restricted, shadow recruit, quarantined, held, and disabled members cannot spend', async () => {
  const cases = [
    { status: 'restricted', verifiedAt: null, rankId: 'shadow-recruit' },
    { status: 'disabled', rankId: 'cipher-runner' },
    { status: 'verified', holdReason: 'staff' },
    { status: 'quarantined' },
    { status: 'verified', rankId: 'shadow-recruit' },
    { status: 'verified', verifiedAt: null },
    { status: 'verified', env: { NEXUS_ECONOMY_QUARANTINE_DENYLIST: 'econ-1' } }
  ];
  for (const item of cases) {
    const service = shop(item);
    const result = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(result.reason, 'not-eligible', JSON.stringify(item));
    assert.equal(service.coinBalance(USER), 420);
    assert.equal(service.pointBalance(USER), 80);
    assert.equal(service.ledger.length, 0);
  }
  assert.equal(coinShopMemberText('not-eligible'), INELIGIBLE);
  assert.match(INELIGIBLE, /staff member/);
  assert.doesNotMatch(INELIGIBLE, /\/o9verify|\/verify\b|#verify/);
  assert.doesNotMatch(INELIGIBLE, /shadow|quarantine|restricted|disabled|hold/i);
});

test('an MC-link-verified restricted member is refused', async () => {
  const restricted = shop({
    status: 'restricted',
    verifiedAt: '2026-10-01T00:00:00.000Z',
    linkSource: 'mc-link',
    rankId: 'shadow-recruit'
  });
  assert.equal(restricted.identityView(USER).verifiedAt, null);
  const quoted = await restricted.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(quoted.reason, 'not-eligible');
  const bought = await restricted.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: 'mc-link' });
  assert.equal(bought.reason, 'not-eligible');
  assert.equal(restricted.coinBalance(USER), 420);
  assert.equal(restricted.ledger.length, 0);

  const stamped = shop({
    status: 'verified',
    verifiedAt: '2026-10-01T00:00:00.000Z',
    linkSource: 'mc-link'
  });
  assert.equal(stamped.identityView(USER).verifiedAt, null);
  const stillBlocked = await stamped.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(stillBlocked.reason, 'not-eligible');
  assert.equal(stamped.coinBalance(USER), 420);
  assert.equal(stamped.ledger.length, 0);
});

test('system accounts cannot purchase or be refunded', async () => {
  const service = shop({ econId: 'system:mint:coins' });
  const quoted = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
  assert.equal(quoted.reason, 'not-eligible');
  const bought = await service.purchase({ discordUserId: USER, sku: 'ttl_night_owl', nonce: 'system-nonce' });
  assert.equal(bought.reason, 'not-eligible');
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.ledger.length, 0);

  const member = shop();
  const { result } = await buy(member);
  member.ledger[0].econId = 'system:mint:coins';
  member.entitlements[0].econId = 'system:mint:coins';
  const refunded = await member.refund({ ledgerRef: result.ledgerRef, reason: 'system account', actor: USER });
  assert.equal(refunded.reason, 'not-eligible');
  assert.equal(member.coinBalance(USER), 225);
  assert.equal(member.entitlements[0].status, 'active');
});

test('the receipt uses a short ref and a short ref can be refunded', async () => {
  const service = shop();
  const { result } = await buy(service);
  assert.equal(coinShopReceiptRef(result.ledgerId), 'CS-0001');
  assert.equal(memberReceipt(result), 'New balance: 225 Coins\nRef: CS-0001');
  assert.doesNotMatch(memberReceipt(result), /coin-shop:/);
  const refunded = await service.refund({ ledgerRef: 'CS-0001', reason: 'short ref', actor: OTHER });
  assert.equal(refunded.ok, true, refunded.reason);
  assert.equal(service.coinBalance(USER), 420);
  assert.doesNotMatch(memberReceipt(refunded), /coin-shop:/);
});

test('staff can refund an unused purchase once inside 24 hours', async () => {
  const service = shop();
  const { result } = await buy(service);
  const refunded = await service.refund({ ledgerRef: result.ledgerRef, reason: 'bought the wrong theme', actor: OTHER });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.duplicate, false);
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.pointBalance(USER), 80);
  assert.equal(refunded.ledgerRef, refundKey(result.ledgerId));
  assert.equal(service.entitlementsFor(USER).entitlements[0].status, 'refunded');
  const again = await service.refund({ ledgerRef: result.ledgerRef, reason: 'second try', actor: OTHER });
  assert.equal(again.duplicate, true);
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.ledger.filter((row) => row.entryType === 'refund').length, 1);

  const worn = shop();
  const wornBuy = await buy(worn);
  await worn.markEquipped({ discordUserId: USER, sku: 'ttl_night_owl' });
  const used = await worn.refund({ ledgerRef: wornBuy.result.ledgerRef, reason: 'changed my mind', actor: OTHER });
  assert.equal(used.ok, true, used.reason);
  assert.equal(worn.coinBalance(USER), 420);
  assert.equal(worn.entitlementsFor(USER).entitlements[0].status, 'refunded');
  assert.equal(worn.entitlementsFor(USER).entitlements[0].equippedAt, null);

  const missing = shop();
  const missingBuy = await buy(missing);
  missing.entitlements.length = 0;
  const revoked = await missing.refund({ ledgerRef: missingBuy.result.ledgerRef, reason: 'no entitlement', actor: OTHER });
  assert.equal(revoked.reason, 'revoke-failed');
  assert.equal(missing.coinBalance(USER), 225);
  assert.equal(missing.ledger.filter((row) => row.entryType === 'refund').length, 0);

  const late = shop();
  const lateBuy = await buy(late);
  late.moveClock(DAY + (24 * 60 * 60 * 1000) + 1000);
  const expired = await late.refund({ ledgerRef: lateBuy.result.ledgerRef, reason: 'too late', actor: OTHER });
  assert.equal(expired.reason, 'refund-window');
  assert.equal(late.coinBalance(USER), 225);
});

test('an entitlement shows up in /wallet equip', async () => {
  const service = shop();
  const { result } = await buy(service);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-shop-wallet-'));
  try {
    const cosmetics = new WalletCosmeticsService({ stateFile: path.join(dir, 'wallet.json') });
    cosmetics.sync(USER, { level: 1, now: '2026-10-06T18:00:00.000Z' });
    assert.equal(cosmetics.profile(USER).profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, false);
    const granted = cosmetics.grantShopCosmetic(USER, { sku: result.sku, ledgerId: result.ledgerId });
    assert.equal(granted.ok, true);
    const profile = cosmetics.profile(USER).profile;
    assert.equal(profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, true);
    const equipped = cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    assert.equal(equipped.ok, true);
    assert.equal(equipped.profile.equippedTitleId, 'ttl_night_owl');
    const menu = walletEquipRow('title', equipped.profile, USER).toJSON();
    assert.ok(menu.components[0].options.some((option) => option.value === 'ttl_night_owl'));

    const backend = {
      async communityLevel() { return { ok: true, profile: { level: 1 } }; },
      async syncWalletCosmetics(userId, body) { return cosmetics.sync(userId, body); },
      async equipWalletCosmetic(userId, body) { return cosmetics.equip(userId, body); },
      async grantWalletCosmetic(userId, body) { return cosmetics.grantShopCosmetic(userId, body); },
      async walletCosmetics(userId) { return cosmetics.profile(userId); }
    };
    const economy = {
      configured() { return true; },
      async balances() { return { ok: true, balances: { NEXUS_COINS: 225, NEXUS_POINTS: 80, DINO_CACHE_TOKENS: 0 } }; },
      async coinShopEntitlements() { return { ok: true, entitlements: [{ sku: 'thm_nebula', status: 'active', ledgerId: 9 }] }; },
      async coinShopMarkEquipped() { return { ok: true }; }
    };
    const interaction = mockInteraction({ kind: 'command', commandName: 'wallet', options: { getSubcommand: () => 'cosmetics', getString: () => null } });
    assert.equal(await handleWalletInteraction(interaction, { backend, economyClient: economy }), true);
    const values = interaction.updates[0].components.flatMap((row) => {
      const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
      return (json.components?.[0]?.options || []).map((option) => option.value);
    });
    assert.ok(values.includes('thm_nebula'));
    assert.equal(cosmetics.profile(USER).profile.themes.find((item) => item.id === 'thm_nebula').unlocked, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buttonLabels(payload) {
  const row = payload.components?.[0];
  if (!row) return [];
  const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
  return (json.components || []).map((button) => button.label);
}

function fakeGuild(names = []) {
  const rows = names.map((name) => ({
    name,
    async delete() {
      const index = rows.findIndex((row) => row.name === name);
      if (index >= 0) rows.splice(index, 1);
    }
  }));
  return {
    rows,
    commands: {
      async fetch() {
        return { find: (pred) => rows.find(pred) };
      },
      async create(json) {
        rows.push({
          name: json.name,
          description: json.description,
          async delete() {
            const index = rows.findIndex((row) => row.name === json.name);
            if (index >= 0) rows.splice(index, 1);
          }
        });
      },
      async edit(existing, json) {
        existing.name = json.name;
        existing.description = json.description;
      }
    }
  };
}

test('the shop panel is ephemeral, locked to the buyer, and shows the balance change', async () => {
  const previousCoin = process.env.COIN_SHOP_ENABLED;
  const previousArk = process.env.ARK_SHOP_ENABLED;
  process.env.COIN_SHOP_ENABLED = 'true';
  process.env.ARK_SHOP_ENABLED = 'false';
  try {
    const panel = mockInteraction({ kind: 'button', customId: 'nxshop:coin' });
    await handleCoinShopInteraction(panel, {
      economyClient: {
        async balances() { return { balances: { NEXUS_COINS: 420 } }; },
        async coinShopEntitlements() { return { entitlements: [] }; }
      },
      backend: { async walletCosmetics() { return { profile: {} }; } }
    });
    const panelJson = panel.updates[0].embeds[0].toJSON();
    assert.equal(panelJson.image.url, 'attachment://coin-shop-panel-banner.png');
    assert.equal(panel.updates[0].files[0].name, 'coin-shop-panel-banner.png');
    const detail = mockInteraction({ kind: 'select', customId: `nxcoin:item:${USER}`, values: ['thm_circuit'] });
    await handleCoinShopInteraction(detail, { economyClient: {}, backend: {} });
    assert.equal(detail.updates[0].embeds[0].toJSON().image.url, 'attachment://item-circuit-wallet-theme.png');
    assert.equal(detail.updates[0].files[0].name, 'item-circuit-wallet-theme.png');
    const banner = fs.readFileSync(path.join(__dirname, '../src/shared/brand-assets/coin-shop/coin-shop-panel-banner.png'));
    assert.equal(banner.readUInt32BE(16), 1200);
    assert.equal(banner.readUInt32BE(20), 400);
    for (const file of ['item-nebula-wallet-theme.png', 'item-circuit-wallet-theme.png', 'item-night-owl-title.png']) {
      const card = fs.readFileSync(path.join(__dirname, '../src/shared/brand-assets/coin-shop', file));
      assert.equal(card.readUInt32BE(16), 512);
      assert.equal(card.readUInt32BE(20), 512);
    }
    const emptyArt = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-shop-art-'));
    try {
      const bare = new EmbedBuilder().setTitle('Coin shop');
      assert.deepEqual(artForEmbed(bare, 'coin-shop-panel-banner.png', emptyArt), []);
      assert.equal(bare.toJSON().image, undefined);
      assert.equal(artFile('item-circuit-wallet-theme.png', emptyArt), null);
      const missing = mockInteraction({ kind: 'button', customId: 'nxshop:coin', userId: OTHER });
      await handleCoinShopInteraction(missing, {
        artRoot: emptyArt,
        economyClient: {
          async balances() { return { balances: { NEXUS_COINS: 420 } }; },
          async coinShopEntitlements() { return { entitlements: [] }; }
        },
        backend: { async walletCosmetics() { return { profile: {} }; } }
      });
      assert.equal(missing.updates.length, 1);
      assert.equal(missing.updates[0].embeds[0].toJSON().image, undefined);
      assert.deepEqual(missing.updates[0].files, []);
      assert.match(missing.updates[0].embeds[0].toJSON().description, /420/);
    } finally {
      fs.rmSync(emptyArt, { recursive: true, force: true });
    }
    assert.equal(shopCommand().name, 'shop');
    assert.equal(shopAdminCommand().name, 'shopadmin');
    const closed = mockInteraction({ kind: 'command', commandName: 'shop' });
    process.env.COIN_SHOP_ENABLED = 'false';
    await handleCoinShopInteraction(closed, {
      economyClient: { async balances() { throw new Error('balance should stay hidden'); } },
      backend: {}
    });
    assert.match(closed.replies[0].content, /The ARK shop is turned off/);
    assert.match(closed.replies[0].content, /No Points were spent/);
    assert.doesNotMatch(closed.replies[0].content, /Coin/);
    assert.equal(closed.replies[0].flags, 64);
    assert.equal(closed.replies[0].components.length, 0);

    process.env.COIN_SHOP_ENABLED = 'true';
    const buyer = mockInteraction({ kind: 'button', customId: `nxcoin:buy:ttl_night_owl:${USER}` });
    const economy = {
      async coinShopQuote() {
        return {
          ok: true,
          quote: {
            nonce: 'nonce-1',
            balance: 420,
            balanceAfter: 120,
            price: 300,
            expiresAt: new Date(Date.now() + 120000).toISOString()
          }
        };
      }
    };
    await handleCoinShopInteraction(buyer, { economyClient: economy, backend: {} });
    const payload = buyer.updates[0];
    const description = payload.embeds[0].data?.description || payload.embeds[0].toJSON().description;
    assert.match(description, /Balance 420 → 120/);
    assert.equal(payload.embeds[0].data?.footer?.text || payload.embeds[0].toJSON().footer.text, COSMETIC_FOOTER);
    const customIds = payload.components[0].toJSON().components.map((button) => button.custom_id);
    assert.deepEqual(customIds, [`nxcoin:ok:nonce-1:${USER}`, `nxcoin:no:nonce-1:${USER}`]);
    assert.equal(parseCoinCustomId(customIds[0]).userId, USER);

    const stranger = mockInteraction({ kind: 'button', userId: OTHER, customId: customIds[0] });
    await handleCoinShopInteraction(stranger, { economyClient: economy, backend: {} });
    assert.match(stranger.replies[0].content, /another member/);
    assert.equal(GATE_OFF, "The Coin shop isn't open yet.");

    async function menu(coin, ark) {
      process.env.COIN_SHOP_ENABLED = coin ? 'true' : 'false';
      process.env.ARK_SHOP_ENABLED = ark ? 'true' : 'false';
      const interaction = mockInteraction({ kind: 'command', commandName: 'shop' });
      await handleCoinShopInteraction(interaction, {
        economyClient: { async balances() { throw new Error('the menu does not load a balance'); } },
        backend: {}
      });
      return interaction.replies[0];
    }
    const coinOnly = await menu(true, false);
    assert.deepEqual(buttonLabels(coinOnly), ['Coin Shop (cosmetics)']);
    assert.match(coinOnly.content, /Cosmetic only/);
    assert.doesNotMatch(coinOnly.content, /Points/);
    const arkOnly = await menu(false, true);
    assert.match(arkOnly.content, /Spend Points on ARK/);
    assert.doesNotMatch(arkOnly.content, /Coin/);
    const both = await menu(true, true);
    assert.deepEqual(buttonLabels(both), ['Coin Shop (cosmetics)', 'Points Shop (ARK)']);
    assert.doesNotMatch(both.content, /\d/);
    const neither = await menu(false, false);
    assert.match(neither.content, /The ARK shop is turned off/);
    assert.doesNotMatch(neither.content, /Coin/);

    process.env.ARK_SHOP_ENABLED = 'true';
    process.env.COIN_SHOP_ENABLED = 'false';
    const points = mockInteraction({ kind: 'button', customId: 'nxshop:ark' });
    await handleCoinShopInteraction(points, { economyClient: {}, backend: {} });
    assert.match(points.replies[0].content, /Spend Points on ARK/);
    assert.doesNotMatch(points.replies[0].content, /Coin/);
    const coinClosed = mockInteraction({ kind: 'button', customId: 'nxshop:coin' });
    await handleCoinShopInteraction(coinClosed, {
      economyClient: { async balances() { throw new Error('closed coin shop stays hidden'); } },
      backend: {}
    });
    assert.match(coinClosed.updates[0].content, /The Coin shop isn't open yet/);
    assert.doesNotMatch(coinClosed.updates[0].content, /Points/);

    const gone = fakeGuild(['shop']);
    await registerCoinShopCommands(gone, { COIN_SHOP_ENABLED: 'false', ARK_SHOP_ENABLED: 'false' });
    assert.equal(gone.rows.find((row) => row.name === 'shop').description, 'Spend Points on ARK');
    const arkGuild = fakeGuild();
    await registerCoinShopCommands(arkGuild, { COIN_SHOP_ENABLED: 'false', ARK_SHOP_ENABLED: 'true' });
    assert.equal(arkGuild.rows.find((row) => row.name === 'shop').description, 'Spend Points on ARK');
    const coinGuild = fakeGuild();
    await registerCoinShopCommands(coinGuild, { COIN_SHOP_ENABLED: 'true', ARK_SHOP_ENABLED: 'true' });
    assert.equal(coinGuild.rows.find((row) => row.name === 'shop').description, 'Open the shop');
  } finally {
    if (previousCoin == null) delete process.env.COIN_SHOP_ENABLED;
    else process.env.COIN_SHOP_ENABLED = previousCoin;
    if (previousArk == null) delete process.env.ARK_SHOP_ENABLED;
    else process.env.ARK_SHOP_ENABLED = previousArk;
  }
});

for (const imageName of ['Dockerfile.sentinal', 'Dockerfile.sentinel']) {
  const imagePath = path.join(__dirname, '..', imageName);
  test(`${imageName} copies Coin shop wallet art`, {
    skip: fs.existsSync(imagePath) ? false : `image does not include ${imageName}`
  }, () => {
    assert.match(fs.readFileSync(imagePath, 'utf8'), /COPY src\/shared\/brand-assets \.\/src\/shared\/brand-assets/);
  });
}

test('shopadmin uses the staff admin role, allows the Owner role, and ignores Community Manager', () => {
  const adminRole = '333333333333333333';
  const modRole = '555555555555555555';
  const guildId = '444444444444444444';
  const env = { NEXUS_STAFF_ADMIN_ROLE_IDS: adminRole, NEXUS_STAFF_MOD_ROLE_IDS: modRole };
  function interaction(roleIds, { userId = USER, ownerId = '999999999999999999', adminPerm = false } = {}) {
    return {
      user: { id: userId },
      guild: { id: guildId, ownerId },
      member: {
        guild: { id: guildId },
        roles: {
          cache: new Map(roleIds.map((id) => [id, {
            id,
            name: id === OWNER_ROLE_ID ? 'Owner' : (id === COMMUNITY_MANAGER_ROLE_ID ? 'Community Manager' : 'Role')
          }]))
        }
      },
      memberPermissions: { has: () => adminPerm }
    };
  }
  assert.equal(isCoinShopAdmin(interaction([COMMUNITY_MANAGER_ROLE_ID], { adminPerm: true }), env), false);
  assert.equal(isCoinShopAdmin(interaction([OWNER_ROLE_ID]), env), true);
  assert.equal(isCoinShopAdmin(interaction([modRole]), env), false);
  assert.equal(isCoinShopAdmin(interaction([adminRole]), env), true);
  assert.equal(isCoinShopAdmin(interaction(['777777777777777777'], { adminPerm: true }), env), false);
  assert.equal(isCoinShopAdmin(interaction([adminRole]), { NEXUS_STAFF_ADMIN_ROLE_IDS: adminRole, NEXUS_STAFF_MOD_ROLE_IDS: adminRole }), false);
  assert.equal(isCoinShopAdmin(interaction([COMMUNITY_MANAGER_ROLE_ID]), { NEXUS_STAFF_ADMIN_ROLE_IDS: COMMUNITY_MANAGER_ROLE_ID }), false);
  assert.equal(isCoinShopAdmin(interaction([], { userId: '999999999999999999', ownerId: '999999999999999999' }), env), true);
  assert.deepEqual(acceptVerifiedStaff({ actor: USER }), { ok: false, reason: 'staff-required' });
  assert.deepEqual(acceptVerifiedStaff({ actor: USER, staffVerified: true }), { ok: true, actor: USER });
  const staffSrc = fs.readFileSync(path.join(__dirname, '../src/economy-worker/coin-shop-staff.cjs'), 'utf8');
  assert.match(staffSrc, /hasStaffAdminRole/);
  assert.doesNotMatch(staffSrc, /discord\.com|DISCORD_BOT_TOKEN|NEXUS_SENTINAL_DISCORD_TOKEN/);
});

test('the guide tells members the Coin shop is cosmetic and separate from Points', () => {
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/discord/nexus-guide.json'), 'utf8'));
  const entry = guide.topics.find((topic) => topic.id === 'coin-shop');
  assert.ok(entry);
  const body = entry.details.join('\n');
  assert.match(body, /isn't open yet/);
  assert.match(body, /285/);
  assert.match(body, /315/);
  assert.match(body, /195/);
  assert.match(body, /Cosmetic only|cosmetic only/);
  assert.match(body, /no gameplay effect/);
  assert.match(body, /\/wallet/);
  assert.match(body, /Coins are not Points/);
  assert.match(body, /\/shop/);
  assert.match(body, /1,500/);
  assert.match(body, /verified member/i);
  assert.match(body, /staff member can refund it within 24 hours/);
  assert.doesNotMatch(body, /\bNP\b|NEXUS DIRECTOR|feedback digest/i);
  assert.equal(guide.topics.length <= 25, true);
});

test('a held member cannot be refunded and an equipped cosmetic is revoked together', async () => {
  const service = shop();
  const { result } = await buy(service);
  service.identities.get(USER).holdReason = 'staff';
  const held = await service.refund({ ledgerRef: result.ledgerRef, reason: 'member is on hold', actor: USER });
  assert.equal(held.reason, 'member-held');
  assert.equal(service.coinBalance(USER), 225);
  assert.equal(service.entitlementsFor(USER).entitlements[0].status, 'active');
  assert.equal(coinShopMemberText('member-held'), 'That member is on hold. The refund was not applied.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-shop-revoke-'));
  try {
    const cosmetics = new WalletCosmeticsService({ stateFile: path.join(dir, 'wallet.json') });
    cosmetics.grantShopCosmetic(USER, { sku: 'ttl_night_owl' });
    cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    const revoked = cosmetics.revokeShopCosmetic(USER, { sku: 'ttl_night_owl' });
    assert.equal(revoked.ok, true);
    assert.equal(revoked.profile.equippedTitleId, '');
    assert.equal(revoked.profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failed wallet revoke refunds nothing, and sync strips a refunded item', async () => {
  const service = shop();
  const { result } = await buy(service);
  assert.equal(service.coinBalance(USER), 225);
  const preview = await service.previewRefund({
    ledgerRef: result.ledgerRef,
    reason: 'discord revoke failed',
    actor: OTHER,
    staffVerified: true
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.sku, 'ttl_night_owl');
  assert.equal(preview.discordUserId, USER);
  assert.equal(service.coinBalance(USER), 225);
  assert.equal(service.entitlements[0].status, 'active');

  let refunds = 0;
  const economy = {
    coinShopRefundPreview: (input) => service.previewRefund(input),
    coinShopRefund: (input) => {
      refunds += 1;
      return service.refund(input);
    }
  };
  const staff = mockInteraction({
    kind: 'command',
    commandName: 'shopadmin',
    options: {
      getSubcommand: () => 'refund',
      getString: (name) => (name === 'ledger' ? result.ledgerRef : 'discord revoke failed'),
      getUser: () => null
    }
  });
  staff.user = { id: OTHER };
  staff.guild = { id: '111111111111111111', ownerId: '0' };
  staff.member = {
    guild: { id: '111111111111111111' },
    roles: { cache: new Map([[OWNER_ROLE_ID, { id: OWNER_ROLE_ID, name: 'Owner' }]]) }
  };
  staff.memberPermissions = { has: () => false };
  await handleCoinShopInteraction(staff, {
    economyClient: economy,
    backend: {
      async revokeWalletCosmetic() { throw new Error('discord down'); }
    }
  });
  assert.match(staff.replies[0].content, /could not be removed/);
  assert.match(staff.replies[0].content, /not refunded/);
  assert.equal(refunds, 0);
  assert.equal(service.coinBalance(USER), 225);
  assert.equal(service.entitlements[0].status, 'active');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-shop-sync-'));
  try {
    const cosmetics = new WalletCosmeticsService({ stateFile: path.join(dir, 'wallet.json') });
    cosmetics.grantShopCosmetic(USER, { sku: 'ttl_night_owl' });
    cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    const removed = await handleCoinShopInteraction(staff, {
      economyClient: economy,
      backend: {
        revokeWalletCosmetic: (id, input) => cosmetics.revokeShopCosmetic(id, input)
      }
    });
    assert.equal(removed, undefined);
    assert.equal(refunds, 1);
    assert.equal(service.coinBalance(USER), 420);
    assert.equal(service.entitlements[0].status, 'refunded');
    assert.equal(cosmetics.profile(USER).profile.equippedTitleId, '');
    assert.equal(cosmetics.profile(USER).profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, false);

    cosmetics.grantShopCosmetic(USER, { sku: 'ttl_night_owl' });
    cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    const synced = await syncWalletView({
      grantWalletCosmetic: (id, input) => cosmetics.grantShopCosmetic(id, input),
      revokeWalletCosmetic: (id, input) => cosmetics.revokeShopCosmetic(id, input),
      syncWalletCosmetics: (id, body) => cosmetics.sync(id, body)
    }, USER, {
      level: 2,
      economyClient: {
        async coinShopEntitlements() {
          return { entitlements: [{ sku: 'ttl_night_owl', status: 'refunded', ledgerId: result.ledgerId }] };
        }
      }
    });
    assert.equal(synced.ok, true);
    const afterSync = cosmetics.profile(USER).profile;
    assert.notEqual(afterSync.equippedTitleId, 'ttl_night_owl');
    assert.equal(afterSync.titles.find((item) => item.id === 'ttl_night_owl').unlocked, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('replaying a refunded receipt does not strip a re-bought cosmetic', async () => {
  const service = shop({ coins: 2000 });
  const { result } = await buy(service);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coin-shop-replay-'));
  try {
    const cosmetics = new WalletCosmeticsService({ stateFile: path.join(dir, 'wallet.json') });
    cosmetics.grantShopCosmetic(USER, { sku: 'ttl_night_owl' });
    cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    let revokes = 0;
    const economy = {
      coinShopRefundPreview: (input) => service.previewRefund(input),
      coinShopRefund: (input) => service.refund(input)
    };
    const backend = {
      revokeWalletCosmetic(id, input) {
        revokes += 1;
        return cosmetics.revokeShopCosmetic(id, input);
      }
    };
    const staff = mockInteraction({
      kind: 'command',
      commandName: 'shopadmin',
      userId: OTHER,
      options: {
        getSubcommand: () => 'refund',
        getString: (name) => (name === 'ledger' ? result.ledgerRef : 'wrong theme'),
        getUser: () => null
      }
    });
    staff.guild = { id: '111111111111111111', ownerId: '0' };
    staff.member = {
      guild: { id: '111111111111111111' },
      roles: { cache: new Map([[OWNER_ROLE_ID, { id: OWNER_ROLE_ID, name: 'Owner' }]]) }
    };
    staff.memberPermissions = { has: () => false };
    await handleCoinShopInteraction(staff, { economyClient: economy, backend });
    assert.equal(revokes, 1);
    assert.equal(service.entitlements[0].status, 'refunded');
    assert.equal(cosmetics.profile(USER).profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, false);

    await buy(service);
    cosmetics.grantShopCosmetic(USER, { sku: 'ttl_night_owl' });
    cosmetics.equip(USER, { titleId: 'ttl_night_owl' });
    staff.replied = false;
    await handleCoinShopInteraction(staff, { economyClient: economy, backend });
    assert.equal(revokes, 1);
    assert.match(staff.replies.at(-1).content, /already refunded/);
    const profile = cosmetics.profile(USER).profile;
    assert.equal(profile.equippedTitleId, 'ttl_night_owl');
    assert.equal(profile.titles.find((item) => item.id === 'ttl_night_owl').unlocked, true);
    assert.equal(service.coinBalance(USER), 2000 - 195);
    assert.equal(service.ledger.filter((row) => row.entryType === 'refund').length, 1);

    service.identities.get(USER).holdReason = 'staff';
    const held = mockInteraction({
      kind: 'command',
      commandName: 'shopadmin',
      userId: OTHER,
      options: {
        getSubcommand: () => 'refund',
        getString: (name) => (name === 'ledger' ? service.ledger.find((row) => row.entryType === 'purchase' && row.metadata?.sku === 'ttl_night_owl' && !service.ledger.some((refund) => refund.key === refundKey(row.id))).ledgerRef || result.ledgerRef : 'held'),
        getUser: () => null
      }
    });
    held.guild = staff.guild;
    held.member = staff.member;
    held.memberPermissions = staff.memberPermissions;
    const active = service.ledger.find((row) => row.entryType === 'purchase' && !service.ledger.some((refund) => refund.key === refundKey(row.id)));
    held.options.getString = (name) => (name === 'ledger' ? `CS-${String(active.id).padStart(4, '0')}` : 'held');
    await handleCoinShopInteraction(held, { economyClient: economy, backend });
    assert.equal(revokes, 1);
    assert.match(held.replies[0].content, /on hold/);
    assert.equal(cosmetics.profile(USER).profile.equippedTitleId, 'ttl_night_owl');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staff cannot refund their own purchase or more than 10 refunds in a Chicago day', async () => {
  const service = shop({ coins: 2000 });
  const { result } = await buy(service);
  const own = await service.previewRefund({ ledgerRef: result.ledgerRef, reason: 'mine', actor: USER });
  assert.equal(own.reason, 'self-refund');
  const refused = await service.refund({ ledgerRef: result.ledgerRef, reason: 'mine', actor: USER });
  assert.equal(refused.reason, 'self-refund');
  assert.equal(coinShopMemberText('self-refund'), 'You cannot refund your own Coin shop purchase. Nothing was refunded.');
  assert.equal(service.coinBalance(USER), 2000 - 195);
  assert.equal(service.entitlements[0].status, 'active');
  assert.equal(service.ledger.filter((row) => row.entryType === 'refund').length, 0);

  for (let index = 0; index < 10; index += 1) {
    service.audit.push({
      action: 'refund',
      actor: OTHER,
      createdAt: new Date(DAY).toISOString(),
      ledgerId: index + 1,
      reason: 'earlier'
    });
  }
  service.audit.push({
    action: 'refund',
    actor: OTHER,
    createdAt: new Date(DAY - (2 * 24 * 60 * 60 * 1000)).toISOString(),
    ledgerId: 99,
    reason: 'yesterday'
  });
  const capped = await service.refund({ ledgerRef: result.ledgerRef, reason: 'eleventh', actor: OTHER });
  assert.equal(capped.reason, 'refund-cap');
  assert.equal(coinShopMemberText('refund-cap'), 'This staff account has already refunded 10 Coin shop purchases today. Nothing was refunded.');
  assert.equal(service.coinBalance(USER), 2000 - 195);
  assert.equal(service.entitlements[0].status, 'active');

  const third = '323456789012345678';
  const allowed = await service.refund({ ledgerRef: result.ledgerRef, reason: 'different staff', actor: third });
  assert.equal(allowed.ok, true, allowed.reason);
  assert.equal(service.coinBalance(USER), 2000);
  assert.equal(service.entitlements[0].status, 'refunded');
});

test('quote creation is rate limited and expired quotes are pruned', async () => {
  const service = shop({ coins: 2000 });
  service.quotes.set('old-quote', { nonce: 'old-quote', expiresAt: new Date(DAY - 1000).toISOString() });
  for (let index = 0; index < 5; index += 1) {
    const quoted = await service.quote({ discordUserId: USER, sku: 'ttl_night_owl' });
    assert.equal(quoted.ok, true, quoted.reason);
  }
  assert.equal(service.quotes.has('old-quote'), false);
  const week = 7 * 24 * 60 * 60 * 1000;
  service.attempts.push({ econId: 'econ-1', at: DAY - week - 1000 });
  service.attempts.push({ econId: 'econ-1', at: DAY - 60 * 1000 });
  const pruned = await service.quote({ discordUserId: USER, sku: 'thm_circuit' });
  assert.equal(pruned.reason, 'rate-limited');
  assert.equal(service.attempts.some((row) => row.at === DAY - week - 1000), false);
  assert.equal(service.attempts.some((row) => row.at === DAY - 60 * 1000), true);
  const blocked = await service.quote({ discordUserId: USER, sku: 'thm_nebula' });
  assert.equal(blocked.reason, 'rate-limited');
  assert.equal(service.coinBalance(USER), 2000);
  assert.equal(service.pointBalance(USER), 80);
});

test('postgres coin shop stays on Coins and does not touch Points, RCON, or the cluster shop', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/economy-worker/coin-shop-postgres.cjs'), 'utf8');
  assert.match(src, /sink:coin-shop/);
  assert.match(src, /NEXUS_COINS/);
  assert.match(src, /coin-shop-refund/);
  assert.match(src, /pg_advisory_xact_lock/);
  assert.match(src, /nexus_economic_identities WHERE economic_identity_id = \$1 FOR UPDATE/);
  assert.match(src, /equipped_at = NULL/);
  assert.match(src, /America\/Chicago/);
  assert.match(src, /NOW\(\) - INTERVAL '24 hours'/);
  assert.match(src, /assertMemberAccount/);
  assert.match(src, /mc-link/);
  assert.match(src, /nexus_coin_shop_attempts WHERE created_at < \$1/);
  const runtime = fs.readFileSync(path.join(__dirname, '../src/economy-worker/postgres-runtime.cjs'), 'utf8');
  assert.doesNotMatch(runtime, /coinShop\.ensureSchema|nexus_coin_shop_/);
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/2026-10-06-coin-shop.sql'), 'utf8');
  assert.match(migration, /nexus_coin_shop_entitlements/);
  assert.match(migration, /nexus_coin_shop_quotes/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS nexus_coin_shop_attempts_created_idx/);
  assert.match(migration, /ON \{\{schema\}\}\.nexus_coin_shop_attempts \(created_at\)/);
  const holdSrc = fs.readFileSync(path.join(__dirname, '../src/sentinel/nexus-economy-postgres-runtime-repository.cjs'), 'utf8');
  const place = holdSrc.slice(holdSrc.indexOf('async placeStaffHold'), holdSrc.indexOf('async liftIdentityHold('));
  assert.ok(place.indexOf('coin-shop:') > 0 && place.indexOf('coin-shop:') < place.indexOf('#lockIdentity'));
  const decide = fs.readFileSync(path.join(__dirname, '../src/shared/coin-shop-decide.cjs'), 'utf8');
  const refundFn = decide.slice(decide.indexOf('function decideRefund'), decide.indexOf('module.exports'));
  assert.ok(refundFn.indexOf("type: 'refund-entitlement'") < refundFn.indexOf("type: 'cas-credit'"));
  const ui = fs.readFileSync(path.join(__dirname, '../src/sentinel/coin-shop-ui.cjs'), 'utf8');
  assert.doesNotMatch(ui, /shop\.delete/);
  const refundUi = ui.slice(ui.indexOf("if (sub === 'refund')"));
  assert.ok(refundUi.indexOf('preview.duplicate') > 0 && refundUi.indexOf('preview.duplicate') < refundUi.indexOf('removeWalletCosmetic'));
  const arkUi = fs.readFileSync(path.join(__dirname, '../src/sentinel/ark-np-shop-ui.cjs'), 'utf8');
  assert.match(arkUi, /Open \/shop again/);
  const server = fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8');
  assert.match(server, /assertMemberAccount/);
  assert.doesNotMatch(src, /RCON|rcon/);
  assert.doesNotMatch(src, /DISCORD_BOT_TOKEN|NEXUS_SENTINAL_DISCORD_TOKEN/);
  assert.doesNotMatch(src, /NEXUS_POINTS/);
  assert.doesNotMatch(src, /cluster-shop|ClusterShop/);
});

test('coin shop entitlement reads require the service token', async () => {
  let seen = 0;
  const runtime = createEconomyServer({
    token: 'sentinal-token',
    craftToken: 'craft-token',
    arkToken: 'ark-token',
    writesEnabled: false,
    coinShopSpendEnabled: false,
    worker: {
      health() { return { ok: true }; },
      coinShop: {
        entitlementsFor: async () => {
          seen += 1;
          return { ok: true, entitlements: [] };
        }
      }
    },
    shop: { listCatalog() { return []; }, pendingBuyOrders() { return []; } }
  });
  const open = await callServer(runtime, { method: 'GET', pathname: '/coin-shop/entitlements/123456789012345678', token: '', body: null });
  assert.equal(open.status, 401);
  assert.equal(open.body.error, 'unauthorized');
  const craft = await callServer(runtime, { method: 'GET', pathname: '/coin-shop/entitlements/123456789012345678', token: 'craft-token', body: null });
  assert.equal(craft.status, 403);
  assert.equal(craft.body.error, 'craft-token-scope');
  const ark = await callServer(runtime, { method: 'GET', pathname: '/coin-shop/entitlements/123456789012345678', token: 'ark-token', body: null });
  assert.equal(ark.status, 403);
  assert.equal(ark.body.error, 'ark-token-scope');
  const allowed = await callServer(runtime, { method: 'GET', pathname: '/coin-shop/entitlements/123456789012345678', token: 'sentinal-token', body: null });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.ok, true);
  assert.equal(seen, 1);
  for (const pathname of ['/coin-shop/refund', '/coin-shop/refund-preview', '/coin-shop/purchase', '/coin-shop/quote']) {
    const craftPost = await callServer(runtime, { method: 'POST', pathname, token: 'craft-token' });
    assert.equal(craftPost.status, 403, pathname);
    assert.equal(craftPost.body.error, 'craft-token-scope');
    const arkPost = await callServer(runtime, { method: 'POST', pathname, token: 'ark-token' });
    assert.equal(arkPost.status, 403, pathname);
    assert.equal(arkPost.body.error, 'ark-token-scope');
    const sentinalPost = await callServer(runtime, { method: 'POST', pathname, token: 'sentinal-token' });
    assert.equal(sentinalPost.status, 503, pathname);
  }
  runtime.server.close();
});
