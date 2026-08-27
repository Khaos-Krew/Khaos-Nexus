'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const MAX_HISTORY = 25;
const MANAGED_SECTIONS = new Set(['Kits', 'ShopItems', 'SellItems']);
const GENERAL_KEYS = new Set([
  'TimedPointsReward', 'ItemsPerPage', 'ShopDisplayTime', 'ShopTextSize', 'DefaultKit',
  'GiveDinosInCryopods', 'CryoLimitedTime', 'UseOriginalTradeCommandWithUI',
  'PreventUseNoglin', 'PreventUseUnconscious', 'PreventUseHandcuffed', 'PreventUseCarried'
]);
const FORBIDDEN_KEY = /(^|[_-])(mysql|password|passwd|token|secret|credential|webhook|api[_-]?key)($|[_-])/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId(value) {
  const id = cleanText(value, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('ArkShop profile id is required.');
  return id;
}

function validateEntryId(value) {
  const id = cleanText(value, 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error('ArkShop entry id may only contain letters, numbers, underscore, and hyphen.');
  return id;
}

function validateSection(value) {
  const section = cleanText(value, 30);
  if (!MANAGED_SECTIONS.has(section)) throw new Error('Managed ArkShop section must be Kits, ShopItems, or SellItems.');
  return section;
}

function sanitizeJson(value, { depth = 0, counter = { nodes: 0 } } = {}) {
  counter.nodes += 1;
  if (counter.nodes > 6000) throw new Error('ArkShop profile definition is too large.');
  if (depth > 12) throw new Error('ArkShop profile definition is nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('ArkShop profile contains a non-finite number.');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > 8000) throw new Error('ArkShop profile string value is too long.');
    return value.replace(/\u0000/g, '');
  }
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeJson(item, { depth: depth + 1, counter }));
  if (!value || typeof value !== 'object') throw new Error('ArkShop profile contains an unsupported JSON value.');
  const out = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || '').trim();
    if (!key || key.length > 120 || DANGEROUS_KEYS.has(key)) throw new Error(`Unsafe ArkShop profile key: ${key || '(empty)'}`);
    if (FORBIDDEN_KEY.test(key)) throw new Error(`Protected or secret-like ArkShop key is not allowed in profiles: ${key}`);
    out[key] = sanitizeJson(rawValue, { depth: depth + 1, counter });
  }
  return out;
}

function sanitizeGeneral(value = {}) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const key of GENERAL_KEYS) {
    if (!(key in value)) continue;
    out[key] = sanitizeJson(value[key]);
  }
  return out;
}

function normalizeManagedSections(value = []) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter((item) => MANAGED_SECTIONS.has(item)))];
}

function normalizeData(value = {}) {
  const managedSections = normalizeManagedSections(value.managedSections);
  const data = {
    managedSections,
    General: sanitizeGeneral(value.General),
    Kits: {},
    ShopItems: {},
    SellItems: {}
  };
  for (const section of MANAGED_SECTIONS) {
    const source = value?.[section];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [id, definition] of Object.entries(source)) {
      const safeId = validateEntryId(id);
      data[section][safeId] = sanitizeJson(definition);
      if (Object.keys(data[section]).length >= 500) break;
    }
  }
  return data;
}

function fromLiveConfig(config = {}) {
  return normalizeData({
    managedSections: ['Kits', 'ShopItems', 'SellItems'],
    General: config.General || {},
    Kits: config.Kits || {},
    ShopItems: config.ShopItems || {},
    SellItems: config.SellItems || {}
  });
}

function counts(data = {}) {
  const normalized = normalizeData(data);
  return {
    kits: Object.keys(normalized.Kits).length,
    shopItems: Object.keys(normalized.ShopItems).length,
    sellItems: Object.keys(normalized.SellItems).length,
    general: Object.keys(normalized.General).length,
    managedSections: normalized.managedSections.length
  };
}

function snapshot(profile, note = '') {
  return {
    revision: Number(profile.revision) || 1,
    savedAt: new Date().toISOString(),
    note: cleanText(note, 160),
    data: normalizeData(profile.data)
  };
}

function normalizeProfile(value = {}) {
  const now = new Date().toISOString();
  return {
    id: cleanId(value.id),
    name: cleanText(value.name || value.id, 100),
    description: cleanText(value.description, 300),
    revision: Math.max(1, Number(value.revision) || 1),
    data: normalizeData(value.data),
    history: Array.isArray(value.history) ? value.history.slice(-MAX_HISTORY).map((item) => ({
      revision: Math.max(1, Number(item?.revision) || 1),
      savedAt: cleanText(item?.savedAt, 80),
      note: cleanText(item?.note, 160),
      data: normalizeData(item?.data)
    })) : [],
    createdAt: cleanText(value.createdAt || now, 80),
    updatedAt: cleanText(value.updatedAt || now, 80)
  };
}

class ArkShopProfileStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'arkshop-profiles.json');
  }

  read() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { state = { version: STORE_VERSION, profiles: {} }; }
    state ||= {};
    state.version = STORE_VERSION;
    state.profiles ||= {};
    for (const [id, raw] of Object.entries(state.profiles)) {
      try { state.profiles[id] = normalizeProfile({ ...raw, id }); } catch { delete state.profiles[id]; }
    }
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    state.version = STORE_VERSION;
    state.updatedAt = new Date().toISOString();
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return state;
  }

  list() { return Object.values(this.read().profiles).sort((a, b) => a.name.localeCompare(b.name)); }
  get(id) { return this.read().profiles[cleanId(id)] || null; }

  create({ id, name = '', description = '', data = {} } = {}) {
    const state = this.read();
    const key = cleanId(id);
    if (state.profiles[key]) throw new Error(`ArkShop profile already exists: ${key}`);
    const now = new Date().toISOString();
    const profile = normalizeProfile({ id: key, name: name || key, description, revision: 1, data, history: [], createdAt: now, updatedAt: now });
    state.profiles[key] = profile;
    this.write(state);
    return JSON.parse(JSON.stringify(profile));
  }

  mutate(id, mutator, note = '') {
    const state = this.read();
    const key = cleanId(id);
    const current = state.profiles[key];
    if (!current) throw new Error(`Unknown ArkShop profile: ${key}`);
    const draft = JSON.parse(JSON.stringify(current));
    const before = snapshot(current, note || 'Previous revision');
    mutator(draft);
    draft.data = normalizeData(draft.data);
    draft.history = [...current.history, before].slice(-MAX_HISTORY);
    draft.revision = current.revision + 1;
    draft.createdAt = current.createdAt;
    draft.updatedAt = new Date().toISOString();
    const next = normalizeProfile(draft);
    state.profiles[key] = next;
    this.write(state);
    return JSON.parse(JSON.stringify(next));
  }

  setEntry({ profileId, section, entryId, definition } = {}) {
    const safeSection = validateSection(section);
    const safeId = validateEntryId(entryId);
    const safeDefinition = sanitizeJson(definition);
    if (!safeDefinition || typeof safeDefinition !== 'object' || Array.isArray(safeDefinition)) throw new Error('ArkShop entry definition must be a JSON object.');
    return this.mutate(profileId, (profile) => {
      profile.data.managedSections = [...new Set([...(profile.data.managedSections || []), safeSection])];
      profile.data[safeSection] ||= {};
      profile.data[safeSection][safeId] = safeDefinition;
    }, `Set ${safeSection}.${safeId}`);
  }

  removeEntry({ profileId, section, entryId } = {}) {
    const safeSection = validateSection(section);
    const safeId = validateEntryId(entryId);
    return this.mutate(profileId, (profile) => {
      if (!(safeId in (profile.data?.[safeSection] || {}))) throw new Error('That ArkShop entry is not present in the profile.');
      delete profile.data[safeSection][safeId];
      profile.data.managedSections = [...new Set([...(profile.data.managedSections || []), safeSection])];
    }, `Remove ${safeSection}.${safeId}`);
  }

  setGeneral({ profileId, key, value } = {}) {
    const safeKey = String(key || '').trim();
    if (!GENERAL_KEYS.has(safeKey)) throw new Error(`Unsupported safe ArkShop General key: ${safeKey}`);
    const safeValue = sanitizeJson(value);
    return this.mutate(profileId, (profile) => {
      profile.data.General ||= {};
      profile.data.General[safeKey] = safeValue;
    }, `Set General.${safeKey}`);
  }

  importLive({ id, name = '', description = '', config } = {}) {
    const existing = this.get(id);
    if (!existing) return this.create({ id, name: name || id, description, data: fromLiveConfig(config) });
    return this.mutate(id, (profile) => { profile.data = fromLiveConfig(config); }, 'Import current live ArkShop config');
  }

  restoreRevision(profileId, revision) {
    const target = Number(revision);
    if (!Number.isInteger(target) || target < 1) throw new Error('ArkShop profile revision must be a positive integer.');
    return this.mutate(profileId, (profile) => {
      const snapshotItem = profile.history.find((item) => item.revision === target);
      if (!snapshotItem) throw new Error(`Revision ${target} is not retained.`);
      profile.data = normalizeData(snapshotItem.data);
    }, `Restore revision ${target}`);
  }

  remove(id) {
    const state = this.read();
    const key = cleanId(id);
    const existing = state.profiles[key] || null;
    if (!existing) return null;
    delete state.profiles[key];
    this.write(state);
    return existing;
  }
}

module.exports = {
  STORE_VERSION,
  MAX_HISTORY,
  MANAGED_SECTIONS,
  GENERAL_KEYS,
  FORBIDDEN_KEY,
  cleanId,
  validateEntryId,
  validateSection,
  sanitizeJson,
  sanitizeGeneral,
  normalizeManagedSections,
  normalizeData,
  fromLiveConfig,
  counts,
  snapshot,
  normalizeProfile,
  ArkShopProfileStore
};
