'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { JsonCardStore } = require('../src/sentinel/card/card-store.cjs');
const { CardAuditLog } = require('../src/sentinel/card/card-audit.cjs');
const { cardCommandDefinition, handleCardInteraction } = require('../src/sentinel/card/card-commands.cjs');
const {
  HARD_BIRTHDAY_GIFT_CEILING,
  OWNER_LOCKED_BIRTHDAY_COINS,
  PENDING_LEDGER,
  birthdayEnabled,
  readBirthdayCoins,
  BIRTHDAY_POLICY
} = require('../src/sentinel/card/birthday-config.cjs');
const {
  celebrationDay,
  deliveryInstant,
  zonedParts,
  suggestTimezones,
  capDayKey,
  nextCapMidnight
} = require('../src/sentinel/card/birthday-calendar.cjs');
const { schedulerDecision, startBirthdayScheduler } = require('../src/sentinel/card/birthday-scheduler.cjs');
const { liveBirthdayProviders, grantBirthdayProvider } = require('../src/sentinel/card/birthday-providers.cjs');
const { sanitizeBirthdayAudit } = require('../src/sentinel/card/birthday-audit.cjs');
const { runBirthdayPass, claimBirthdayGift, describeBirthdayGift } = require('../src/sentinel/card/birthday-service.cjs');
const { assembleCardModel } = require('../src/sentinel/card/card-model.cjs');
const { COPY } = require('../src/sentinel/card/birthday-copy.cjs');

const USER = '100000000000000021';
const DAY = 24 * 60 * 60 * 1000;
const ZONE = 'Pacific/Kiritimati';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'card-birthday-'));
}

function coinEnv(extra = {}) {
  return {
    CARD_ENABLED: 'true',
    BIRTHDAY_ENABLED: 'true',
    BIRTHDAY_COINS_MIN: '75',
    BIRTHDAY_COINS_MAX: '125',
    BIRTHDAY_GIFT_CEILING: '150',
    BIRTHDAY_GIFT_DAILY_CAP: '1500',
    ...extra
  };
}

function openStore() {
  const dir = tempDir();
  return {
    dir,
    store: new JsonCardStore(path.join(dir, 'cards.json')),
    audit: new CardAuditLog(path.join(dir, 'audit'))
  };
}

function member(now, { ageDays = 40, tenureDays = 10, bot = false, roles = [], timeout = null, name = 'Ada' } = {}) {
  return {
    joinedAt: new Date(now - tenureDays * DAY),
    communicationDisabledUntil: timeout,
    roles: { cache: new Map(roles.map((id) => [id, { id }])) },
    displayName: name,
    user: { id: USER, bot, username: name, createdAt: new Date(now - ageDays * DAY) }
  };
}

function mockInteraction(partial = {}) {
  const calls = [];
  const interaction = {
    calls,
    deferred: false,
    replied: false,
    guildId: '300000000000000004',
    commandName: 'card',
    user: { id: USER, username: 'Ada', bot: false, createdAt: new Date('2020-01-01T00:00:00.000Z') },
    member: { joinedAt: new Date('2020-02-01T00:00:00.000Z'), roles: { cache: new Map() }, displayName: 'Ada' },
    options: {
      getSubcommand: () => 'set',
      getSubcommandGroup: () => 'birthday',
      getInteger: (name) => (name === 'month' ? 8 : 27),
      getString: (name) => (name === 'timezone' ? ZONE : null),
      getBoolean: () => null,
      getUser: () => null,
      getFocused: () => ({ name: 'timezone', value: 'kir' })
    },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    isUserContextMenuCommand: () => false,
    reply: (payload) => { calls.push(payload); interaction.replied = true; return Promise.resolve(); },
    editReply: (payload) => { calls.push(payload); return Promise.resolve(); },
    deferReply: () => Promise.resolve(),
    respond: (payload) => { calls.push(payload); return Promise.resolve(); },
    ...partial
  };
  return interaction;
}

