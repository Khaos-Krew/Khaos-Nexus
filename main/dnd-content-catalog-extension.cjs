'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  CATALOG_MAX_BYTES,
  PACK_MAX_BYTES,
  CHARACTER_IMPORT_MAX_BYTES,
  CATALOG_REPOSITORY,
  CATALOG_REF,
  CATALOG_PATH,
  BUILTIN_CATALOG,
  clean,
  normalizeCatalog,
  normalizePack,
  mergeCatalogs,
  verifyGithubCatalogCommit,
  parseCharacterImportBuffer,
  normalizeHomebrewSource,
  verifyPackBuffer,
  catalogView
} = require('../shared/dnd-content-catalog.cjs');

const refs = { configStore: null, supervisor: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) {
    const error = new Error(`${action} requires Khaos Nexus Owner access.`);
    error.code = 'OWNER_ACCESS_REQUIRED';
    throw error;
  }
  return true;
}
function ensureCollections(state) {
  if (!Array.isArray(state.contentPacks)) state.contentPacks = [];
  if (!state.catalogState || typeof state.catalogState !== 'object' || Array.isArray(state.catalogState)) state.catalogState = {};
  return state;
}
function contentRoot(store = refs.configStore) {
  return path.join(path.dirname(store.configPath), 'dnd-content');
}
function cachePath(store = refs.configStore) { return path.join(contentRoot(store), 'catalog-cache.json'); }
function safeInside(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    const error = new Error('Content path escaped the protected D&D storage directory.');
    error.code = 'DND_CONTENT_PATH_INVALID';
    throw error;
  }
  return resolved;
}
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}
function readCache() {
  try {
    const stat = fs.statSync(cachePath());
    if (!stat.isFile() || stat.size > CATALOG_MAX_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    return { catalog: normalizeCatalog(parsed.catalog, 'cache'), trust: parsed.trust || null, refreshedAt: parsed.refreshedAt || '' };
  } catch { return null; }
}

function requestBuffer(urlValue, options = {}, redirects = 4) {
  const maxBytes = Number(options.maxBytes || CATALOG_MAX_BYTES);
  const expectedHost = options.expectedHost || '';
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlValue); }
    catch { reject(Object.assign(new Error('Download URL is invalid.'), { code: 'DND_DOWNLOAD_URL_INVALID' })); return; }
    if (url.protocol !== 'https:' || url.username || url.password) {
      reject(Object.assign(new Error('Downloads require HTTPS without embedded credentials.'), { code: 'DND_DOWNLOAD_URL_INVALID' }));
      return;
    }
    if (expectedHost && url.hostname.toLowerCase() !== expectedHost.toLowerCase()) {
      reject(Object.assign(new Error('Download redirected to an unapproved host.'), { code: 'DND_DOWNLOAD_HOST_UNTRUSTED' }));
      return;
    }
    const request = https.get(url, {
      headers: {
        'user-agent': 'Khaos-Nexus-DnD-Catalog/1.0',
        accept: options.accept || '*/*'
      }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        requestBuffer(next, { ...options, expectedHost: expectedHost || new URL(next).hostname }, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(Object.assign(new Error(`Download failed with HTTP ${response.statusCode}.`), { code: 'DND_DOWNLOAD_HTTP_ERROR' }));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared && declared > maxBytes) {
        response.destroy();
        reject(Object.assign(new Error('Download is larger than the permitted limit.'), { code: 'DND_DOWNLOAD_TOO_LARGE' }));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(Object.assign(new Error('Download exceeded the permitted limit.'), { code: 'DND_DOWNLOAD_TOO_LARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(Number(options.timeoutMs || 30000), () => request.destroy(Object.assign(new Error('Download timed out.'), { code: 'DND_DOWNLOAD_TIMEOUT' })));
    request.on('error', reject);
  });
}

async function fetchRemoteCatalog() {
  const repositoryUrl = `https://api.github.com/repos/${CATALOG_REPOSITORY}/commits/${encodeURIComponent(CATALOG_REF)}`;
  const commitBuffer = await requestBuffer(repositoryUrl, { maxBytes: CATALOG_MAX_BYTES, expectedHost: 'api.github.com', accept: 'application/vnd.github+json' });
  const commit = JSON.parse(commitBuffer.toString('utf8'));
  const actor = commit.author?.login || commit.committer?.login || '';
  const trust = verifyGithubCatalogCommit({ repository: CATALOG_REPOSITORY, ref: CATALOG_REF, path: CATALOG_PATH, actor, sha: commit.sha });
  const rawUrl = `https://raw.githubusercontent.com/${CATALOG_REPOSITORY}/${trust.sha}/${CATALOG_PATH}`;
  const catalogBuffer = await requestBuffer(rawUrl, { maxBytes: CATALOG_MAX_BYTES, expectedHost: 'raw.githubusercontent.com', accept: 'application/json' });
  const catalog = normalizeCatalog(JSON.parse(catalogBuffer.toString('utf8')), 'remote');
  const cached = { catalog, trust, refreshedAt: nowIso() };
  writeJsonAtomic(cachePath(), cached);
  return cached;
}

function currentCatalog() {
  const cache = readCache();
  return { merged: mergeCatalogs(BUILTIN_CATALOG, cache?.catalog), cache };
}
function publicPayload() {
  const state = refs.configStore.getDndState();
  ensureCollections(state);
  const { merged, cache } = currentCatalog();
  return {
    role: currentRole(),
    catalog: {
      ...merged,
      packs: catalogView(merged, state.contentPacks),
      remote: cache ? { available: true, refreshedAt: cache.refreshedAt, trust: cache.trust } : { available: false, refreshedAt: '', trust: null },
      policy: {
        automaticDownloads: false,
        automaticInstalls: false,
        trust: 'Pinned Khaos Nexus GitHub repository/ref/path plus trusted repository actor; every asset requires exact size, type, and SHA-256 verification.'
      }
    }
  };
}
function pushConfig() {
  refs.supervisor?.pushDndConfig?.();
  const value = refs.configStore ? publicPayload() : null;
  if (!value) return;
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dnd:catalog-update', value);
}
function audit(action, value = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action,
    outcome: 'success',
    actorId: actorId(),
    campaignId: value.campaignId,
    targetId: value.id || value.packId,
    metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { targetId: entry.targetId }, 'dnd');
  return entry;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndContentCatalogPatched) return;
  class DndContentCatalogConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { ensureCollections(state); return true; });
      scheduleRegister();
    }

    upsertDndCharacter(input) {
      const value = super.upsertDndCharacter(input);
      if (!input?.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) return value;
      return this.mutateDnd((state) => {
        ensureCollections(state);
        const character = state.characters.find((item) => item.id === value.id);
        if (!character) return value;
        character.metadata = clone(input.metadata);
        return clone(character);
      });
    }

    saveContentPack(pack, relativePath) {
      return this.mutateDnd((state) => {
        ensureCollections(state);
        const existing = state.contentPacks.find((item) => item.packId === pack.id) || null;
        const record = {
          id: existing?.id || `content_pack_${pack.id}`,
          packId: pack.id,
          version: pack.version,
          sha256: pack.sha256,
          bytes: pack.bytes,
          fileName: pack.fileName,
          relativePath,
          installed: true,
          installedAt: nowIso(),
          removedAt: '',
          updatedAt: nowIso()
        };
        const index = state.contentPacks.findIndex((item) => item.packId === pack.id);
        if (index >= 0) state.contentPacks[index] = record; else state.contentPacks.push(record);
        return clone(record);
      });
    }

    removeContentPack(packId) {
      return this.mutateDnd((state) => {
        ensureCollections(state);
        const record = state.contentPacks.find((item) => item.packId === packId);
        if (!record) return null;
        record.installed = false;
        record.removedAt = nowIso();
        record.updatedAt = nowIso();
        return clone(record);
      });
    }
  }
  Object.defineProperty(DndContentCatalogConfigStore, '__khaosDndContentCatalogPatched', { value: true });
  target.ConfigStore = DndContentCatalogConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndContentCatalogCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndContentCatalogCapture', { value: true });
  target[exportName] = Captured;
}

