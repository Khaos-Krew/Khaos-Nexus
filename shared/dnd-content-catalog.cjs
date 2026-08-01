'use strict';

const crypto = require('node:crypto');

const CATALOG_SCHEMA_VERSION = 1;
const CATALOG_MAX_BYTES = 512 * 1024;
const PACK_MAX_BYTES = 64 * 1024 * 1024;
const CHARACTER_IMPORT_MAX_BYTES = 1024 * 1024;
const CHARACTER_IMPORT_MAX_DEPTH = 12;
const CHARACTER_IMPORT_MAX_NODES = 5000;
const CATALOG_REPOSITORY = 'Khaos-Krew/Khaos-Nexus';
const CATALOG_REF = 'dnd-content-catalog';
const CATALOG_PATH = 'catalog/dnd-free-content.json';
const TRUSTED_CATALOG_ACTORS = Object.freeze(['KhaosKrew-Kirito', 'web-flow']);
const ALLOWED_DOWNLOAD_HOSTS = Object.freeze([
  'media.dndbeyond.com',
  'media.wizards.com'
]);
const ALLOWED_PACK_MIME = Object.freeze(['application/pdf', 'application/json']);
const CHARACTER_STATUSES = Object.freeze(['active', 'backup', 'deceased', 'retired', 'inactive']);
const SOURCE_VISIBILITY = Object.freeze(['private', 'campaign']);
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{1,99}$/;
const SNOWFLAKE = /^\d{5,25}$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, max = 200) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function numeric(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function integer(value, fallback = 0) { return Math.trunc(numeric(value, fallback)); }
function uniqueStrings(value, max = 80) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => clean(item, max)).filter(Boolean))];
}
function fail(message, code = 'DND_CATALOG_INVALID', field = '') {
  const error = new Error(message);
  error.code = code;
  if (field) error.field = field;
  return error;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

const BUILTIN_CATALOG = Object.freeze({
  schemaVersion: CATALOG_SCHEMA_VERSION,
  catalogVersion: '2026.08.01.1',
  generatedAt: '2026-08-01T00:00:00.000Z',
  source: 'builtin',
  packs: Object.freeze([
    Object.freeze({
      id: 'wotc-srd-5.2.1-en',
      name: 'System Reference Document 5.2.1',
      description: 'Official English Creative Commons system reference for the 2024 fifth-edition rules.',
      ruleset: '5e_2024',
      version: '5.2.1',
      language: 'en',
      publisher: 'Wizards of the Coast',
      licenseId: 'CC-BY-4.0',
      licenseName: 'Creative Commons Attribution 4.0 International',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attributionText: 'This work includes material from the System Reference Document 5.2.1 by Wizards of the Coast LLC, available under the Creative Commons Attribution 4.0 International License.',
      downloadUrl: 'https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf',
      fileName: 'SRD_CC_v5.2.1.pdf',
      mimeType: 'application/pdf',
      bytes: 6031375,
      sha256: '8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87',
      contentOrigin: 'srd',
      fullTextAllowed: true,
      active: true
    }),
    Object.freeze({
      id: 'wotc-srd-5.1-en',
      name: 'System Reference Document 5.1',
      description: 'Official English Creative Commons system reference for the 2014 fifth-edition rules.',
      ruleset: '5e_2014',
      version: '5.1',
      language: 'en',
      publisher: 'Wizards of the Coast',
      licenseId: 'CC-BY-4.0',
      licenseName: 'Creative Commons Attribution 4.0 International',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      attributionText: 'This work includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, available under the Creative Commons Attribution 4.0 International License.',
      downloadUrl: 'https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf',
      fileName: 'SRD_CC_v5.1.pdf',
      mimeType: 'application/pdf',
      bytes: 3158713,
      sha256: '2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0',
      contentOrigin: 'srd',
      fullTextAllowed: true,
      active: true
    })
  ])
});

function assertHttpsUrl(value, label, allowedHosts = null) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw fail(`${label} must be a valid HTTPS URL.`, 'DND_CATALOG_URL_INVALID', label); }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail(`${label} must use HTTPS without embedded credentials.`, 'DND_CATALOG_URL_INVALID', label);
  if (allowedHosts && !allowedHosts.includes(url.hostname.toLowerCase())) throw fail(`${label} host is not approved.`, 'DND_CATALOG_HOST_UNTRUSTED', label);
  return url.toString();
}

