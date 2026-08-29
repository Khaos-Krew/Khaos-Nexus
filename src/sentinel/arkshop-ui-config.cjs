'use strict';

const ALLOWED_KEYS = new Set([
  'UiKey', 'ShopName', 'WebsiteUrl', 'DiscordUrl', 'VoteRewards',
  'DisableSellButton', 'DisableTradeButton', 'HideBuffIcon',
  'OverrideCurrencyIcon', 'UseSteamOverlay', 'OverrideLabels'
]);

const LABEL_KEYS = new Set([
  'ItemsTabLabel', 'KitsTabLabel', 'StashTabLabel', 'SellTabLabel',
  'TradeTabLabel', 'WebsiteLabel', 'DiscordLabel', 'ClaimVotesLabel'
]);

function clean(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function validUrl(value, { allowEmpty = true } = {}) {
  const text = clean(value, 500);
  if (!text) return allowEmpty;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function validAssetPath(value) {
  const text = clean(value, 500);
  if (!text) return true;
  return /^\/[A-Za-z0-9_.\/-]+$/.test(text) && !text.includes('..');
}

function validateArkShopUiConfig(config = {}) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: ['ArkShopUI config must be a JSON object.'], warnings };
  }

  for (const key of Object.keys(config)) {
    if (!ALLOWED_KEYS.has(key)) warnings.push(`Unknown ArkShopUI key: ${key}`);
  }

  const key = clean(config.UiKey, 8).toUpperCase();
  if (!/^F(?:[1-9]|1[0-2])$/.test(key)) errors.push('UiKey must be F1 through F12.');
  if (!clean(config.ShopName, 80)) errors.push('ShopName is required.');
  if (!validUrl(config.DiscordUrl, { allowEmpty: false })) errors.push('DiscordUrl must be a valid http/https URL.');
  if (!validUrl(config.WebsiteUrl)) errors.push('WebsiteUrl must be empty or a valid http/https URL.');
  if (!validAssetPath(config.OverrideCurrencyIcon)) errors.push('OverrideCurrencyIcon must be an Unreal/ARK asset path beginning with /, not an http/https URL.');

  for (const name of ['VoteRewards', 'DisableSellButton', 'DisableTradeButton', 'HideBuffIcon', 'UseSteamOverlay']) {
    if (typeof config[name] !== 'boolean') errors.push(`${name} must be boolean.`);
  }

  if (!Array.isArray(config.OverrideLabels)) {
    errors.push('OverrideLabels must be an array.');
  } else {
    const seen = new Set();
    for (const [index, entry] of config.OverrideLabels.entries()) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        errors.push(`OverrideLabels[${index}] must be an object.`);
        continue;
      }
      const keys = Object.keys(entry);
      if (keys.length !== 1 || !LABEL_KEYS.has(keys[0])) {
        errors.push(`OverrideLabels[${index}] must contain exactly one supported label key.`);
        continue;
      }
      const label = keys[0];
      if (seen.has(label)) errors.push(`OverrideLabels contains duplicate ${label}.`);
      seen.add(label);
      if (!clean(entry[label], 80)) errors.push(`${label} must not be empty.`);
    }
  }

  if (!clean(config.WebsiteUrl, 500)) warnings.push('Nexus Portal URL is not configured; do not deploy the Website button live until a URL is selected.');
  if (!clean(config.OverrideCurrencyIcon, 500)) warnings.push('Custom Nexus Points icon is unset; ArkShopUI will use its default currency icon until a cooked ASA asset path is verified.');
  if (config.DisableSellButton !== true) warnings.push('Sell button should stay disabled until the capped Nexus sell market is live and arbitrage-checked.');

  return { ok: errors.length === 0, errors, warnings };
}

function productionSafe(config = {}) {
  const result = validateArkShopUiConfig(config);
  const blockers = [...result.errors];
  if (!clean(config.WebsiteUrl, 500)) blockers.push('missing-website-url');
  if (config.DisableSellButton !== true) blockers.push('sell-market-not-locked');
  return { ...result, productionSafe: result.ok && blockers.length === 0, blockers };
}

module.exports = {
  ALLOWED_KEYS,
  LABEL_KEYS,
  validAssetPath,
  validateArkShopUiConfig,
  productionSafe
};
