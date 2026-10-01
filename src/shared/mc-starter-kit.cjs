'use strict';

const KIT_VERSION = '2026-10-01';
const ACCOUNT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TENURE_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_PLAY_MS = 15 * 60 * 1000;
const BACKPACK_ID = 'sophisticatedbackpacks:backpack';

const DEFAULT_KIT_ITEMS = Object.freeze([
  Object.freeze({ itemId: 'minecraft:iron_pickaxe', qty: 1 }),
  Object.freeze({ itemId: 'minecraft:iron_axe', qty: 1 }),
  Object.freeze({ itemId: 'minecraft:iron_shovel', qty: 1 }),
  Object.freeze({ itemId: 'minecraft:stone_sword', qty: 1 }),
  Object.freeze({ itemId: 'minecraft:bread', qty: 16 }),
  Object.freeze({ itemId: 'minecraft:torch', qty: 32 }),
  Object.freeze({ itemId: 'minecraft:white_bed', qty: 1 }),
  Object.freeze({ itemId: 'minecraft:crafting_table', qty: 1 }),
  Object.freeze({ itemId: 'create:wrench', qty: 1 }),
  Object.freeze({ itemId: 'create:andesite_alloy', qty: 16 }),
  Object.freeze({ itemId: BACKPACK_ID, qty: 1 })
]);

function loadStarterKit(env = process.env) {
  const raw = String(env.MC_STARTER_KIT_JSON || '').trim();
  let items = DEFAULT_KIT_ITEMS.map((item) => ({ ...item }));
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) throw new Error('MC_STARTER_KIT_JSON must be a non-empty array.');
    items = parsed.map((item) => ({
      itemId: String(item?.itemId || '').trim(),
      qty: Number(item?.qty)
    }));
  }
  if (!items.some((item) => item.itemId === BACKPACK_ID && item.qty >= 1)) {
    throw new Error('Starter Kit must include sophisticatedbackpacks:backpack.');
  }
  const backpack = items.filter((item) => item.itemId === BACKPACK_ID);
  const rest = items.filter((item) => item.itemId !== BACKPACK_ID);
  return Object.freeze({
    version: KIT_VERSION,
    items: Object.freeze([...rest, ...backpack].map((item) => Object.freeze({ ...item })))
  });
}

function starterKitEligibility({
  identityVerified = false,
  linkVerified = false,
  premiumUuid = false,
  quarantined = false,
  disabled = false,
  accountCreatedAt = null,
  joinedAt = null,
  lifetimeMs = 0,
  alreadyClaimedByIdentity = false,
  alreadyClaimedByUuid = false,
  now = Date.now()
} = {}) {
  if (disabled || quarantined) return { ok: false, reason: 'not-eligible' };
  if (!identityVerified) return { ok: false, reason: 'verified-identity-required' };
  if (!linkVerified || !premiumUuid) return { ok: false, reason: 'verified-minecraft-link-required' };
  if (alreadyClaimedByIdentity || alreadyClaimedByUuid) return { ok: false, reason: 'already-claimed' };
  const created = Number(accountCreatedAt);
  const joined = Number(joinedAt);
  if (!Number.isFinite(created)) return { ok: false, reason: 'account-age-unknown' };
  if (now - created < ACCOUNT_AGE_MS) return { ok: false, reason: 'account-too-new' };
  if (!Number.isFinite(joined)) return { ok: false, reason: 'tenure-unknown' };
  if (now - joined < TENURE_MS) return { ok: false, reason: 'tenure-too-short' };
  if (Number(lifetimeMs || 0) < FIRST_PLAY_MS) return { ok: false, reason: 'playtime-too-short' };
  return { ok: true };
}

module.exports = {
  KIT_VERSION,
  ACCOUNT_AGE_MS,
  TENURE_MS,
  FIRST_PLAY_MS,
  BACKPACK_ID,
  DEFAULT_KIT_ITEMS,
  loadStarterKit,
  starterKitEligibility
};