function auditText(dir) {
  const auditDir = path.join(dir, 'audit');
  return fs.readdirSync(auditDir).filter((name) => name.endsWith('.jsonl')).map((name) => fs.readFileSync(path.join(auditDir, name), 'utf8')).join('\n');
}

test('owner-locked Coin numbers are documented defaults and stay unset until env is set', () => {
  assert.deepEqual(OWNER_LOCKED_BIRTHDAY_COINS, { min: 75, max: 125, ceiling: 150, dailyCap: 1500 });
  assert.equal(birthdayEnabled({}), false);
  assert.equal(birthdayEnabled({ BIRTHDAY_ENABLED: 'true' }), true);
  assert.equal(readBirthdayCoins({}).ok, false);
  assert.equal(readBirthdayCoins({ BIRTHDAY_COINS_MIN: PENDING_LEDGER, BIRTHDAY_COINS_MAX: '125', BIRTHDAY_GIFT_CEILING: '150', BIRTHDAY_GIFT_DAILY_CAP: '1500' }).reason, 'coins-pending');
  assert.equal(readBirthdayCoins({ BIRTHDAY_COINS_MIN: '75', BIRTHDAY_COINS_MAX: '125', BIRTHDAY_GIFT_DAILY_CAP: '1500' }).reason, 'grant-ceiling-unset');
  assert.equal(readBirthdayCoins({ BIRTHDAY_COINS_MIN: '75', BIRTHDAY_COINS_MAX: '125', BIRTHDAY_GIFT_CEILING: '150' }).reason, 'daily-cap-unset');
  assert.equal(readBirthdayCoins({ BIRTHDAY_COINS_MIN: '75', BIRTHDAY_COINS_MAX: '200', BIRTHDAY_GIFT_CEILING: '150', BIRTHDAY_GIFT_DAILY_CAP: '1500' }).reason, 'coins-range');
  assert.equal(HARD_BIRTHDAY_GIFT_CEILING, 150);
  assert.equal(readBirthdayCoins({ ...coinEnv(), BIRTHDAY_GIFT_CEILING: '151' }).reason, 'grant-ceiling');
  assert.equal(readBirthdayCoins({ ...coinEnv(), BIRTHDAY_GIFT_CEILING: '1500', BIRTHDAY_COINS_MAX: '125' }).reason, 'grant-ceiling');
  assert.deepEqual(readBirthdayCoins(coinEnv()), { ok: true, ...OWNER_LOCKED_BIRTHDAY_COINS });
  assert.equal(BIRTHDAY_POLICY.firstGiftDelayMs, 14 * DAY);
  assert.equal(BIRTHDAY_POLICY.changeLockMs, 60 * DAY);
  assert.equal(BIRTHDAY_POLICY.postChangeDelayMs, 30 * DAY);
  assert.equal(BIRTHDAY_POLICY.deliveryHour, 9);
  assert.equal(BIRTHDAY_POLICY.revealMs, 7 * DAY);
});

