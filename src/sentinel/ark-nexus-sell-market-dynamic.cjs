'use strict';

const { buySpecFor, validateListing } = require('./ark-nexus-sell-market.cjs');

const DEFAULT_CONFIG = Object.freeze({
  intervalHours: 6,
  lookbackDays: 7,
  minBuybackRatio: 0.20,
  baseBuybackRatio: 0.35,
  maxBuybackRatio: 0.50,
  demandBoost: 0.12,
  volumePenaltyMax: 0.18,
  volumeBoostMax: 0.12
});

const BASE_LISTINGS = Object.freeze({
  wood:        { amount: 10000, dailyLimit: 40000, weeklyLimit: 160000 },
  stone:       { amount: 10000, dailyLimit: 40000, weeklyLimit: 160000 },
  ingots:      { amount: 5000,  dailyLimit: 20000, weeklyLimit: 80000 },
  paste:       { amount: 5000,  dailyLimit: 20000, weeklyLimit: 80000 },
  crystal:     { amount: 5000,  dailyLimit: 20000, weeklyLimit: 80000 },
  polymer:     { amount: 2500,  dailyLimit: 10000, weeklyLimit: 40000 },
  blackpearls: { amount: 1000,  dailyLimit: 4000,  weeklyLimit: 16000 }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bucketStart(now = Date.now(), intervalHours = DEFAULT_CONFIG.intervalHours) {
  const width = Math.max(1, Number(intervalHours) || DEFAULT_CONFIG.intervalHours) * 3600000;
  return Math.floor(Number(now) / width) * width;
}

function recentCompleted(history = [], sinceMs = 0) {
  return history.filter((entry) => entry?.state === 'completed' && Number(entry?.createdAtMs || 0) >= sinceMs);
}

function soldByAsset(history = [], now = Date.now(), config = DEFAULT_CONFIG) {
  const since = Number(now) - Math.max(1, Number(config.lookbackDays) || 7) * 86400000;
  const totals = Object.fromEntries(Object.keys(BASE_LISTINGS).map((key) => [key, 0]));
  for (const entry of recentCompleted(history, since)) {
    if (!(entry.assetId in totals)) continue;
    totals[entry.assetId] += Math.max(0, Number(entry.amount || 0));
  }
  return totals;
}

function normalizedVolumes(totals = {}) {
  const volumes = {};
  for (const [assetId, base] of Object.entries(BASE_LISTINGS)) {
    const weeklyCapacity = Math.max(1, Number(base.weeklyLimit));
    volumes[assetId] = Math.max(0, Number(totals[assetId] || 0)) / weeklyCapacity;
  }
  return volumes;
}

function demandAssetForPeriod(volumes = {}, now = Date.now(), intervalHours = DEFAULT_CONFIG.intervalHours) {
  const keys = Object.keys(BASE_LISTINGS);
  const minimum = Math.min(...keys.map((key) => Number(volumes[key] || 0)));
  const underused = keys.filter((key) => Math.abs(Number(volumes[key] || 0) - minimum) < 1e-9).sort();
  const period = Math.floor(bucketStart(now, intervalHours) / (Math.max(1, intervalHours) * 3600000));
  return underused[((period % underused.length) + underused.length) % underused.length];
}

function ratioForAsset(assetId, volumes, demandAsset, config = DEFAULT_CONFIG) {
  const keys = Object.keys(BASE_LISTINGS);
  const values = keys.map((key) => Number(volumes[key] || 0));
  const average = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const value = Number(volumes[assetId] || 0);
  let adjustment = 0;
  if (average > 0) {
    const relative = (average - value) / Math.max(average, 0.01);
    adjustment += relative >= 0
      ? Math.min(config.volumeBoostMax, relative * config.volumeBoostMax)
      : Math.max(-config.volumePenaltyMax, relative * config.volumePenaltyMax);
  } else {
    adjustment += config.volumeBoostMax * 0.5;
  }
  if (assetId === demandAsset) adjustment += config.demandBoost;
  return clamp(config.baseBuybackRatio + adjustment, config.minBuybackRatio, config.maxBuybackRatio);
}

function payoutFor(assetId, amount, ratio) {
  const buy = buySpecFor(assetId);
  if (!buy) throw new Error(`No buy reference for ${assetId}.`);
  const raw = (Number(amount) / buy.amount) * buy.price * ratio;
  return Math.max(1, Math.floor(raw));
}

function buildDynamicMarket({ history = [], now = Date.now(), config = DEFAULT_CONFIG } = {}) {
  const merged = { ...DEFAULT_CONFIG, ...(config || {}) };
  const totals = soldByAsset(history, now, merged);
  const volumes = normalizedVolumes(totals);
  const demandAsset = demandAssetForPeriod(volumes, now, merged.intervalHours);
  const listings = {};

  for (const [assetId, base] of Object.entries(BASE_LISTINGS)) {
    const ratio = ratioForAsset(assetId, volumes, demandAsset, merged);
    const price = payoutFor(assetId, base.amount, ratio);
    listings[assetId] = {
      ...validateListing(assetId, { ...base, price }, { maxBuybackRatio: merged.maxBuybackRatio }),
      dynamicRatio: Number(ratio.toFixed(4)),
      demandBoosted: assetId === demandAsset,
      recentVolume: Number(volumes[assetId].toFixed(4))
    };
  }

  return {
    generatedAt: new Date(now).toISOString(),
    periodStart: new Date(bucketStart(now, merged.intervalHours)).toISOString(),
    intervalHours: merged.intervalHours,
    demandAsset,
    listings
  };
}

function shouldRebalance(previous = null, now = Date.now(), intervalHours = DEFAULT_CONFIG.intervalHours) {
  if (!previous?.periodStart) return true;
  const previousStart = Date.parse(previous.periodStart);
  if (!Number.isFinite(previousStart)) return true;
  return bucketStart(previousStart, intervalHours) !== bucketStart(now, intervalHours);
}

module.exports = {
  DEFAULT_CONFIG,
  BASE_LISTINGS,
  bucketStart,
  soldByAsset,
  normalizedVolumes,
  demandAssetForPeriod,
  ratioForAsset,
  payoutFor,
  buildDynamicMarket,
  shouldRebalance
};
