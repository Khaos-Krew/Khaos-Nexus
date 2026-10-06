'use strict';

const crypto = require('node:crypto');
const { CONFIG, deterministicRng, rollLevel } = require('./ark-dino-cache-engine.cjs');
const { allowed, WEEKLY_CACHE_RETIRED } = require('./ark-weekly-cache.cjs');
const { zonedParts, zonedLocalToUtc } = require('./card/birthday-calendar.cjs');
const { arnFlags } = require('../shared/arn-flags.cjs');
const { arkNpFlags } = require('../shared/ark-np-flags.cjs');

const CT = 'America/Chicago';
const POOL_SIZE = 8;
const PUBLIC_ROTATION_SECRET = 'khaos-nexus-arn-rotation-v1-public';
const SLOT_WEIGHTS = Object.freeze({
  common: Object.freeze([20, 20]),
  uncommon: Object.freeze([15, 15]),
  rare: Object.freeze([10, 10]),
  ultra: Object.freeze([5, 5])
});
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

function usableSecret(secret) {
  const value = String(secret || '').trim();
  if (value.length < 32 || value === PUBLIC_ROTATION_SECRET) return '';
  return value;
}

function rotationSecret(env = process.env) {
  const dedicated = usableSecret(env.ARN_ROTATION_SECRET);
  if (dedicated) return dedicated;
  return usableSecret(env.NEXUS_DINO_CACHE_RNG_SECRET);
}

function previewRotation() {
  const entries = approvedEntries().map((entry) => ({
    name: entry.name,
    blueprint: entry.blueprint,
    rarity: entry.rarity,
    weight: 0,
    preview: true
  }));
  return {
    id: 'preview',
    version: 'preview',
    preview: true,
    startsAt: null,
    endsAt: null,
    timeZone: CT,
    entries
  };
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

function slotsFor(entries, rarity, secretRng) {
  const weights = SLOT_WEIGHTS[rarity];
  const ranked = entries
    .filter((entry) => entry.rarity === rarity)
    .map((entry) => ({ entry, score: secretRng() }))
    .sort((left, right) => left.score - right.score);
  if (!ranked.length) throw new Error(`ARN cache is missing an approved ${rarity} creature.`);
  return weights.map((weight, index) => {
    const source = ranked[Math.min(index, ranked.length - 1)].entry;
    return {
      name: source.name,
      blueprint: source.blueprint,
      rarity: source.rarity,
      weight
    };
  });
}

function arnRotation(nowMs = Date.now(), secret = rotationSecret()) {
  if (WEEKLY_CACHE_RETIRED !== true) throw new Error('ARN cache requires the weekly cache to stay retired.');
  const key = usableSecret(secret);
  if (!key) return previewRotation();
  const startsAt = ctWeekStart(nowMs);
  const rng = deterministicRng(key, `arn-cache:${startsAt}`);
  const approved = approvedEntries();
  const entries = ['common', 'uncommon', 'rare', 'ultra'].flatMap((rarity) => slotsFor(approved, rarity, rng));
  if (entries.length !== POOL_SIZE) throw new Error('ARN cache needs eight weighted slots.');
  const version = String(startsAt);
  return {
    id: version,
    version,
    startsAt,
    endsAt: nextCtWeekStart(startsAt),
    timeZone: CT,
    entries
  };
}

function hmacUnit(secret, orderId) {
  const digest = crypto.createHmac('sha256', String(secret)).update(String(orderId)).digest();
  return digest.readUIntBE(0, 6) / 281474976710656;
}

function drawTame(rotation, orderId, secret = rotationSecret()) {
  const key = usableSecret(secret);
  if (!key) throw new Error('ARN rotation secret is required.');
  if (rotation?.preview === true) throw new Error('ARN preview list is not a draw.');
  const entries = rotation?.entries || [];
  const total = entries.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
  if (!(total > 0)) throw new Error('ARN rotation weights are empty.');
  let cursor = hmacUnit(key, orderId) * total;
  let entry = entries[entries.length - 1];
  for (const candidate of entries) {
    cursor -= Number(candidate.weight || 0);
    if (cursor < 0) {
      entry = candidate;
      break;
    }
  }
  const rngKey = key;
  const rng = deterministicRng(rngKey, `arn-level:${rotation.id}:${orderId}`);
  const level = rollLevel(rng, CONFIG);
  const sex = rng() < 0.5 ? 'female' : 'male';
  return {
    species: entry.name,
    blueprint: entry.blueprint,
    level,
    sex,
    variant: 'normal',
    shiny: false,
    saddle: '',
    weight: entry.weight,
    rotationVersion: rotation.version || rotation.id
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
  secret
} = {}) {
  return {
    ok: false,
    reason: 'dry-run',
    raCalled: false,
    debited: false,
    currency: 'ARN_TOKENS',
    rotation: arnRotation(now, secret || rotationSecret(env))
  };
}

module.exports = {
  CT,
  POOL_SIZE,
  PUBLIC_ROTATION_SECRET,
  SLOT_WEIGHTS,
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
