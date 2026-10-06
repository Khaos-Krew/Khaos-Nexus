'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CoinShopService } = require('../src/economy-worker/coin-shop-service.cjs');
const { coinShopFlags, coinShopPreview } = require('../src/shared/coin-shop-flags.cjs');
const { DAILY_SPEND_CAP } = require('../src/shared/coin-shop-limits.cjs');
const { GATE_OFF, COSMETIC_FOOTER } = require('../src/shared/coin-shop-copy.cjs');
const { OWNER_ROLE_ID, CM_ROLE_ID } = require('../src/shared/protected-role-ids.cjs');
const {
  PREVIEW_LINE,
  COIN_SHOP_PREVIEW_PANEL_MARKER,
  clearCoinShopSessions,
  handleCoinShopInteraction,
  previewCatalogPayload,
  ensureCoinShopPreviewPanel
} = require('../src/sentinel/coin-shop-ui.cjs');

const USER = '123456789012345678';
const CHANNEL = '1556889838085603390';
const OTHER_CHANNEL = '1556889838085603391';
const NAMED_ONLY = '777777777777777771';
const ARK_OFF = 'The ARK shop is turned off. No Points were spent.';

function role(id, name) {
  return { id, name, managed: false, permissions: '0' };
}

function mockInteraction(partial = {}) {
  const roles = partial.roles || [];
  const interaction = {
    commandName: partial.commandName || '',
    customId: partial.customId || '',
    values: partial.values || [],
    channelId: partial.channelId || '',
    user: { id: partial.userId || USER },
    member: {
      roles: { cache: new Map(roles.map((item) => [item.id, item])) }
    },
    deferred: false,
    replied: false,
    replies: [],
    updates: [],
    isChatInputCommand: () => partial.kind === 'command',
    isButton: () => partial.kind === 'button',
    isStringSelectMenu: () => partial.kind === 'select',
    async reply(payload) { interaction.replied = true; interaction.replies.push(payload); },
    async update(payload) { interaction.updates.push(payload); },
    async editReply(payload) { interaction.updates.push(payload); }
  };
  return interaction;
}

