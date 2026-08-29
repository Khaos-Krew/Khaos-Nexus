'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RESOURCE_BUYS } = require('./arkshop-nexus-launch-v4-resources-startup.cjs');

const STORE_VERSION = 1;
const DEFAULT_MAX_BUYBACK_RATIO = 0.5;
const MAX_HISTORY = 20000;

const SELL_ASSET_PATHS = Object.freeze({
  wood: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_Wood_Child.PrimalItemResource_Wood_Child'",
  stone: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_Stone_Child.PrimalItemResource_Stone_Child'",
  ingots: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_MetalIngot_Child.PrimalItemResource_MetalIngot_Child'",
  paste: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_ChitinPaste_Child.PrimalItemResource_ChitinPaste_Child'",
  crystal: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_Crystal_Child.PrimalItemResource_Crystal_Child'",
  polymer: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_Polymer_Child.PrimalItemResource_Polymer_Child'",
  blackpearls: "Blueprint'/TG_Stack_10000_90/Resources/PrimalItemResource_BlackPearl_Child.PrimalItemResource_BlackPearl_Child'"
});

const BUY_REFERENCE = Object.freeze({
  wood: 'wood10k',
  stone: 'stone10k',
  ingots: 'ingots5k',
  paste: 'paste5k',
  crystal: 'crystal5k',
  polymer: 'polymer2500',
  blackpearls: 'blackpearls1k'
});

function cleanId(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(text)) throw new Error('Sell-market player ID contains unsupported characters.');
  return text;
}

function safeInt(value, name, { min = 1, max = 1_000_000_000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return number;
}

function startOfUtcDay(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfUtcWeek(timestamp) {
  const day = startOfUtcDay(timestamp);
  const date = new Date(day);
  const weekday = (date.getUTCDay() + 6) % 7;
  return day - weekday * 86400000;
}

function buySpecFor(assetId) {
  const ref = BUY_REFERENCE[assetId];
  const spec = ref ? RESOURCE_BUYS[ref] : null;
  if (!spec) return null;
  const [description, price, gfi, amount] = spec;
  return { ref, description, price: Number(price), amount: Number(amount), gfi };
}

function validateListing(assetId, listing = {}, { maxBuybackRatio = DEFAULT_MAX_BUYBACK_RATIO } = {}) {
  if (!SELL_ASSET_PATHS[assetId]) throw new Error(`Unknown Nexus sell asset: ${assetId}`);
  const amount = safeInt(listing.amount, 'Sell amount');
  const price = safeInt(listing.price, 'Sell price');
  const dailyLimit = safeInt(listing.dailyLimit, 'Daily sell limit', { min: amount });
  const weeklyLimit = safeInt(listing.weeklyLimit, 'Weekly sell limit', { min: dailyLimit });
  if (dailyLimit % amount !== 0 || weeklyLimit % amount !== 0) throw new Error('Sell limits must be exact multiples of the listing amount.');
  const buy = buySpecFor(assetId);
  if (!buy) throw new Error(`No buy-side reference exists for ${assetId}; anti-arbitrage validation cannot run.`);
  const maxPayout = Math.floor((amount / buy.amount) * buy.price * Number(maxBuybackRatio));
  if (!Number.isFinite(maxPayout) || maxPayout < 1) throw new Error('Buyback ratio/listing amount produces no safe payout.');
  if (price > maxPayout) throw new Error(`Sell price ${price} exceeds the anti-arbitrage ceiling ${maxPayout} for ${assetId}.`);
  return {
    assetId,
    amount,
    price,
    dailyLimit,
    weeklyLimit,
    blueprint: SELL_ASSET_PATHS[assetId],
    buyReference: buy.ref,
    maxPayout,
    maxBuybackRatio: Number(maxBuybackRatio)
  };
}

class SellQuotaStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-nexus-sell-market.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        version: STORE_VERSION,
        reservations: Array.isArray(parsed.reservations) ? parsed.reservations : [],
        history: Array.isArray(parsed.history) ? parsed.history.slice(-MAX_HISTORY) : []
      };
    } catch {
      return { version: STORE_VERSION, reservations: [], history: [] };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = {
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
      reservations: state.reservations || [],
      history: (state.history || []).slice(-MAX_HISTORY)
    };
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
    return safe;
  }

  usage(eosId, assetId, now = Date.now()) {
    const player = cleanId(eosId);
    const state = this.read();
    const day = startOfUtcDay(now);
    const week = startOfUtcWeek(now);
    const committed = state.history.filter((entry) => entry.eosId === player && entry.assetId === assetId && entry.state === 'completed');
    const reserved = state.reservations.filter((entry) => entry.eosId === player && entry.assetId === assetId && entry.expiresAt > now);
    const sum = (entries, since) => entries.filter((entry) => entry.createdAtMs >= since).reduce((total, entry) => total + Number(entry.amount || 0), 0);
    return {
      dayUsed: sum(committed, day) + sum(reserved, day),
      weekUsed: sum(committed, week) + sum(reserved, week)
    };
  }

  reserve({ eosId, listing, bundles = 1, now = Date.now(), ttlMs = 120000 } = {}) {
    const player = cleanId(eosId);
    const count = safeInt(bundles, 'Sell bundle count', { max: 10000 });
    const amount = listing.amount * count;
    const payout = listing.price * count;
    const usage = this.usage(player, listing.assetId, now);
    if (usage.dayUsed + amount > listing.dailyLimit) return { ok: false, reason: 'daily-limit', usage, amount };
    if (usage.weekUsed + amount > listing.weeklyLimit) return { ok: false, reason: 'weekly-limit', usage, amount };

    const state = this.read();
    state.reservations = state.reservations.filter((entry) => entry.expiresAt > now);
    const reservation = {
      id: crypto.randomUUID(),
      eosId: player,
      assetId: listing.assetId,
      amount,
      payout,
      bundles: count,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      expiresAt: now + Math.max(10000, Number(ttlMs) || 120000)
    };
    state.reservations.push(reservation);
    this.write(state);
    return { ok: true, reservation: JSON.parse(JSON.stringify(reservation)) };
  }

  finalize(id, stateName, error = '') {
    if (!['completed', 'cancelled', 'manual_review'].includes(stateName)) throw new Error('Invalid sell reservation final state.');
    const state = this.read();
    const index = state.reservations.findIndex((entry) => entry.id === id);
    if (index < 0) throw new Error('Unknown sell reservation.');
    const [reservation] = state.reservations.splice(index, 1);
    state.history.push({
      ...reservation,
      state: stateName,
      finalizedAt: new Date().toISOString(),
      error: String(error || '').replace(/[\r\n]+/g, ' ').slice(0, 300)
    });
    this.write(state);
    return JSON.parse(JSON.stringify(state.history.at(-1)));
  }
}

module.exports = {
  STORE_VERSION,
  DEFAULT_MAX_BUYBACK_RATIO,
  SELL_ASSET_PATHS,
  BUY_REFERENCE,
  buySpecFor,
  validateListing,
  SellQuotaStore,
  startOfUtcDay,
  startOfUtcWeek
};
