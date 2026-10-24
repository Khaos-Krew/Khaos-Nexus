'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeFiles, countSettings } = require('./ark-config-profiles.cjs');
const { previewProfile, protectedProfileRefs } = require('./ark-config-profile-service.cjs');

const MANIFEST_VERSION = 1;
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '../../config/ark/desired-state/cluster.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key]);
  return out;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableObject(value))).digest('hex');
}

function mergeSections(base = {}, overlay = {}) {
  const next = clone(base);
  for (const [section, settings] of Object.entries(overlay || {})) {
    next[section] ||= {};
    Object.assign(next[section], clone(settings));
  }
  return next;
}

function mergeFiles(base, overlay) {
  const a = normalizeFiles(base);
  const b = normalizeFiles(overlay);
  return normalizeFiles({
    gus: { sections: mergeSections(a.gus.sections, b.gus.sections) },
    game: { sections: mergeSections(a.game.sections, b.game.sections) }
  });
}

function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('ARK desired-state manifest must be a JSON object.');
  if (Number(raw.version) !== MANIFEST_VERSION) throw new Error(`Unsupported ARK desired-state manifest version: ${raw.version}`);
  if (String(raw.authority || '').toLowerCase() !== 'github') throw new Error('ARK desired-state authority must be github.');
  if (!['preview-only', 'explicit'].includes(String(raw.applyMode || ''))) throw new Error('ARK desired-state applyMode must be preview-only or explicit.');
  if (raw.policy?.runtimeWritebackToGit !== false) throw new Error('ARK desired-state runtimeWritebackToGit must remain false.');
  if (raw.policy?.automaticLiveApply !== false) throw new Error('ARK desired-state automaticLiveApply must remain false.');
  if (raw.policy?.automaticRestart !== false) throw new Error('ARK desired-state automaticRestart must remain false.');

  const defaults = normalizeFiles(raw.defaults);
  const servers = {};
  for (const [serverId, server] of Object.entries(raw.servers || {})) {
    if (!/^[a-z0-9_-]{1,64}$/i.test(serverId)) throw new Error(`Invalid ARK desired-state server id: ${serverId}`);
    const envPrefix = String(server?.envPrefix || '').trim();
    if (!/^ARK_[A-Z0-9_]{1,48}$/.test(envPrefix)) throw new Error(`Invalid ARK desired-state envPrefix for ${serverId}.`);
    servers[serverId] = {
      envPrefix,
      map: String(server?.map || serverId).trim().slice(0, 100),
      overrides: normalizeFiles(server?.overrides)
    };
  }
  if (!Object.keys(servers).length) throw new Error('ARK desired-state manifest must define at least one server.');

  return {
    version: MANIFEST_VERSION,
    authority: 'github',
    status: String(raw.status || 'candidate'),
    applyMode: String(raw.applyMode),
    liveVerified: raw.liveVerified === true,
    description: String(raw.description || ''),
    source: clone(raw.source),
    policy: clone(raw.policy),
    defaults,
    servers
  };
}

function loadDesiredState(file = DEFAULT_MANIFEST_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const manifest = validateManifest(raw);
  return { ...manifest, file, digest: digest(manifest) };
}

function resolveDesiredProfile(manifest, serverId) {
  const server = manifest?.servers?.[String(serverId || '')];
  if (!server) throw new Error(`Unknown ARK desired-state server: ${serverId}`);
  const files = mergeFiles(manifest.defaults, server.overrides);
  return {
    id: `repo-${serverId}`,
    name: `Git desired state: ${server.map}`,
    description: manifest.description,
    revision: 1,
    source: 'github',
    sourceDigest: manifest.digest || digest(manifest),
    serverId: String(serverId),
    envPrefix: server.envPrefix,
    files,
    settings: countSettings(files),
    protectedRefs: protectedProfileRefs(files)
  };
}

async function auditServerDesiredState({ serverId, server = null, manifest = loadDesiredState(), reader } = {}) {
  const profile = resolveDesiredProfile(manifest, serverId);
  const target = server || { id: serverId, envPrefix: profile.envPrefix };
  if (String(target.envPrefix || '') !== profile.envPrefix) throw new Error(`Desired-state envPrefix mismatch for ${serverId}.`);
  const preview = await previewProfile({ server: target, profile, reader });
  return {
    authority: manifest.authority,
    applyMode: manifest.applyMode,
    liveVerified: manifest.liveVerified,
    manifestDigest: manifest.digest || digest(manifest),
    serverId: String(serverId),
    map: manifest.servers[serverId].map,
    settings: preview.settings,
    protectedSettings: preview.protectedSettings,
    changedFiles: preview.changedFiles,
    restartRequiredIfApplied: preview.restartRequired,
    files: preview.files,
    drifted: preview.changedFiles > 0,
    writePerformed: false
  };
}

module.exports = {
  MANIFEST_VERSION,
  DEFAULT_MANIFEST_PATH,
  stableObject,
  digest,
  mergeSections,
  mergeFiles,
  validateManifest,
  loadDesiredState,
  resolveDesiredProfile,
  auditServerDesiredState
};
