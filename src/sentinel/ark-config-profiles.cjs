'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;
const MAX_HISTORY = 25;
const FILE_KEYS = new Set(['gus', 'game']);
const SENSITIVE_KEY = /(password|passwd|token|secret|credential|api[_-]?key|auth[_-]?key)/i;

function cleanText(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanId(value) {
  const id = cleanText(value, 64).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) throw new Error('Config profile id is required.');
  return id;
}

function validateFileKey(value) {
  const key = cleanText(value, 20).toLowerCase();
  if (!FILE_KEYS.has(key)) throw new Error('Config profile file must be gus or game.');
  return key;
}

function validateSection(value) {
  const section = cleanText(value, 120);
  if (!section || /[\[\]\r\n]/.test(section)) throw new Error('INI section name is invalid.');
  return section;
}

function validateSettingKey(value) {
  const key = cleanText(value, 120);
  if (!key || /[=\[\]\r\n]/.test(key)) throw new Error('INI setting key is invalid.');
  if (SENSITIVE_KEY.test(key)) throw new Error('Sensitive/password/token settings are not allowed in reusable ARK config profiles. Keep those in protected server variables/config controls.');
  return key;
}

function normalizeValue(value) {
  const text = String(value ?? '').replace(/[\r\n]/g, '').trim();
  if (text.length > 2000) throw new Error('INI profile value is too long.');
  return text;
}

function emptyFiles() {
  return { gus: { sections: {} }, game: { sections: {} } };
}

function normalizeSections(value = {}) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [rawSection, settings] of Object.entries(value)) {
    let section;
    try { section = validateSection(rawSection); } catch { continue; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
    const cleanSettings = {};
    for (const [rawKey, rawValue] of Object.entries(settings)) {
      try {
        const key = validateSettingKey(rawKey);
        cleanSettings[key] = normalizeValue(rawValue);
      } catch {}
      if (Object.keys(cleanSettings).length >= 250) break;
    }
    if (Object.keys(cleanSettings).length) out[section] = cleanSettings;
    if (Object.keys(out).length >= 80) break;
  }
  return out;
}

function normalizeFiles(value = {}) {
  return {
    gus: { sections: normalizeSections(value?.gus?.sections || value?.gus || {}) },
    game: { sections: normalizeSections(value?.game?.sections || value?.game || {}) }
  };
}

function cloneFiles(files) {
  return JSON.parse(JSON.stringify(normalizeFiles(files)));
}

function countSettings(files) {
  const normalized = normalizeFiles(files);
  const result = { total: 0, gus: 0, game: 0 };
  for (const fileKey of FILE_KEYS) {
    for (const settings of Object.values(normalized[fileKey].sections)) {
      const count = Object.keys(settings).length;
      result[fileKey] += count;
      result.total += count;
    }
  }
  return result;
}

function snapshot(profile, note = '') {
  return {
    revision: Number(profile.revision) || 1,
    savedAt: new Date().toISOString(),
    note: cleanText(note, 160),
    files: cloneFiles(profile.files)
  };
}

function normalizeHistory(value = []) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY).map((item) => ({
    revision: Math.max(1, Number(item?.revision) || 1),
    savedAt: cleanText(item?.savedAt, 80),
    note: cleanText(item?.note, 160),
    files: cloneFiles(item?.files)
  }));
}

function normalizeProfile(value = {}) {
  const now = new Date().toISOString();
  const id = cleanId(value.id);
  return {
    id,
    name: cleanText(value.name || id, 100) || id,
    description: cleanText(value.description, 300),
    revision: Math.max(1, Number(value.revision) || 1),
    files: cloneFiles(value.files),
    history: normalizeHistory(value.history),
    createdAt: cleanText(value.createdAt || now, 80),
    updatedAt: cleanText(value.updatedAt || now, 80)
  };
}

function emptyStore() {
  return { version: STORE_VERSION, profiles: {}, updatedAt: new Date().toISOString() };
}

class ArkConfigProfileStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'ark-config-profiles.json');
  }

  read() {
    let state;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { state = emptyStore(); }
    if (!state || typeof state !== 'object') state = emptyStore();
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

  list() {
    return Object.values(this.read().profiles).sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id) {
    return this.read().profiles[cleanId(id)] || null;
  }

  create({ id, name = '', description = '', files = null } = {}) {
    const state = this.read();
    const key = cleanId(id);
    if (state.profiles[key]) throw new Error(`ARK config profile already exists: ${key}`);
    const now = new Date().toISOString();
    const profile = normalizeProfile({ id: key, name: name || key, description, revision: 1, files: files || emptyFiles(), history: [], createdAt: now, updatedAt: now });
    state.profiles[key] = profile;
    this.write(state);
    return JSON.parse(JSON.stringify(profile));
  }

  ensure({ id, name = '', description = '' } = {}) {
    const existing = this.get(id);
    return existing || this.create({ id, name, description });
  }

  mutate(id, mutator, note = '') {
    const state = this.read();
    const key = cleanId(id);
    const existing = state.profiles[key];
    if (!existing) throw new Error(`Unknown ARK config profile: ${key}`);
    const before = snapshot(existing, note || 'Previous revision');
    const draft = JSON.parse(JSON.stringify(existing));
    mutator(draft);
    draft.files = cloneFiles(draft.files);
    draft.history = [...existing.history, before].slice(-MAX_HISTORY);
    draft.revision = existing.revision + 1;
    draft.createdAt = existing.createdAt;
    draft.updatedAt = new Date().toISOString();
    const normalized = normalizeProfile(draft);
    state.profiles[key] = normalized;
    this.write(state);
    return JSON.parse(JSON.stringify(normalized));
  }

  setSetting({ profileId, fileKey, section, key, value } = {}) {
    const file = validateFileKey(fileKey);
    const safeSection = validateSection(section);
    const safeKey = validateSettingKey(key);
    const safeValue = normalizeValue(value);
    return this.mutate(profileId, (profile) => {
      profile.files ||= emptyFiles();
      profile.files[file] ||= { sections: {} };
      profile.files[file].sections ||= {};
      profile.files[file].sections[safeSection] ||= {};
      profile.files[file].sections[safeSection][safeKey] = safeValue;
    }, `Set ${file}.${safeSection}.${safeKey}`);
  }

  unsetSetting({ profileId, fileKey, section, key } = {}) {
    const file = validateFileKey(fileKey);
    const safeSection = validateSection(section);
    const safeKey = validateSettingKey(key);
    return this.mutate(profileId, (profile) => {
      const settings = profile.files?.[file]?.sections?.[safeSection];
      if (!settings || !(safeKey in settings)) throw new Error('That setting is not present in the profile.');
      delete settings[safeKey];
      if (!Object.keys(settings).length) delete profile.files[file].sections[safeSection];
    }, `Unset ${file}.${safeSection}.${safeKey}`);
  }

  clone(sourceId, { id, name = '', description = '' } = {}) {
    const source = this.get(sourceId);
    if (!source) throw new Error(`Unknown ARK config profile: ${cleanId(sourceId)}`);
    return this.create({ id, name: name || `${source.name} Copy`, description: description || source.description, files: source.files });
  }

  restoreRevision(profileId, revision) {
    const targetRevision = Number(revision);
    if (!Number.isInteger(targetRevision) || targetRevision < 1) throw new Error('Profile revision must be a positive integer.');
    return this.mutate(profileId, (profile) => {
      const item = profile.history.find((entry) => entry.revision === targetRevision);
      if (!item) throw new Error(`Revision ${targetRevision} is not available in retained history.`);
      profile.files = cloneFiles(item.files);
    }, `Restore revision ${targetRevision}`);
  }

  remove(id) {
    const state = this.read();
    const key = cleanId(id);
    const existing = state.profiles[key];
    if (!existing) return null;
    delete state.profiles[key];
    this.write(state);
    return existing;
  }
}

module.exports = {
  STORE_VERSION,
  MAX_HISTORY,
  FILE_KEYS,
  SENSITIVE_KEY,
  cleanText,
  cleanId,
  validateFileKey,
  validateSection,
  validateSettingKey,
  normalizeValue,
  emptyFiles,
  normalizeSections,
  normalizeFiles,
  cloneFiles,
  countSettings,
  snapshot,
  normalizeProfile,
  emptyStore,
  ArkConfigProfileStore
};
