'use strict';

const { CONFIG, deterministicRng, rollLevel } = require('./ark-dino-cache-engine.cjs');
const { allowed, WEEKLY_CACHE_RETIRED } = require('./ark-weekly-cache.cjs');
const { zonedParts, zonedLocalToUtc } = require('./card/birthday-calendar.cjs');
const { arnFlags } = require('../shared/arn-flags.cjs');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');

const CT = 'America/Chicago';
const POOL_SIZE = 8;
const PUBLIC_ROTATION_SECRET = 'khaos-nexus-arn-rotation-v1-public';
const WEEKDAY_INDEX = Object.freeze({ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 });

function ctWeekdayIndex(nowMs) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: CT, weekday: 'short' }).format(new Date(nowMs));
  const index = WEEKDAY_INDEX[label];
  if (index == null) throw new Error('ARN week boundary could not be resolved.');
  return index;
}

function ctDayStart(nowMs) {
  const parts = zonedParts(nowMs, CT);
  return zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, CT);
}

function ctWeekStart(nowMs) {
  const parts = zonedParts(nowMs, CT);
  const local = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  local.setUTCDate(local.getUTCDate() - ctWeekdayIndex(nowMs));
  return zonedLocalToUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 0, 0, CT);
}

function nextCtWeekStart(weekStartMs) {
  return ctWeekStart(weekStartMs + (8 * 24 * 60 * 60 * 1000));
}

function rotationSecret(env = process.env) {
  const configured = String(env.ARN_ROTATION_SECRET || env.NEXUS_DINO_CACHE_RNG_SECRET || '').trim();
  return configured.length >= 32 ? configured : PUBLIC_ROTATION_SECRET;
}

function approvedEntries() {
  const seen = new Set();
  const entries = [];
  for (const group of Object.values(CONFIG.groups || {})) {
    for (const entry of group || []) {
      if (!allowed(entry) || seen.has(entry.name)) continue;
      seen.add(entry.name);
      entries.push(entry);
    }
  }
  return entries;
}

function arnRotation(nowMs = Date.now(), secret = rotationSecret()) {
  if (WEEKLY_CACHE_RETIRED !== true) throw new Error('ARN cache requires the weekly cache to stay retired.');
  const startsAt = ctWeekStart(nowMs);
  const rng = deterministicRng(secret, `arn-cache:${startsAt}`);
  const ranked = approvedEntries()
    .map((entry) => ({ entry, score: rng() }))
    .sort((a, b) => a.score - b.score);
  if (ranked.length < POOL_SIZE) throw new Error('ARN cache needs eight approved ASA creatures.');
  return {
    id: String(startsAt),
    startsAt,
    endsAt: nextCtWeekStart(startsAt),
    timeZone: CT,
    entries: ranked.slice(0, POOL_SIZE).map((row) => ({
      name: row.entry.name,
      blueprint: row.entry.blueprint,
      rarity: row.entry.rarity
    }))
  };
}

function drawTame(rotation, seed) {
  const key = String(seed || '').length >= 32 ? String(seed) : `${String(seed || 'arn-draw')}-arn-draw-padding-32chars`;
  const rng = deterministicRng(key, `arn-draw:${rotation.id}`);
  const index = Math.floor(rng() * rotation.entries.length);
  const entry = rotation.entries[index];
  const level = rollLevel(rng, CONFIG);
  const sex = rng() < 0.5 ? 'female' : 'male';
  return {
    species: entry.name,
    blueprint: entry.blueprint,
    level,
    sex,
    variant: 'normal',
    shiny: false,
    saddle: ''
  };
}

function deliveryPermitted(env = process.env) {
  const arn = arnFlags(env);
  const shop = arkNpFlags(env);
  return arn.creditsEnabled === true && shop.shopDeliveryEnabled === true && shop.dryRun === false;
}

function buildArnDeliveryOrder({ drawn, eosId, orderId }) {
  return {
    orderId: String(orderId || ''),
    sku: 'arn-cache',
    source: 'arn-cache',
    currency: 'ARN_TOKENS',
    eosIds: [String(eosId || '')].filter(Boolean),
    roll: {
      blueprint: drawn.blueprint,
      level: drawn.level,
      sex: drawn.sex,
      saddle: ''
    }
  };
}

async function openArnCache({
  env = process.env,
  now = Date.now(),
  discordUserId = '',
  secret,
  deliver,
  book,
  eosId = ''
} = {}) {
  const rotation = arnRotation(now, secret || rotationSecret(env));
  const base = {
    ok: false,
    reason: 'dry-run',
    raCalled: false,
    debited: false,
    currency: 'ARN_TOKENS',
    rotation
  };
  if (!deliveryPermitted(env) || !book) return base;
  const drawn = drawTame(rotation, `open:${discordUserId}:${rotation.id}:${now}`);
  const orderId = `arn-open:${discordUserId}:${rotation.id}:${now}`;
  const order = buildArnDeliveryOrder({ drawn, eosId, orderId });
  const spent = await book.spend({ discordUserId, key: orderId, now, env });
  if (!spent?.debited) return { ...base, reason: spent?.reason || 'not-spent', drawn, order };
  const send = deliver || (async () => {
    const flags = arkNpFlags(env);
    if (flags.dryRun || !flags.shopDeliveryEnabled) return { ok: false, raCalled: false, reason: 'dry-run' };
    const { deliverPreparedOrder, httpDeps } = require('./ark-np-delivery.cjs');
    return deliverPreparedOrder(order, httpDeps(env));
  });
  let delivery;
  try {
    delivery = await send(order, env);
  } catch (error) {
    await book.refund({ economicIdentityId: spent.economicIdentityId, key: orderId, now });
    return { ...base, reason: 'delivery-failed', drawn, order };
  }
  if (delivery?.raCalled !== true) {
    await book.refund({ economicIdentityId: spent.economicIdentityId, key: orderId, now });
    return { ...base, reason: delivery?.reason || 'not-sent', drawn, order };
  }
  return {
    ok: true,
    reason: 'submitted',
    raCalled: true,
    debited: true,
    currency: 'ARN_TOKENS',
    rotation,
    drawn,
    order
  };
}

module.exports = {
  CT,
  POOL_SIZE,
  PUBLIC_ROTATION_SECRET,
  ctDayStart,
  ctWeekStart,
  nextCtWeekStart,
  rotationSecret,
  arnRotation,
  drawTame,
  deliveryPermitted,
  buildArnDeliveryOrder,
  openArnCache
};