function normalizePack(input = {}) {
  const id = clean(input.id, 100).toLowerCase();
  if (!SAFE_ID.test(id)) throw fail('Content pack ID is invalid.', 'DND_PACK_ID_INVALID', 'id');
  const name = clean(input.name, 160);
  if (!name) throw fail('Content pack name is required.', 'DND_PACK_NAME_REQUIRED', 'name');
  const version = clean(input.version, 40);
  if (!version) throw fail('Content pack version is required.', 'DND_PACK_VERSION_REQUIRED', 'version');
  const mimeType = clean(input.mimeType, 100).toLowerCase();
  if (!ALLOWED_PACK_MIME.includes(mimeType)) throw fail('Content pack type is not supported.', 'DND_PACK_MIME_INVALID', 'mimeType');
  const bytes = integer(input.bytes);
  if (!(bytes > 0 && bytes <= PACK_MAX_BYTES)) throw fail('Content pack size is outside the permitted range.', 'DND_PACK_SIZE_INVALID', 'bytes');
  const digest = clean(input.sha256, 64).toLowerCase();
  if (!SHA256.test(digest)) throw fail('Content pack SHA-256 is invalid.', 'DND_PACK_HASH_INVALID', 'sha256');
  const fileName = clean(input.fileName, 180);
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') throw fail('Content pack filename is invalid.', 'DND_PACK_FILENAME_INVALID', 'fileName');
  const expectedExtension = mimeType === 'application/pdf' ? '.pdf' : '.json';
  if (!fileName.toLowerCase().endsWith(expectedExtension)) throw fail(`Content pack filename must end in ${expectedExtension}.`, 'DND_PACK_FILENAME_INVALID', 'fileName');
  const licenseId = clean(input.licenseId, 80);
  const attributionText = clean(input.attributionText, 2000);
  if (!licenseId || !attributionText) throw fail('Content pack license and attribution are required.', 'DND_PACK_LICENSE_REQUIRED', 'licenseId');
  return {
    id,
    name,
    description: clean(input.description, 2000),
    ruleset: clean(input.ruleset || 'system_neutral', 80),
    version,
    language: clean(input.language || 'en', 20).toLowerCase(),
    publisher: clean(input.publisher, 160),
    licenseId,
    licenseName: clean(input.licenseName, 200),
    licenseUrl: assertHttpsUrl(input.licenseUrl, 'licenseUrl'),
    attributionText,
    downloadUrl: assertHttpsUrl(input.downloadUrl, 'downloadUrl', ALLOWED_DOWNLOAD_HOSTS),
    fileName,
    mimeType,
    bytes,
    sha256: digest,
    contentOrigin: clean(input.contentOrigin || 'srd', 80),
    fullTextAllowed: Boolean(input.fullTextAllowed),
    active: input.active !== false
  };
}

function normalizeCatalog(input = {}, source = 'remote') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('Catalog must be an object.');
  if (integer(input.schemaVersion) !== CATALOG_SCHEMA_VERSION) throw fail('Catalog schema version is unsupported.', 'DND_CATALOG_SCHEMA_UNSUPPORTED');
  const packs = Array.isArray(input.packs) ? input.packs : [];
  if (packs.length > 100) throw fail('Catalog contains too many packs.', 'DND_CATALOG_LIMIT');
  const normalized = packs.map(normalizePack);
  const ids = new Set();
  for (const pack of normalized) {
    if (ids.has(pack.id)) throw fail(`Catalog contains duplicate pack ${pack.id}.`, 'DND_CATALOG_DUPLICATE');
    ids.add(pack.id);
  }
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: clean(input.catalogVersion || '0', 80),
    generatedAt: clean(input.generatedAt, 80),
    source: clean(source, 80),
    packs: normalized
  };
}

