'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  MAP_MAX_BYTES,
  ensureMapCollections,
  normalizeMap,
  saveMap,
  saveMarker,
  removeMarker,
  generateMapSvg,
  inspectUploadedImage,
  safeName
} = require('../shared/dnd-live-maps.cjs');

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
  if (!['owner', 'local-admin'].includes(currentRole())) throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  return true;
}
function mapRoot(store = refs.configStore) { return path.join(path.dirname(store.configPath), 'dnd-maps'); }
function safeInside(root, candidate) {
  const base = path.resolve(root); const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw Object.assign(new Error('Map path escaped protected storage.'), { code: 'DND_MAP_PATH_INVALID' });
  return resolved;
}
function writeAtomic(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, buffer);
  fs.renameSync(temporary, filePath);
}
function payload() {
  const state = refs.configStore.getDndState();
  ensureMapCollections(state);
  return {
    role: currentRole(),
    maps: clone(state.maps),
    markers: clone(state.mapMarkers),
    links: {
      characters: clone(state.characters || []), npcs: clone(state.npcs || []), locations: clone(state.locations || []),
      encounters: clone(state.encounters || []), quests: clone(state.quests || []), loot: clone(state.loot || [])
    },
    policy: { remotePlayerVtt: false, externalGeneration: false, uploadTypes: ['PNG', 'JPEG', 'WebP'], maxUploadBytes: MAP_MAX_BYTES }
  };
}
function push() {
  refs.supervisor?.pushDndConfig?.();
  const value = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dnd:map-update', value);
}
function audit(action, value = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({ action, outcome: 'success', actorId: actorId(), campaignId: value.campaignId, targetId: value.id, metadata });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId }, 'dnd');
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndLiveMapsPatched) return;
  class DndLiveMapsConfigStore extends Original {
    constructor(...args) { super(...args); refs.configStore = this; this.mutateDnd((state) => { ensureMapCollections(state); return true; }); scheduleRegister(); }
    saveDndMap(input) { return this.mutateDnd((state) => saveMap(state, input)); }
    saveDndMapMarker(input) { return this.mutateDnd((state) => saveMarker(state, input)); }
    removeDndMapMarker(markerId) { return this.mutateDnd((state) => removeMarker(state, markerId)); }
    archiveDndMap(mapId) {
      return this.mutateDnd((state) => {
        ensureMapCollections(state);
        const map = state.maps.find((item) => item.id === mapId);
        if (!map) throw Object.assign(new Error('Map was not found.'), { code: 'DND_MAP_NOT_FOUND' });
        map.archived = true; map.active = false; map.updatedBy = actorId(); map.updatedAt = nowIso();
        return clone(map);
      });
    }
  }
  Object.defineProperty(DndLiveMapsConfigStore, '__khaosDndLiveMapsPatched', { value: true });
  target.ConfigStore = DndLiveMapsConfigStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath); const Original = target[exportName];
  if (!Original || Original.__khaosDndLiveMapsCapture) return;
  class Captured extends Original { constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); } }
  Object.defineProperty(Captured, '__khaosDndLiveMapsCapture', { value: true }); target[exportName] = Captured;
}