function sourceForPack(pack, installed) {
  return {
    id: `catalog_${pack.id}`,
    name: pack.name,
    ruleset: pack.ruleset,
    sourceVersion: pack.version,
    licenseType: 'srd_cc_by',
    licenseReference: `${pack.licenseName} (${pack.licenseId})`,
    attributionText: pack.attributionText,
    externalReferenceUrl: pack.licenseUrl,
    isFullTextAllowed: Boolean(pack.fullTextAllowed),
    active: installed,
    metadata: {
      kind: 'catalog_pack', packId: pack.id, publisher: pack.publisher, language: pack.language,
      contentOrigin: pack.contentOrigin, installed, sha256: pack.sha256, fileName: pack.fileName
    }
  };
}

async function installPack(packId) {
  const { merged } = currentCatalog();
  const pack = merged.packs.find((item) => item.id === packId && item.active);
  if (!pack) throw Object.assign(new Error('Content pack is not available in the trusted catalog.'), { code: 'DND_PACK_NOT_FOUND' });
  const normalized = normalizePack(pack);
  const host = new URL(normalized.downloadUrl).hostname;
  const buffer = await requestBuffer(normalized.downloadUrl, { maxBytes: Math.min(PACK_MAX_BYTES, normalized.bytes), expectedHost: host, timeoutMs: 120000 });
  verifyPackBuffer(normalized, buffer);
  const relativePath = path.join('packs', normalized.id, normalized.version, normalized.fileName);
  const destination = safeInside(contentRoot(), path.join(contentRoot(), relativePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, buffer);
  fs.renameSync(temporary, destination);
  const record = refs.configStore.saveContentPack(normalized, relativePath);
  refs.configStore.upsertDndSource(sourceForPack(normalized, true));
  audit('content-pack.installed', record, { version: normalized.version, sha256: normalized.sha256, bytes: normalized.bytes });
  pushConfig();
  return { record, state: publicPayload() };
}

function removePack(packId) {
  const state = refs.configStore.getDndState();
  ensureCollections(state);
  const record = state.contentPacks.find((item) => item.packId === packId) || null;
  if (!record) throw Object.assign(new Error('Installed content pack was not found.'), { code: 'DND_PACK_NOT_INSTALLED' });
  const packDirectory = safeInside(contentRoot(), path.join(contentRoot(), 'packs', packId));
  fs.rmSync(packDirectory, { recursive: true, force: true });
  const removed = refs.configStore.removeContentPack(packId);
  const source = refs.configStore.getDndState().sources.find((item) => item.metadata?.packId === packId);
  if (source) refs.configStore.upsertDndSource({ ...source, active: false, metadata: { ...source.metadata, installed: false } });
  audit('content-pack.removed', removed, { preservedCampaignSelections: true });
  pushConfig();
  return { record: removed, state: publicPayload() };
}

function openInstalled(packId) {
  const state = refs.configStore.getDndState();
  ensureCollections(state);
  const record = state.contentPacks.find((item) => item.packId === packId && item.installed);
  if (!record) throw Object.assign(new Error('Content pack is not installed.'), { code: 'DND_PACK_NOT_INSTALLED' });
  const filePath = safeInside(contentRoot(), path.join(contentRoot(), record.relativePath));
  if (!fs.existsSync(filePath)) throw Object.assign(new Error('Installed content file is missing.'), { code: 'DND_PACK_FILE_MISSING' });
  return electron.shell.openPath(filePath);
}

async function pickCharacterImport(event, input = {}) {
  const campaignId = clean(input.campaignId, 100);
  if (!campaignId) throw Object.assign(new Error('Select a campaign before importing a character.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showOpenDialog(window, {
    title: 'Import D&D character',
    properties: ['openFile'],
    filters: [{ name: 'Character JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  if (path.extname(filePath).toLowerCase() !== '.json') throw Object.assign(new Error('Character imports must be JSON files.'), { code: 'DND_CHARACTER_IMPORT_TYPE' });
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > CHARACTER_IMPORT_MAX_BYTES) throw Object.assign(new Error('Character import file is invalid or too large.'), { code: 'DND_CHARACTER_IMPORT_SIZE' });
  const buffer = fs.readFileSync(filePath);
  const draft = parseCharacterImportBuffer(buffer, { campaignId, sourceFileName: path.basename(filePath), importedAt: nowIso() });
  const collisions = refs.configStore.getDndState().characters.filter((item) => item.campaignId === campaignId && item.name.toLowerCase() === draft.name.toLowerCase()).map((item) => ({ id: item.id, name: item.name }));
  audit('character.import-reviewed', { campaignId, id: '' }, { sourceFileName: path.basename(filePath), sourceFormat: draft.metadata.import.format, sourceSha256: draft.metadata.import.sourceSha256, collisions: collisions.length });
  return { canceled: false, draft, collisions, review: { sourceFileName: path.basename(filePath), bytes: stat.size, format: draft.metadata.import.format, sha256: draft.metadata.import.sourceSha256 } };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:catalog-get', () => { assertOwner('View the D&D content catalog'); return publicPayload(); });
  ipc.handle('dnd:catalog-refresh', async () => {
    assertOwner('Refresh the D&D content catalog');
    const result = await fetchRemoteCatalog();
    refs.configStore.mutateDnd((state) => { ensureCollections(state); state.catalogState = { refreshedAt: result.refreshedAt, commitSha: result.trust.sha, actor: result.trust.actor }; return true; });
    audit('content-catalog.refreshed', { id: result.trust.sha }, { actor: result.trust.actor, catalogVersion: result.catalog.catalogVersion });
    pushConfig();
    return publicPayload();
  });
  ipc.handle('dnd:catalog-install', async (_event, input = {}) => { assertOwner('Install D&D content'); return installPack(clean(input.packId, 100)); });
  ipc.handle('dnd:catalog-remove', (_event, input = {}) => { assertOwner('Remove D&D content'); return removePack(clean(input.packId, 100)); });
  ipc.handle('dnd:catalog-open', (_event, input = {}) => { assertOwner('Open installed D&D content'); return openInstalled(clean(input.packId, 100)); });
  ipc.handle('dnd:catalog-open-license', (_event, input = {}) => {
    assertOwner('Open a D&D content license');
    const { merged } = currentCatalog();
    const pack = merged.packs.find((item) => item.id === clean(input.packId, 100));
    if (!pack) throw Object.assign(new Error('Content pack was not found.'), { code: 'DND_PACK_NOT_FOUND' });
    return electron.shell.openExternal(pack.licenseUrl);
  });
  ipc.handle('dnd:homebrew-source-save', (_event, input = {}) => {
    assertOwner('Create a Homebrew source');
    const source = refs.configStore.upsertDndSource(normalizeHomebrewSource(input));
    audit('homebrew-source.saved', source, { visibility: source.metadata?.visibility, author: source.metadata?.author });
    refs.supervisor?.pushDndConfig?.();
    return { source, dnd: refs.configStore.getDndState(), catalog: publicPayload() };
  });
  ipc.handle('dnd:character-import-pick', (event, input = {}) => { assertOwner('Import a D&D character'); return pickCharacterImport(event, input); });
  return true;
}

function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-content-catalog',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-content-catalog.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-content-catalog.js')],
    source: 'dnd-content-catalog-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAssets();
  scheduleRegister();
}

module.exports = {
  install,
  ensureCollections,
  requestBuffer,
  fetchRemoteCatalog,
  currentCatalog,
  safeInside,
  sourceForPack
};