function mergeCatalogs(builtin, remote = null) {
  const base = normalizeCatalog(builtin || BUILTIN_CATALOG, 'builtin');
  if (!remote) return base;
  const extra = normalizeCatalog(remote, 'remote');
  const byId = new Map(base.packs.map((pack) => [pack.id, pack]));
  for (const pack of extra.packs) byId.set(pack.id, pack);
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: extra.catalogVersion || base.catalogVersion,
    generatedAt: extra.generatedAt || base.generatedAt,
    source: 'builtin+remote',
    packs: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

function verifyGithubCatalogCommit(input = {}) {
  const repository = clean(input.repository, 200);
  const ref = clean(input.ref, 160);
  const path = clean(input.path, 300);
  const actor = clean(input.actor, 100);
  const sha = clean(input.sha, 64).toLowerCase();
  if (repository !== CATALOG_REPOSITORY || ref !== CATALOG_REF || path !== CATALOG_PATH) throw fail('Remote catalog repository, ref, or path is not trusted.', 'DND_CATALOG_SOURCE_UNTRUSTED');
  if (!TRUSTED_CATALOG_ACTORS.includes(actor)) throw fail('Remote catalog commit actor is not trusted.', 'DND_CATALOG_ACTOR_UNTRUSTED');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw fail('Remote catalog commit SHA is invalid.', 'DND_CATALOG_COMMIT_INVALID');
  return { repository, ref, path, actor, sha, verified: true };
}

function inspectJsonShape(value, depth = 0, counter = { nodes: 0 }) {
  counter.nodes += 1;
  if (counter.nodes > CHARACTER_IMPORT_MAX_NODES) throw fail('Character import contains too many values.', 'DND_CHARACTER_IMPORT_COMPLEX');
  if (depth > CHARACTER_IMPORT_MAX_DEPTH) throw fail('Character import is nested too deeply.', 'DND_CHARACTER_IMPORT_COMPLEX');
  if (value && typeof value === 'object') {
    for (const item of Array.isArray(value) ? value : Object.values(value)) inspectJsonShape(item, depth + 1, counter);
  }
  return counter.nodes;
}

function abilityModifierFromScore(score) { return Math.floor((numeric(score, 10) - 10) / 2); }

function normalizeAbilityModifiers(input = {}) {
  const aliases = {
    strength: ['strength', 'str'], dexterity: ['dexterity', 'dex'], constitution: ['constitution', 'con'],
    intelligence: ['intelligence', 'int'], wisdom: ['wisdom', 'wis'], charisma: ['charisma', 'cha']
  };
  const output = {};
  for (const [name, keys] of Object.entries(aliases)) {
    let value;
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(input, key)) { value = input[key]; break; }
    if (value === undefined) continue;
    if (value && typeof value === 'object') {
      if (Number.isFinite(Number(value.modifier))) output[name] = integer(value.modifier);
      else if (Number.isFinite(Number(value.score))) output[name] = abilityModifierFromScore(value.score);
    } else {
      const number = numeric(value, 0);
      output[name] = Math.abs(number) > 10 ? abilityModifierFromScore(number) : integer(number);
    }
  }
  return output;
}

function firstDefined(input, keys, fallback = undefined) {
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined && input[key] !== null) return input[key];
  return fallback;
}