function economySpy() {
  const calls = { quote: 0, purchase: 0 };
  return {
    calls,
    async balances() { return { balances: { NEXUS_COINS: 420 } }; },
    async coinShopEntitlements() { return { entitlements: [] }; },
    async coinShopQuote() { calls.quote += 1; return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' }; },
    async coinShopPurchase() { calls.purchase += 1; return { ok: false, reason: 'economy-coin-shop-spend-not-enabled' }; }
  };
}

function descriptionOf(payload) {
  const embed = payload?.embeds?.[0];
  if (!embed) return '';
  if (embed.data?.description) return embed.data.description;
  if (typeof embed.toJSON === 'function') return embed.toJSON().description || '';
  return embed.description || '';
}

function buttonIds(payload) {
  const ids = [];
  for (const row of payload?.components || []) {
    const json = typeof row.toJSON === 'function' ? row.toJSON() : row;
    for (const component of json.components || []) {
      if (component.type === 2) ids.push(component.custom_id);
    }
  }
  return ids;
}

function previewEnv(extra = {}) {
  return {
    COIN_SHOP_ENABLED: 'false',
    ARK_SHOP_ENABLED: 'false',
    NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED: 'false',
    COIN_SHOP_PREVIEW_ROLE_IDS: ` ${OWNER_ROLE_ID}, ${CM_ROLE_ID} `,
    COIN_SHOP_PREVIEW_CHANNEL_ID: ` ${CHANNEL} `,
    ...extra
  };
}

test('preview role and channel ids trim blanks and fail closed on garbage', () => {
  assert.equal(OWNER_ROLE_ID, '1516602930457739354');
  assert.equal(CM_ROLE_ID, '1521219329360920767');
  const parsed = coinShopPreview(previewEnv());
  assert.equal(parsed.open, true);
  assert.deepEqual(parsed.roleIds, [OWNER_ROLE_ID, CM_ROLE_ID]);
  assert.equal(parsed.channelId, CHANNEL);
  assert.equal(coinShopFlags(previewEnv()).shopEnabled, false);
  assert.equal(coinShopFlags(previewEnv()).spendEnabled, false);

  const blanks = coinShopPreview({
    COIN_SHOP_PREVIEW_ROLE_IDS: `, ${OWNER_ROLE_ID}, ,`,
    COIN_SHOP_PREVIEW_CHANNEL_ID: CHANNEL
  });
  assert.deepEqual(blanks.roleIds, [OWNER_ROLE_ID]);
  assert.equal(blanks.open, true);

  for (const env of [
    { COIN_SHOP_PREVIEW_ROLE_IDS: `${OWNER_ROLE_ID}, owner`, COIN_SHOP_PREVIEW_CHANNEL_ID: CHANNEL },
    { COIN_SHOP_PREVIEW_ROLE_IDS: OWNER_ROLE_ID, COIN_SHOP_PREVIEW_CHANNEL_ID: 'coin-shop' },
    { COIN_SHOP_PREVIEW_ROLE_IDS: '', COIN_SHOP_PREVIEW_CHANNEL_ID: CHANNEL },
    { COIN_SHOP_PREVIEW_ROLE_IDS: OWNER_ROLE_ID, COIN_SHOP_PREVIEW_CHANNEL_ID: '' }
  ]) {
    const closed = coinShopPreview(env);
    assert.equal(closed.open, false, JSON.stringify(env));
    assert.deepEqual(closed.roleIds, env.COIN_SHOP_PREVIEW_ROLE_IDS && !String(env.COIN_SHOP_PREVIEW_ROLE_IDS).includes('owner')
      ? String(env.COIN_SHOP_PREVIEW_ROLE_IDS).split(',').map((part) => part.trim()).filter(Boolean)
      : []);
  }
});

test('a listed role browses the Coin shop read-only in the preview channel only', async () => {
  const previous = {
    COIN_SHOP_ENABLED: process.env.COIN_SHOP_ENABLED,
    ARK_SHOP_ENABLED: process.env.ARK_SHOP_ENABLED,
    COIN_SHOP_PREVIEW_ROLE_IDS: process.env.COIN_SHOP_PREVIEW_ROLE_IDS,
    COIN_SHOP_PREVIEW_CHANNEL_ID: process.env.COIN_SHOP_PREVIEW_CHANNEL_ID
  };
  function apply(env) {
    for (const [key, value] of Object.entries(env)) {
      if (value == null || value === '') delete process.env[key];
      else process.env[key] = value;
    }
  }
  apply(previewEnv());
  try {
    clearCoinShopSessions();
    const economy = economySpy();
    const backend = { async walletCosmetics() { return { profile: {} }; } };
    const owner = role(OWNER_ROLE_ID, 'Khaos Lead');
    const opened = mockInteraction({
      kind: 'command',
      commandName: 'shop',
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(opened, { economyClient: economy, backend });
    const browse = opened.replies[0];
    assert.match(descriptionOf(browse), new RegExp(PREVIEW_LINE));
    assert.match(descriptionOf(browse), /420/);
    assert.deepEqual(buttonIds(browse), []);
    assert.doesNotMatch(JSON.stringify(browse), /nxcoin:buy|nxcoin:ok|Confirm/);

    const category = mockInteraction({
      kind: 'select',
      customId: `nxcoin:cat:${USER}`,
      values: ['themes'],
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(category, { economyClient: economy, backend });
    assert.match(descriptionOf(category.updates[0]), new RegExp(PREVIEW_LINE));
    assert.match(JSON.stringify(category.updates[0]), /285 Coins/);
    assert.match(JSON.stringify(category.updates[0]), /315 Coins/);
    assert.deepEqual(buttonIds(category.updates[0]), []);

    const detail = mockInteraction({
      kind: 'select',
      customId: `nxcoin:item:${USER}`,
      values: ['thm_nebula'],
      channelId: CHANNEL,
      roles: [role(CM_ROLE_ID, 'Helpers')]
    });
    await handleCoinShopInteraction(detail, { economyClient: economy, backend });
    assert.match(descriptionOf(detail.updates[0]), new RegExp(PREVIEW_LINE));
    assert.match(descriptionOf(detail.updates[0]), /Price: 285 Coins/);
    assert.deepEqual(buttonIds(detail.updates[0]), []);

    const buy = mockInteraction({
      kind: 'button',
      customId: `nxcoin:buy:thm_nebula:${USER}`,
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(buy, { economyClient: economy, backend });
    assert.match(buy.updates[0].content, new RegExp(PREVIEW_LINE));
    const confirm = mockInteraction({
      kind: 'button',
      customId: `nxcoin:ok:nonce-1:${USER}`,
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(confirm, { economyClient: economy, backend });
    assert.match(confirm.updates[0].content, new RegExp(PREVIEW_LINE));
    assert.equal(economy.calls.quote, 0);
    assert.equal(economy.calls.purchase, 0);

    const unlisted = mockInteraction({ kind: 'command', commandName: 'shop', channelId: CHANNEL, roles: [] });
    await handleCoinShopInteraction(unlisted, { economyClient: economy, backend });
    assert.equal(unlisted.replies[0].content, ARK_OFF);
    assert.doesNotMatch(unlisted.replies[0].content, /Coin|Preview/);
    const unlistedCoin = mockInteraction({ kind: 'button', customId: 'nxshop:coin', channelId: CHANNEL, roles: [role(NAMED_ONLY, 'Server Owner')] });
    await handleCoinShopInteraction(unlistedCoin, { economyClient: economy, backend });
    assert.match(unlistedCoin.updates[0].content, new RegExp(GATE_OFF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(unlistedCoin.updates[0].content, /Preview/);
    assert.equal(unlistedCoin.updates[0].content.includes(COSMETIC_FOOTER), true);

    const elsewhere = mockInteraction({
      kind: 'command',
      commandName: 'shop',
      channelId: OTHER_CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(elsewhere, { economyClient: economy, backend });
    assert.equal(elsewhere.replies[0].content, ARK_OFF);
    assert.doesNotMatch(elsewhere.replies[0].content, /Coin|Preview/);
    const elsewhereCoin = mockInteraction({
      kind: 'button',
      customId: 'nxshop:coin',
      channelId: OTHER_CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(elsewhereCoin, { economyClient: economy, backend });
    assert.match(elsewhereCoin.updates[0].content, /The Coin shop isn't open yet/);
    assert.doesNotMatch(elsewhereCoin.updates[0].content, /Preview/);

    apply(previewEnv({ COIN_SHOP_PREVIEW_ROLE_IDS: `${OWNER_ROLE_ID},not-a-role` }));
    const garbage = mockInteraction({
      kind: 'command',
      commandName: 'shop',
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(garbage, { economyClient: economy, backend });
    assert.equal(garbage.replies[0].content, ARK_OFF);
    assert.equal(economy.calls.quote, 0);
    assert.equal(economy.calls.purchase, 0);

    apply(previewEnv({ COIN_SHOP_ENABLED: 'true' }));
    clearCoinShopSessions();
    const live = mockInteraction({
      kind: 'command',
      commandName: 'shop',
      channelId: CHANNEL,
      roles: [owner]
    });
    await handleCoinShopInteraction(live, { economyClient: economy, backend });
    assert.match(live.replies[0].content, /Coin Shop \(cosmetics\)/);
    assert.doesNotMatch(live.replies[0].content, /Preview/);
    assert.equal(economy.calls.quote, 0);
    assert.equal(economy.calls.purchase, 0);

    const service = new CoinShopService({
      env: { NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED: 'false' }
    });
    service.seed({ discordUserId: USER, econId: 'econ-preview', coins: 420 });
    const quoted = await service.quote({ discordUserId: USER, sku: 'thm_nebula' });
    const bought = await service.purchase({ discordUserId: USER, sku: 'thm_nebula', nonce: 'nope' });
    assert.equal(quoted.reason, 'economy-coin-shop-spend-not-enabled');
    assert.equal(bought.reason, 'economy-coin-shop-spend-not-enabled');
    assert.equal(service.coinBalance(USER), 420);
  } finally {
    clearCoinShopSessions();
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('the preview channel keeps one read-only catalog panel', async () => {
  const payload = previewCatalogPayload();
  const json = payload.embeds[0].toJSON();
  assert.equal(json.title, 'KHAOS NEXUS • COIN SHOP');
  assert.equal(json.footer.text, COIN_SHOP_PREVIEW_PANEL_MARKER);
  assert.equal(json.author, undefined);
  assert.match(json.description, new RegExp(PREVIEW_LINE));
  assert.match(json.description, /Cosmetic only/);
  assert.match(json.fields.map((field) => field.value).join('\n'), /Nebula — 285 Coins/);
  assert.match(json.fields.map((field) => field.value).join('\n'), /Circuit — 315 Coins/);
  assert.match(json.fields.map((field) => field.value).join('\n'), /Night Owl — 195 Coins/);
  assert.match(json.fields.map((field) => field.value).join('\n'), new RegExp(`${DAILY_SPEND_CAP.toLocaleString('en-US')} Coins`));
  assert.equal(json.image.url, 'attachment://coin-shop-panel-banner.png');
  assert.deepEqual(payload.components, []);
  assert.equal(payload.files[0].name, 'coin-shop-panel-banner.png');

  const botId = '888888888888888888';
  const messages = new Map();
  let sendCount = 0;
  const channel = {
    async send(body) {
      sendCount += 1;
      const message = {
        id: String(sendCount),
        author: { id: botId },
        content: body.content || '',
        embeds: (body.embeds || []).map((embed) => (typeof embed.toJSON === 'function' ? embed.toJSON() : embed)),
        components: (body.components || []).map((row) => (typeof row.toJSON === 'function' ? row.toJSON() : row)),
        pinned: false,
        createdTimestamp: sendCount,
        async edit(next) {
          message.embeds = next.embeds;
          message.components = next.components || [];
        },
        async pin() { message.pinned = true; },
        async delete() { messages.delete(message.id); }
      };
      messages.set(message.id, message);
      return message;
    },
    messages: { async fetch() { return messages; } }
  };
  const client = {
    user: { id: botId },
    channels: { async fetch(id) { return id === CHANNEL ? channel : null; } }
  };
  const env = previewEnv();
  const first = await ensureCoinShopPreviewPanel(client, env);
  const second = await ensureCoinShopPreviewPanel(client, env);
  assert.equal(first.posted, true);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(sendCount, 1);
  assert.equal(messages.size, 1);

  let fetched = 0;
  const closed = await ensureCoinShopPreviewPanel({
    user: { id: botId },
    channels: { async fetch() { fetched += 1; return null; } }
  }, { COIN_SHOP_PREVIEW_CHANNEL_ID: 'not-a-channel', COIN_SHOP_PREVIEW_ROLE_IDS: OWNER_ROLE_ID });
  assert.equal(closed.posted, false);
  assert.equal(fetched, 0);
});
