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
const { purchaseKey, refundKey, chicagoDayKey } = require('../src/shared/coin-shop-limits.cjs');
const { GATE_OFF, COSMETIC_FOOTER, INELIGIBLE, coinShopMemberText } = require('../src/shared/coin-shop-copy.cjs');
const { administratorFromRoles, isCoinShopAdmin } = require('../src/economy-worker/coin-shop-staff.cjs');
const { COMMUNITY_MANAGER_ROLE_ID, OWNER_ROLE_ID } = require('../src/economy-worker/ark-staff-auth.cjs');
const { WalletCosmeticsService } = require('../src/backend/services/wallet-cosmetics-service.cjs');
const { walletEquipRow } = require('../src/sentinel/wallet-cosmetics-ui.cjs');
const { handleWalletInteraction } = require('../src/sentinel/wallet-cosmetics-extension.cjs');
const { handleCoinShopInteraction, parseCoinCustomId, shopCommand, shopAdminCommand } = require('../src/sentinel/coin-shop-ui.cjs');

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
  assert.equal(purchaseCeiling({}), null);
  assert.equal(purchaseCeiling({ NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '1000' }), 1000);
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

  const unset = shop({ env: { NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING: '' } });
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
  assert.doesNotMatch(INELIGIBLE, /shadow|quarantine|restricted|disabled|hold/i);
});

test('staff can refund an unused purchase once inside 24 hours', async () => {
  const service = shop();
  const { result } = await buy(service);
  const refunded = await service.refund({ ledgerRef: result.ledgerRef, reason: 'bought the wrong theme', actor: USER });
  assert.equal(refunded.ok, true);
  assert.equal(refunded.duplicate, false);
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.pointBalance(USER), 80);
  assert.equal(refunded.ledgerRef, refundKey(result.ledgerId));
  assert.equal(service.entitlementsFor(USER).entitlements[0].status, 'refunded');
  const again = await service.refund({ ledgerRef: result.ledgerRef, reason: 'second try', actor: USER });
  assert.equal(again.duplicate, true);
  assert.equal(service.coinBalance(USER), 420);
  assert.equal(service.ledger.filter((row) => row.entryType === 'refund').length, 1);

  const worn = shop();
  const wornBuy = await buy(worn);
  await worn.markEquipped({ discordUserId: USER, sku: 'ttl_night_owl' });
  const used = await worn.refund({ ledgerRef: wornBuy.result.ledgerRef, reason: 'changed my mind', actor: USER });
  assert.equal(used.reason, 'already-used');
  assert.equal(worn.coinBalance(USER), 225);

  const late = shop();
  const lateBuy = await buy(late);
  late.moveClock(DAY + (24 * 60 * 60 * 1000) + 1000);
  const expired = await late.refund({ ledgerRef: lateBuy.result.ledgerRef, reason: 'too late', actor: USER });
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

test('the shop panel is ephemeral, locked to the buyer, and shows the balance change', async () => {
  const previous = process.env.COIN_SHOP_ENABLED;
  process.env.COIN_SHOP_ENABLED = 'true';
  try {
    assert.equal(shopCommand().name, 'shop');
    assert.equal(shopAdminCommand().name, 'shopadmin');
    const closed = mockInteraction({ kind: 'command', commandName: 'shop' });
    process.env.COIN_SHOP_ENABLED = 'false';
    await handleCoinShopInteraction(closed, {
      economyClient: { async balances() { throw new Error('balance should stay hidden'); } },
      backend: {}
    });
    assert.match(closed.replies[0].content, /The Coin shop isn't open yet/);
    assert.match(closed.replies[0].content, /Cosmetic only\. No gameplay effect/);
    assert.equal(closed.replies[0].flags, 64);

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
  } finally {
    if (previous == null) delete process.env.COIN_SHOP_ENABLED;
    else process.env.COIN_SHOP_ENABLED = previous;
  }
});

test('shopadmin is Administrator only and ignores Community Manager and Owner roles', () => {
  const adminRole = '333333333333333333';
  assert.equal(administratorFromRoles([
    { id: COMMUNITY_MANAGER_ROLE_ID, name: 'Community Manager', permissions: 8 }
  ], 'guild'), false);
  assert.equal(administratorFromRoles([
    { id: OWNER_ROLE_ID, name: 'Owner', permissions: 8 }
  ], 'guild'), false);
  assert.equal(administratorFromRoles([
    { id: adminRole, name: 'Admin', permissions: 8 }
  ], 'guild'), true);
  const guildId = '444444444444444444';
  const interaction = {
    user: { id: USER },
    guild: { id: guildId, ownerId: '999999999999999999' },
    member: {
      guild: { id: guildId },
      roles: {
        cache: new Map([
          [COMMUNITY_MANAGER_ROLE_ID, { id: COMMUNITY_MANAGER_ROLE_ID, name: 'Community Manager', permissions: 8 }],
          [OWNER_ROLE_ID, { id: OWNER_ROLE_ID, name: 'Owner', permissions: 8 }]
        ])
      }
    },
    memberPermissions: { has: () => true }
  };
  assert.equal(isCoinShopAdmin(interaction), false);
  interaction.member.roles.cache.set(adminRole, { id: adminRole, name: 'Admin', permissions: 8 });
  assert.equal(isCoinShopAdmin(interaction), true);
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
  assert.doesNotMatch(body, /\bNP\b/);
  assert.equal(guide.topics.length <= 25, true);
});

test('postgres coin shop stays on Coins and does not touch Points, RCON, or the cluster shop', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/economy-worker/coin-shop-postgres.cjs'), 'utf8');
  assert.match(src, /sink:coin-shop/);
  assert.match(src, /NEXUS_COINS/);
  assert.match(src, /coin-shop-refund/);
  assert.match(src, /pg_advisory_xact_lock/);
  assert.doesNotMatch(src, /RCON|rcon/);
  assert.doesNotMatch(src, /NEXUS_POINTS/);
  assert.doesNotMatch(src, /cluster-shop|ClusterShop/);
});