function normalizeCharacterImport(documentValue, context = {}) {
  inspectJsonShape(documentValue);
  const format = clean(documentValue?.format, 80) || 'generic-json-v1';
  let raw = documentValue;
  if (format === 'khaos-nexus-character-v1') raw = documentValue.character;
  else if (documentValue?.character && typeof documentValue.character === 'object' && !Array.isArray(documentValue.character)) raw = documentValue.character;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('Character import must contain one character object.', 'DND_CHARACTER_IMPORT_INVALID');

  const name = clean(firstDefined(raw, ['name', 'characterName', 'character_name']), 120);
  if (!name) throw fail('Imported character name is required.', 'DND_CHARACTER_IMPORT_NAME_REQUIRED', 'name');
  const discordUserId = clean(firstDefined(raw, ['discordUserId', 'discord_user_id'], ''), 25);
  if (discordUserId && !SNOWFLAKE.test(discordUserId)) throw fail('Imported Discord user ID must be numeric.', 'DND_CHARACTER_IMPORT_DISCORD_INVALID', 'discordUserId');
  const level = integer(firstDefined(raw, ['level', 'characterLevel', 'character_level'], 1), 1);
  const hp = integer(firstDefined(raw, ['hp', 'currentHp', 'current_hp', 'hitPoints'], 0), 0);
  const maxHp = integer(firstDefined(raw, ['maxHp', 'max_hp', 'maximumHp', 'maximum_hp'], hp), hp);
  const armorClass = integer(firstDefined(raw, ['armorClass', 'armor_class', 'ac'], 10), 10);
  const exhaustion = integer(firstDefined(raw, ['exhaustion'], 0), 0);
  if (level < 0 || level > 30) throw fail('Imported level must be between 0 and 30.', 'DND_CHARACTER_IMPORT_RANGE', 'level');
  if (hp < 0 || maxHp < 0 || hp > maxHp) throw fail('Imported HP must be between 0 and maximum HP.', 'DND_CHARACTER_IMPORT_RANGE', 'hp');
  if (armorClass < 0 || armorClass > 99) throw fail('Imported Armor Class must be between 0 and 99.', 'DND_CHARACTER_IMPORT_RANGE', 'armorClass');
  if (exhaustion < 0 || exhaustion > 6) throw fail('Imported exhaustion must be between 0 and 6.', 'DND_CHARACTER_IMPORT_RANGE', 'exhaustion');

  const known = new Set([
    'id', 'campaignId', 'campaign_id', 'ownerUserId', 'owner_user_id', 'discordUserId', 'discord_user_id', 'name', 'characterName', 'character_name',
    'portraitUrl', 'portrait_url', 'level', 'characterLevel', 'character_level', 'className', 'class_name', 'class', 'hp', 'currentHp', 'current_hp',
    'hitPoints', 'maxHp', 'max_hp', 'maximumHp', 'maximum_hp', 'armorClass', 'armor_class', 'ac', 'conditions', 'inspiration', 'exhaustion',
    'status', 'activeQuestId', 'active_quest_id', 'initiativeModifier', 'initiative_modifier', 'abilityModifiers', 'ability_modifiers', 'abilities', 'selected', 'metadata'
  ]);
  const unknownFields = {};
  for (const [key, value] of Object.entries(raw)) if (!known.has(key)) unknownFields[key] = clone(value);
  const statusValue = clean(raw.status || 'active', 30).toLowerCase();
  const abilitySource = raw.abilityModifiers || raw.ability_modifiers || raw.abilities || {};
  const importedAt = clean(context.importedAt || new Date().toISOString(), 80);
  const sourceFileName = clean(context.sourceFileName, 180);
  const sourceSha256 = clean(context.sourceSha256, 64).toLowerCase();
  if (sourceSha256 && !SHA256.test(sourceSha256)) throw fail('Character import SHA-256 is invalid.', 'DND_CHARACTER_IMPORT_HASH_INVALID');

  return {
    campaignId: clean(context.campaignId || raw.campaignId || raw.campaign_id, 100),
    ownerUserId: clean(raw.ownerUserId || raw.owner_user_id, 100),
    discordUserId,
    name,
    portraitUrl: clean(raw.portraitUrl || raw.portrait_url, 800),
    level,
    className: clean(raw.className || raw.class_name || raw.class, 120),
    hp,
    maxHp,
    armorClass,
    conditions: uniqueStrings(raw.conditions),
    inspiration: Boolean(raw.inspiration),
    exhaustion,
    status: CHARACTER_STATUSES.includes(statusValue) ? statusValue : 'active',
    activeQuestId: clean(raw.activeQuestId || raw.active_quest_id, 100),
    initiativeModifier: integer(raw.initiativeModifier ?? raw.initiative_modifier, 0),
    abilityModifiers: normalizeAbilityModifiers(abilitySource),
    selected: Boolean(raw.selected),
    metadata: {
      ...(raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? clone(raw.metadata) : {}),
      import: { format, sourceFileName, sourceSha256, importedAt, unknownFields }
    }
  };
}

function parseCharacterImportBuffer(buffer, context = {}) {
  if (!Buffer.isBuffer(buffer)) throw fail('Character import must be a file buffer.', 'DND_CHARACTER_IMPORT_INVALID');
  if (!buffer.length || buffer.length > CHARACTER_IMPORT_MAX_BYTES) throw fail('Character import file size is invalid.', 'DND_CHARACTER_IMPORT_SIZE');
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); }
  catch { throw fail('Character import must contain valid JSON.', 'DND_CHARACTER_IMPORT_JSON_INVALID'); }
  return normalizeCharacterImport(parsed, { ...context, sourceSha256: sha256(buffer) });
}

