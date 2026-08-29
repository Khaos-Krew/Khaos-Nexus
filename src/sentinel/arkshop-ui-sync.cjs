'use strict';

const { ALLOWED_KEYS, validateArkShopUiConfig } = require('./arkshop-ui-config.cjs');

const CONFIG_CANDIDATES = Object.freeze([
  'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShopUI/config.json',
  'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShopUI/Config.json'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeArkShopUiConfig(liveConfig = {}, desiredConfig = {}) {
  const validation = validateArkShopUiConfig(desiredConfig);
  if (!validation.ok) throw new Error(`Desired ArkShopUI config is invalid: ${validation.errors.join(' | ')}`);
  if (!liveConfig || typeof liveConfig !== 'object' || Array.isArray(liveConfig)) throw new Error('Live ArkShopUI config must be a JSON object.');

  const merged = clone(liveConfig);
  for (const key of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(desiredConfig, key)) merged[key] = clone(desiredConfig[key]);
  }
  return merged;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function configsEqual(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function diffArkShopUiConfig(liveConfig = {}, desiredConfig = {}) {
  const merged = mergeArkShopUiConfig(liveConfig, desiredConfig);
  const changedKeys = [];
  for (const key of ALLOWED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(desiredConfig, key)) continue;
    if (!configsEqual(liveConfig[key], merged[key])) changedKeys.push(key);
  }
  const preservedUnknownKeys = Object.keys(liveConfig).filter((key) => !ALLOWED_KEYS.has(key));
  return {
    changed: changedKeys.length > 0,
    changedKeys,
    preservedUnknownKeys,
    merged
  };
}

function evaluateArkShopUiReadiness({ pluginPresent, mod942249Active, arkShopVersion, arkShopUiVersion, liveConfigReadable } = {}) {
  const blockers = [];
  if (pluginPresent !== true) blockers.push('arkshopui-plugin-not-confirmed');
  if (mod942249Active !== true) blockers.push('mx-e-mod-942249-not-confirmed');
  if (liveConfigReadable !== true) blockers.push('arkshopui-live-config-not-readable');
  if (!String(arkShopVersion || '').trim()) blockers.push('arkshop-version-not-confirmed');
  if (!String(arkShopUiVersion || '').trim()) blockers.push('arkshopui-version-not-confirmed');
  return {
    ready: blockers.length === 0,
    blockers,
    arkShopVersion: String(arkShopVersion || '').trim(),
    arkShopUiVersion: String(arkShopUiVersion || '').trim()
  };
}

function deploymentPlan({ liveConfig, desiredConfig, readiness } = {}) {
  const ready = evaluateArkShopUiReadiness(readiness);
  const desiredValidation = validateArkShopUiConfig(desiredConfig);
  const blockers = [...ready.blockers, ...desiredValidation.errors.map((error) => `desired-config:${error}`)];
  if (!String(desiredConfig?.WebsiteUrl || '').trim()) blockers.push('nexus-portal-url-not-set');
  const diff = liveConfig && desiredValidation.ok ? diffArkShopUiConfig(liveConfig, desiredConfig) : null;
  return {
    safeToApply: blockers.length === 0,
    blockers,
    candidates: [...CONFIG_CANDIDATES],
    changedKeys: diff?.changedKeys || [],
    preservedUnknownKeys: diff?.preservedUnknownKeys || [],
    merged: diff?.merged || null,
    reloadCommand: 'ArkShop.Reload',
    requiresServerRestart: false
  };
}

module.exports = {
  CONFIG_CANDIDATES,
  mergeArkShopUiConfig,
  configsEqual,
  diffArkShopUiConfig,
  evaluateArkShopUiReadiness,
  deploymentPlan
};