test('date math honors time zones, DST, leap day, and catch-up windows', () => {
  assert.equal(celebrationDay(2027, 2, 29), 28);
  assert.equal(celebrationDay(2028, 2, 29), 29);
  const spring = deliveryInstant({ month: 3, day: 8, timezone: 'America/New_York' }, 2026, 9);
  assert.equal(new Date(spring).toISOString(), '2026-03-08T13:00:00.000Z');
  assert.equal(zonedParts(spring, 'America/New_York').hour, 9);
  const autumn = deliveryInstant({ month: 11, day: 1, timezone: 'America/New_York' }, 2026, 9);
  assert.equal(new Date(autumn).toISOString(), '2026-11-01T14:00:00.000Z');
  const line = deliveryInstant({ month: 1, day: 1, timezone: 'Pacific/Kiritimati' }, 2026, 9);
  assert.equal(new Date(line).toISOString(), '2025-12-31T19:00:00.000Z');
  assert.equal(zonedParts(line, 'Pacific/Kiritimati').year, 2026);
  const losAngeles = deliveryInstant({ month: 1, day: 1, timezone: 'America/Los_Angeles' }, 2026, 9);
  assert.equal(new Date(losAngeles).toISOString(), '2026-01-01T17:00:00.000Z');
  assert.equal(zonedParts(losAngeles - 60 * 1000, 'America/Los_Angeles').hour, 8);
  const leap = deliveryInstant({ month: 2, day: 29, timezone: 'UTC' }, 2027, 9);
  assert.equal(zonedParts(leap, 'UTC').day, 28);
  const capNow = Date.parse('2026-10-05T15:00:00.000Z');
  assert.equal(capDayKey(capNow), '2026-10-05');
  assert.equal(new Date(nextCapMidnight(capNow)).toISOString(), '2026-10-06T05:00:00.000Z');
  assert.equal(capDayKey(Date.parse('2026-10-06T00:30:00.000Z')), '2026-10-05');
  assert.equal(capDayKey(Date.parse('2026-01-15T05:30:00.000Z')), '2026-01-14');
  assert.equal(new Date(nextCapMidnight(Date.parse('2026-01-14T23:30:00.000Z'))).toISOString(), '2026-01-15T06:00:00.000Z');
});

test('scheduler refuses to start while flags or Coin settings are off, and catch-up runs once they are set', async () => {
  assert.equal(schedulerDecision({}).reason, 'flag-off');
  assert.equal(schedulerDecision(coinEnv({ BIRTHDAY_ENABLED: '' })).reason, 'flag-off');
  assert.equal(schedulerDecision(coinEnv({ BIRTHDAY_COINS_MIN: PENDING_LEDGER })).reason, 'coins-pending');
  let scheduled = 0;
  const refused = startBirthdayScheduler({}, {
    env: coinEnv({ BIRTHDAY_GIFT_DAILY_CAP: '' }),
    setInterval: () => { throw new Error('interval started'); }
  });
  assert.equal(refused.ok, false);
  const calls = [];
  const host = {};
  const started = startBirthdayScheduler({}, {
    env: coinEnv(),
    host,
    runPass: () => { calls.push('pass'); },
    setInterval: (_fn, ms) => { scheduled = ms; return { unref() {} }; }
  });
  assert.equal(started.ok, true);
  assert.equal(scheduled, 60 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['pass']);
  assert.equal(process.env.BIRTHDAY_ENABLED || '', '');
  assert.equal(process.env.NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED || '', '');
});