async function uploadMap(event, input = {}) {
  const campaignId = String(input.campaignId || '').trim();
  if (!campaignId) throw Object.assign(new Error('Select a campaign before uploading a map.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showOpenDialog(window, { title: 'Upload campaign map', properties: ['openFile'], filters: [{ name: 'Map images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const sourcePath = result.filePaths[0];
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAP_MAX_BYTES) throw Object.assign(new Error('Map image is invalid or exceeds 10 MB.'), { code: 'DND_MAP_UPLOAD_SIZE' });
  const buffer = fs.readFileSync(sourcePath);
  const inspected = inspectUploadedImage(buffer);
  const extension = inspected.mimeType === 'image/png' ? 'png' : inspected.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
  const draft = normalizeMap({
    campaignId, name: input.name || path.basename(sourcePath, path.extname(sourcePath)), sourceType: 'uploaded',
    mimeType: inspected.mimeType, bytes: inspected.bytes, sha256: inspected.sha256, width: inspected.width, height: inspected.height,
    gridType: input.gridType || 'none', gridSize: input.gridSize || 64, scaleLabel: input.scaleLabel || '',
    active: input.active !== false, revealed: Boolean(input.revealed), createdBy: actorId(), updatedBy: actorId()
  });
  const relativePath = path.join(draft.campaignId, draft.id, `${safeName(draft.name)}.${extension}`);
  const destination = safeInside(mapRoot(), path.join(mapRoot(), relativePath));
  writeAtomic(destination, buffer);
  const map = refs.configStore.saveDndMap({ ...draft, fileName: path.basename(destination), relativePath });
  audit('map.uploaded', map, { bytes: map.bytes, sha256: map.sha256, mimeType: map.mimeType });
  push();
  return { canceled: false, map, state: payload() };
}

function generateMap(input = {}) {
  const campaignId = String(input.campaignId || '').trim();
  if (!campaignId) throw Object.assign(new Error('Select a campaign before generating a map.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  const generated = generateMapSvg(input);
  const draft = normalizeMap({
    campaignId, name: input.name || `${generated.mode.replace('_', ' ')} map`, sourceType: 'generated',
    mimeType: generated.mimeType, bytes: generated.bytes, sha256: generated.sha256, width: generated.width, height: generated.height,
    gridType: generated.gridType, gridSize: generated.gridSize, seed: generated.seed, generationMode: generated.mode, theme: generated.theme,
    scaleLabel: input.scaleLabel || '', active: input.active !== false, revealed: Boolean(input.revealed), createdBy: actorId(), updatedBy: actorId()
  });
  const relativePath = path.join(draft.campaignId, draft.id, `${safeName(draft.name)}.svg`);
  writeAtomic(safeInside(mapRoot(), path.join(mapRoot(), relativePath)), generated.buffer);
  const map = refs.configStore.saveDndMap({ ...draft, relativePath });
  audit('map.generated', map, { seed: map.seed, mode: map.generationMode, sha256: map.sha256 });
  push();
  return { map, state: payload() };
}

function assetData(mapId) {
  const state = refs.configStore.getDndState(); ensureMapCollections(state);
  const map = state.maps.find((item) => item.id === mapId && !item.archived);
  if (!map) throw Object.assign(new Error('Map was not found.'), { code: 'DND_MAP_NOT_FOUND' });
  const filePath = safeInside(mapRoot(), path.join(mapRoot(), map.relativePath));
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAP_MAX_BYTES) throw Object.assign(new Error('Map asset is missing or invalid.'), { code: 'DND_MAP_ASSET_INVALID' });
  const buffer = fs.readFileSync(filePath);
  return { id: map.id, mimeType: map.mimeType, width: map.width, height: map.height, dataUrl: `data:${map.mimeType};base64,${buffer.toString('base64')}` };
}

async function exportSnapshot(event, input = {}) {
  const prefix = 'data:image/png;base64,';
  const value = String(input.dataUrl || '');
  if (!value.startsWith(prefix)) throw Object.assign(new Error('Map snapshot must be a PNG data URL.'), { code: 'DND_MAP_EXPORT_INVALID' });
  const buffer = Buffer.from(value.slice(prefix.length), 'base64');
  if (!buffer.length || buffer.length > 15 * 1024 * 1024 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Object.assign(new Error('Map snapshot is invalid or too large.'), { code: 'DND_MAP_EXPORT_INVALID' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showSaveDialog(window, { title: 'Export campaign map snapshot', defaultPath: `${safeName(input.name || 'campaign-map')}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, buffer);
  audit('map.snapshot-exported', { id: String(input.mapId || ''), campaignId: String(input.campaignId || '') }, { bytes: buffer.length });
  return { canceled: false, fileName: path.basename(result.filePath), bytes: buffer.length };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true; const ipc = electron.ipcMain;
  ipc.handle('dnd:maps-get', () => { assertOwner('View campaign maps'); return payload(); });
  ipc.handle('dnd:map-upload', (event, input = {}) => { assertOwner('Upload a campaign map'); return uploadMap(event, input); });
  ipc.handle('dnd:map-generate', (_event, input = {}) => { assertOwner('Generate a campaign map'); return generateMap(input); });
  ipc.handle('dnd:map-save', (_event, input = {}) => {
    assertOwner('Edit a campaign map');
    const state = refs.configStore.getDndState(); ensureMapCollections(state);
    const existing = state.maps.find((item) => item.id === input.id);
    if (!existing) throw Object.assign(new Error('Map was not found.'), { code: 'DND_MAP_NOT_FOUND' });
    const map = refs.configStore.saveDndMap({ ...existing, ...input, updatedBy: actorId() });
    audit('map.saved', map, { active: map.active, revealed: map.revealed, gridType: map.gridType }); push(); return { map, state: payload() };
  });
  ipc.handle('dnd:map-archive', (_event, input = {}) => { assertOwner('Archive a campaign map'); const map = refs.configStore.archiveDndMap(String(input.mapId || '')); audit('map.archived', map); push(); return { map, state: payload() }; });
  ipc.handle('dnd:map-asset', (_event, input = {}) => { assertOwner('View a campaign map asset'); return assetData(String(input.mapId || '')); });
  ipc.handle('dnd:map-marker-save', (_event, input = {}) => { assertOwner('Manage campaign map markers'); const marker = refs.configStore.saveDndMapMarker(input); audit('map-marker.saved', marker, { markerType: marker.markerType, linkedId: marker.linkedId, visible: marker.visible }); push(); return { marker, state: payload() }; });
  ipc.handle('dnd:map-marker-remove', (_event, input = {}) => { assertOwner('Remove a campaign map marker'); const marker = refs.configStore.removeDndMapMarker(String(input.markerId || '')); audit('map-marker.removed', marker); push(); return { marker, state: payload() }; });
  ipc.handle('dnd:map-export', (event, input = {}) => { assertOwner('Export a campaign map snapshot'); return exportSnapshot(event, input); });
  return true;
}
function scheduleRegister() { clearTimeout(timer); timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100); timer.unref?.(); }
function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-live-maps',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-live-maps.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-live-maps.js')],
    source: 'dnd-live-maps-extension.cjs'
  });
}
function install() {
  if (installed) return; installed = true; patchConfigStore();
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAssets(); scheduleRegister();
}

module.exports = { install, safeInside, writeAtomic, payload, assetData };
