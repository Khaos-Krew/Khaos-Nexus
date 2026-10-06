'use strict';

function flagOn(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function coinShopFlags(env = process.env) {
  return Object.freeze({
    shopEnabled: flagOn(env.COIN_SHOP_ENABLED),
    spendEnabled: flagOn(env.NEXUS_ECONOMY_COIN_SHOP_SPEND_ENABLED)
  });
}

const SNOWFLAKE = /^\d{15,24}$/;

function snowflakeList(raw) {
  const parts = String(raw ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => !SNOWFLAKE.test(part))) return null;
  return parts;
}

function snowflakeId(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (!SNOWFLAKE.test(text)) return null;
  return text;
}

// Preview is env-only. A blank entry is ignored. One garbage id closes the
// whole preview. This does not change COIN_SHOP_ENABLED or the spend flag.
function coinShopPreview(env = process.env) {
  const parsedRoles = snowflakeList(env.COIN_SHOP_PREVIEW_ROLE_IDS);
  const parsedChannel = snowflakeId(env.COIN_SHOP_PREVIEW_CHANNEL_ID);
  const roleIds = Array.isArray(parsedRoles) ? parsedRoles : [];
  const channelId = typeof parsedChannel === 'string' ? parsedChannel : '';
  return Object.freeze({
    open: roleIds.length > 0 && channelId.length > 0,
    roleIds,
    channelId
  });
}

const COIN_SHOP_PURCHASE_CEILING = 1000;

function purchaseCeiling(env = process.env) {
  const raw = env.NEXUS_ECONOMY_COIN_SHOP_PURCHASE_CEILING;
  if (raw == null || String(raw).trim() === '') return COIN_SHOP_PURCHASE_CEILING;
  const ceiling = Number(String(raw).trim());
  if (!Number.isSafeInteger(ceiling) || ceiling < 1) return null;
  return Math.min(ceiling, COIN_SHOP_PURCHASE_CEILING);
}

module.exports = { flagOn, coinShopFlags, coinShopPreview, purchaseCeiling, COIN_SHOP_PURCHASE_CEILING };