test('store keeps birthday fields, commands stay private, and audit omits the date', async () => {
  const { dir, store, audit } = openStore();
  const deps = { enabled: true, store, audit, now: () => Date.parse('2026-06-02T03:04:05.000Z') };
  const interaction = mockInteraction();
  await handleCardInteraction(interaction, { ...deps, enabled: true, birthdayEnabled: true, isEnabled: () => true });
  assert.equal(interaction.calls[0].content, COPY.savedFirst);
  assert.deepEqual(interaction.calls[0].allowedMentions, { parse: [] });
  assert.equal(interaction.calls[0].flags, MessageFlags.Ephemeral);
  assert.equal(interaction.calls[0].content.includes(ZONE), false);
  assert.equal(interaction.calls[0].content.includes('27'), false);
  const saved = store.getUser(USER).birthday;
  assert.equal(saved.month, 8);
  assert.equal(saved.day, 27);
  assert.equal(saved.timezone, ZONE);
  assert.equal(saved.visibility, 'hidden');
  assert.equal(saved.announce, false);
  const reloaded = new JsonCardStore(path.join(dir, 'cards.json'));
  assert.equal(reloaded.getUser(USER).birthday.timezone, ZONE);
  assert.equal(reloaded.getUser(USER).birthday.day, 27);
  const text = auditText(dir);
  assert.equal(text.includes(ZONE), false);
  assert.equal(text.includes('"month"'), false);
  assert.equal(text.includes('"day"'), false);
  assert.equal(text.includes('"timezone"'), false);
  const scrubbed = sanitizeBirthdayAudit({ action: 'birthday-set', month: 8, day: 27, timezone: ZONE, note: ZONE });
  assert.equal(JSON.stringify(scrubbed).includes(ZONE), false);
  assert.equal(scrubbed.month, undefined);

  const locked = mockInteraction({
    options: {
      getSubcommand: () => 'set',
      getSubcommandGroup: () => 'birthday',
      getInteger: (name) => (name === 'month' ? 8 : 26),
      getString: (name) => (name === 'timezone' ? ZONE : null),
      getBoolean: () => null,
      getUser: () => null
    }
  });
  await handleCardInteraction(locked, { ...deps, birthdayEnabled: true, isEnabled: () => true, now: () => Date.parse('2026-06-02T03:04:05.000Z') + DAY });
  assert.equal(locked.calls[0].content, COPY.locked);

  const privacy = mockInteraction({
    options: {
      getSubcommand: () => 'privacy',
      getSubcommandGroup: () => 'birthday',
      getInteger: () => null,
      getString: () => null,
      getBoolean: (name) => (name === 'announce' ? false : null),
      getUser: () => null
    }
  });
  await handleCardInteraction(privacy, { ...deps, birthdayEnabled: true, isEnabled: () => true });
  assert.equal(privacy.calls[0].content, COPY.private);
  assert.deepEqual(privacy.calls[0].allowedMentions, { parse: [] });

  const off = mockInteraction();
  await handleCardInteraction(off, { enabled: true, birthdayEnabled: false, isEnabled: () => true, store, audit });
  assert.equal(off.calls[0].content, COPY.off);
  const plain = cardCommandDefinition().toJSON();
  assert.equal(plain.options.some((option) => option.name === 'birthday'), false);
  const enabled = cardCommandDefinition({ birthdayEnabled: true }).toJSON();
  assert.ok(enabled.options.some((option) => option.name === 'birthday'));
  assert.equal(suggestTimezones(ZONE).some((item) => item.value === ZONE), true);
});