function normalizeHomebrewSource(input = {}) {
  const name = clean(input.name, 160);
  if (!name) throw fail('Homebrew source name is required.', 'DND_HOMEBREW_SOURCE_NAME_REQUIRED', 'name');
  const visibility = SOURCE_VISIBILITY.includes(input.visibility) ? input.visibility : 'private';
  const author = clean(input.author, 160);
  const description = clean(input.description, 4000);
  return {
    ...(input.id ? { id: clean(input.id, 100) } : {}),
    name,
    ruleset: clean(input.ruleset || 'system_neutral', 80),
    sourceVersion: clean(input.version || input.sourceVersion || '1.0', 80),
    licenseType: 'user_authored',
    licenseReference: 'User-authored content controlled by the Khaos Nexus Owner.',
    attributionText: clean(input.attributionText || (author ? `Created by ${author}.` : 'User-authored Homebrew / Custom Source.'), 1000),
    externalReferenceUrl: input.externalReferenceUrl ? assertHttpsUrl(input.externalReferenceUrl, 'externalReferenceUrl') : '',
    isFullTextAllowed: true,
    active: input.active !== false,
    metadata: { kind: 'homebrew_source', author, description, visibility }
  };
}

function verifyPackBuffer(packInput, buffer) {
  const pack = normalizePack(packInput);
  if (!Buffer.isBuffer(buffer)) throw fail('Downloaded content is not a file buffer.', 'DND_PACK_BUFFER_INVALID');
  if (buffer.length !== pack.bytes) throw fail('Downloaded content size does not match the catalog.', 'DND_PACK_SIZE_MISMATCH');
  if (sha256(buffer) !== pack.sha256) throw fail('Downloaded content SHA-256 does not match the catalog.', 'DND_PACK_HASH_MISMATCH');
  if (pack.mimeType === 'application/pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw fail('Downloaded PDF signature is invalid.', 'DND_PACK_SIGNATURE_INVALID');
  if (pack.mimeType === 'application/json') {
    try { JSON.parse(buffer.toString('utf8')); }
    catch { throw fail('Downloaded JSON content is invalid.', 'DND_PACK_SIGNATURE_INVALID'); }
  }
  return { bytes: buffer.length, sha256: pack.sha256, verified: true };
}

function compareVersions(left, right) {
  const parts = (value) => String(value || '').split(/[^0-9]+/).filter(Boolean).map(Number);
  const a = parts(left); const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return String(left || '').localeCompare(String(right || ''));
}

function catalogView(catalogInput, installed = []) {
  const catalog = normalizeCatalog(catalogInput || BUILTIN_CATALOG, catalogInput?.source || 'catalog');
  const byId = new Map((Array.isArray(installed) ? installed : []).map((item) => [item.packId, item]));
  return catalog.packs.filter((pack) => pack.active).map((pack) => {
    const record = byId.get(pack.id) || null;
    const validInstall = Boolean(record?.installed && record.sha256 === pack.sha256 && record.bytes === pack.bytes);
    return {
      ...pack,
      install: record ? clone(record) : null,
      status: !record?.installed ? 'available' : !validInstall ? 'invalid' : compareVersions(pack.version, record.version) > 0 || pack.sha256 !== record.sha256 ? 'update_available' : 'installed'
    };
  });
}

module.exports = {
  CATALOG_SCHEMA_VERSION,
  CATALOG_MAX_BYTES,
  PACK_MAX_BYTES,
  CHARACTER_IMPORT_MAX_BYTES,
  CHARACTER_IMPORT_MAX_DEPTH,
  CHARACTER_IMPORT_MAX_NODES,
  CATALOG_REPOSITORY,
  CATALOG_REF,
  CATALOG_PATH,
  TRUSTED_CATALOG_ACTORS,
  ALLOWED_DOWNLOAD_HOSTS,
  BUILTIN_CATALOG,
  clean,
  sha256,
  normalizePack,
  normalizeCatalog,
  mergeCatalogs,
  verifyGithubCatalogCommit,
  inspectJsonShape,
  normalizeCharacterImport,
  parseCharacterImportBuffer,
  normalizeHomebrewSource,
  verifyPackBuffer,
  compareVersions,
  catalogView
};