test('delivery catch-up, delays, privacy fallback, eligibility, and reveal idempotency', async () => {
  const birthday = { month: 3, day: 8, timezone: 'America/New_York' };
  const scheduled = deliveryInstant(birthday, 2026, 9);
  const { dir, store, audit } = openStore();
  const setAt = scheduled - 20 * DAY;
  await store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      visibility: 'hidden',
      announce: false,
      cleared: false,
      setAt: new Date(setAt).toISOString(),
      changedAt: new Date(setAt).toISOString(),
      revision: 1,
      gifts: {}
    }
  }));
  const dms = [];
  const channels = [];
  const base = {
    enabled: true,
    store,
    audit,
    env: coinEnv(),
    loadMember: async () => member(scheduled),
    deliverPrivate: async (_id, payload) => { dms.push(payload); },
    deliverChannel: async (payload) => { channels.push(payload); }
  };
  const early = await runBirthdayPass({ ...base, now: () => scheduled - 60 * 1000 });
  assert.equal(early.ready, 0);
  assert.equal(dms.length, 0);
  const due = await runBirthdayPass({ ...base, now: () => scheduled + (6 * 60 * 60 * 1000) });
  assert.equal(due.ready, 1);
  assert.equal(dms.length, 1);
  assert.deepEqual(dms[0].allowedMentions, { parse: [] });
  assert.equal(dms[0].content.includes('2026'), false);
  assert.equal(dms[0].content.includes('March'), false);
  assert.equal(channels.length, 0);
  const again = await runBirthdayPass({ ...base, now: () => scheduled + (7 * 60 * 60 * 1000) });
  assert.equal(again.ready, 0);
  assert.equal(dms.length, 1);

  const lateStore = openStore();
  await lateStore.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      visibility: 'hidden',
      announce: false,
      setAt: new Date(scheduled - 10 * DAY).toISOString(),
      changedAt: new Date(scheduled - 10 * DAY).toISOString(),
      revision: 1,
      gifts: {}
    }
  }));
  const tooSoon = await runBirthdayPass({
    ...base,
    store: lateStore.store,
    now: () => scheduled + 60 * 1000
  });
  assert.equal(tooSoon.ready, 0);

  const changed = openStore();
  await changed.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      visibility: 'shown',
      announce: false,
      setAt: new Date(scheduled - 90 * DAY).toISOString(),
      changedAt: new Date(scheduled - 10 * DAY).toISOString(),
      revision: 2,
      gifts: {}
    }
  }));
  const postChange = await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: changed.store,
    audit: changed.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled, { name: '**@everyone** <@999>' }),
    deliverPrivate: async () => { throw new Error('dm closed'); },
    deliverChannel: async (payload) => { channels.push(payload); }
  });
  assert.equal(postChange.ready, 0);
  await changed.store.updateBirthday(USER, (current) => ({
    birthday: { ...current, changedAt: new Date(scheduled - 40 * DAY).toISOString() }
  }));
  const announced = await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: changed.store,
    audit: changed.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled, { name: '**@everyone** <@999>' }),
    deliverPrivate: async () => { throw new Error('dm closed'); },
    deliverChannel: async (payload) => { channels.push(payload); }
  });
  assert.equal(announced.ready, 1);
  assert.equal(channels.length, 1);
  assert.deepEqual(channels[0].allowedMentions, { parse: [] });
  assert.equal(channels[0].content.includes('@everyone'), false);
  assert.equal(channels[0].content.includes('<@'), false);
  assert.equal(channels[0].content.includes('America/New_York'), false);
  assert.equal(channels[0].reveal, undefined);

  const hidden = openStore();
  const hiddenChannels = [];
  await hidden.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      visibility: 'hidden',
      announce: false,
      setAt: new Date(scheduled - 40 * DAY).toISOString(),
      changedAt: new Date(scheduled - 40 * DAY).toISOString(),
      revision: 1,
      gifts: {}
    }
  }));
  await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: hidden.store,
    audit: hidden.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled),
    deliverPrivate: async () => { throw new Error('dm closed'); },
    deliverChannel: async (payload) => { hiddenChannels.push(payload); }
  });
  assert.equal(hiddenChannels.length, 0);

  const restricted = openStore();
  await restricted.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      setAt: new Date(scheduled - 40 * DAY).toISOString(),
      changedAt: new Date(scheduled - 40 * DAY).toISOString(),
      revision: 1,
      gifts: {}
    }
  }));
  const blocked = await runBirthdayPass({
    enabled: true,
    env: coinEnv({ CARD_RESTRICTED_ROLE_IDS: '333000000000000003' }),
    store: restricted.store,
    audit: restricted.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled, { roles: ['333000000000000003'] }),
    deliverPrivate: async () => { throw new Error('should not dm'); }
  });
  assert.equal(blocked.ready, 0);
  const young = await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: restricted.store,
    audit: restricted.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled, { ageDays: 29, roles: [] }),
    deliverPrivate: async () => { throw new Error('should not dm'); }
  });
  assert.equal(young.ready, 0);
  const timedOut = await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: restricted.store,
    audit: restricted.audit,
    now: () => scheduled + 60 * 1000,
    loadMember: async () => member(scheduled, { timeout: new Date(scheduled + DAY) }),
    deliverPrivate: async () => { throw new Error('should not dm'); }
  });
  assert.equal(timedOut.ready, 0);

  const gifts = store.getUser(USER).birthday.gifts;
  const year = Object.keys(gifts)[0];
  const calls = [];
  const claimDeps = {
    ...base,
    now: () => scheduled + 60 * 1000,
    economy: { credit: async (input) => { calls.push(input); return { ok: true, amount: 90, duplicate: false }; } }
  };
  const first = await claimBirthdayGift(claimDeps, USER);
  const second = await claimBirthdayGift(claimDeps, USER);
  assert.match(first.text, /You opened your present/);
  assert.equal(second.text, COPY.already);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].idempotencyKey, `birthday-gift:${USER}:${year}`);
  assert.equal(calls[0].source, 'birthday-gift');
  assert.equal(calls[0].currency, 'NEXUS_COINS');
  assert.equal(calls[0].amount, undefined);
  assert.equal(store.getUser(USER).birthday.gifts[year].status, 'revealed');
  const described = await describeBirthdayGift(claimDeps, USER);
  assert.equal(described.text, COPY.already);

  const deferredStore = openStore();
  const alerts = [];
  const retryAt = new Date(scheduled + DAY).toISOString();
  await deferredStore.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      setAt: new Date(scheduled - 40 * DAY).toISOString(),
      changedAt: new Date(scheduled - 40 * DAY).toISOString(),
      revision: 1,
      gifts: {
        2026: {
          status: 'ready',
          provider: 'coins',
          scheduledAt: new Date(scheduled).toISOString(),
          revealExpiresAt: new Date(scheduled + 7 * DAY).toISOString(),
          readyAt: new Date(scheduled).toISOString()
        }
      }
    }
  }));
  let mode = 'defer';
  const deferDeps = {
    enabled: true,
    env: coinEnv(),
    store: deferredStore.store,
    audit: deferredStore.audit,
    now: () => Date.parse('2026-03-09T04:00:00.000Z'),
    loadMember: async () => member(scheduled),
    alertStaff: async (payload) => { alerts.push(payload); },
    economy: {
      credit: async () => (mode === 'defer'
        ? { ok: false, deferred: true, retryAt, skipped: 'daily-cap-deferred' }
        : { ok: true, amount: 100, duplicate: false })
    }
  };
  const waiting = await claimBirthdayGift(deferDeps, USER);
  const repeat = await claimBirthdayGift(deferDeps, USER);
  assert.equal(waiting.text, COPY.tomorrow);
  assert.equal(repeat.text, COPY.tomorrow);
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].allowedMentions, { parse: [] });
  assert.equal(alerts[0].content.includes('America/New_York'), false);
  assert.equal(deferredStore.store.getUser(USER).birthday.gifts['2026'].status, 'ready');
  assert.equal(deferredStore.store.getUser(USER).birthday.gifts['2026'].alertedFor, '2026-03-08');
  mode = 'pay';
  const later = await claimBirthdayGift({ ...deferDeps, now: () => Date.parse(retryAt) + 1000 }, USER);
  assert.match(later.text, /100 Nexus Coins/);
  assert.equal(deferredStore.store.getUser(USER).birthday.gifts['2026'].status, 'revealed');
  assert.equal(auditText(deferredStore.dir).includes('America/New_York'), false);

  const expired = openStore();
  await expired.store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      setAt: new Date(scheduled - 40 * DAY).toISOString(),
      changedAt: new Date(scheduled - 40 * DAY).toISOString(),
      revision: 1,
      gifts: {
        2026: {
          status: 'ready',
          provider: 'coins',
          scheduledAt: new Date(scheduled).toISOString(),
          revealExpiresAt: new Date(scheduled + 7 * DAY).toISOString(),
          readyAt: new Date(scheduled).toISOString(),
          deferredUntil: new Date(scheduled + 8 * DAY).toISOString()
        }
      }
    }
  }));
  const kept = await runBirthdayPass({
    enabled: true,
    env: coinEnv(),
    store: expired.store,
    audit: expired.audit,
    now: () => scheduled + 9 * DAY,
    loadMember: async () => member(scheduled + 9 * DAY)
  });
  assert.equal(kept.expired, 0);
  assert.equal(expired.store.getUser(USER).birthday.gifts['2026'].status, 'ready');

  assert.deepEqual(liveBirthdayProviders(), ['coins']);
  const stub = await grantBirthdayProvider('gift-b', { credit: async () => ({ ok: true }) }, {});
  assert.equal(stub.skipped, 'provider-unavailable');
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/discord/nexus-guide.json'), 'utf8'));
  const topic = guide.topics.find((item) => item.id === 'birthdays');
  const topicText = `${topic.label} ${topic.summary} ${topic.details.join(' ')}`;
  assert.match(topicText, /\/card birthday/);
  assert.doesNotMatch(topicText, /sentinal|sentinel/i);
  const model = await assembleCardModel({
    viewerId: USER,
    targetUserId: USER,
    readers: {
      prefs: async () => ({ hidden: false, tags: {}, platforms: {}, birthday: { month: 8, day: 27, timezone: ZONE } }),
      xp: async () => ({ level: 1, xp: 0, nextLevelXp: 100, progressPercent: 0 }),
      rank: async () => ({ id: 'shadow-recruit', name: 'Shadow Recruit' }),
      cosmetics: async () => ({}),
      balances: async () => ({ coins: 1, points: 1, cacheTokens: 1 })
    }
  });
  assert.equal(JSON.stringify(model).includes(ZONE), false);
});

test('a hold at claim skips that gift year and a lift does not back-pay', async () => {
  const { dir, store, audit } = openStore();
  const birthday = { month: 3, day: 8, timezone: 'America/New_York' };
  const scheduled = deliveryInstant(birthday, 2026, 9);
  const now = scheduled + 60 * 1000;
  await store.updateBirthday(USER, () => ({
    birthday: {
      ...birthday,
      visibility: 'hidden',
      announce: false,
      cleared: false,
      setAt: new Date(scheduled - 40 * DAY).toISOString(),
      changedAt: new Date(scheduled - 40 * DAY).toISOString(),
      revision: 1,
      gifts: {
        2026: {
          status: 'ready',
          provider: 'coins',
          scheduledAt: new Date(scheduled).toISOString(),
          revealExpiresAt: new Date(scheduled + 7 * DAY).toISOString(),
          readyAt: new Date(scheduled).toISOString()
        }
      }
    }
  }));
  let held = true;
  const calls = [];
  const deps = {
    enabled: true,
    env: coinEnv(),
    store,
    audit,
    now: () => now,
    loadMember: async () => member(scheduled),
    economy: {
      credit: async () => {
        calls.push(held ? 'held' : 'lifted');
        if (held) return { ok: false, skipped: 'account-hold', credited: 0 };
        return { ok: true, amount: 90, duplicate: false };
      }
    }
  };
  const first = await claimBirthdayGift(deps, USER);
  assert.equal(first.code, 'skipped');
  assert.equal(first.text, COPY.skipped);
  assert.equal(store.getUser(USER).birthday.gifts['2026'].status, 'skipped');
  assert.equal(store.getUser(USER).birthday.gifts['2026'].skipReason, 'account-hold');
  held = false;
  const second = await claimBirthdayGift(deps, USER);
  const described = await describeBirthdayGift(deps, USER);
  assert.equal(second.text, COPY.skipped);
  assert.equal(described.text, COPY.skipped);
  assert.deepEqual(calls, ['held']);
  assert.equal(store.getUser(USER).birthday.gifts['2026'].status, 'skipped');
  const reloaded = new JsonCardStore(path.join(dir, 'cards.json'));
  assert.equal(reloaded.getUser(USER).birthday.gifts['2026'].status, 'skipped');
  const again = await runBirthdayPass({ ...deps, now: () => now + DAY });
  assert.equal(again.ready, 0);
  assert.equal(store.getUser(USER).birthday.gifts['2026'].status, 'skipped');
  const text = auditText(dir);
  assert.equal(text.includes('America/New_York'), false);
  assert.equal(text.includes('"month"'), false);
  assert.equal(text.includes('"day"'), false);
});
