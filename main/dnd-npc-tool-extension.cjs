'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  NPC_IMPORT_MAX_BYTES,
  ensureNpcToolCollections,
  saveNpc,
  duplicateNpc,
  setNpcStatus,
  saveRelationship,
  removeRelationship,
  generateNpcDraft,
  insertNpcIntoEncounter,
  syncNpcCombatant,
  parseNpcImportBuffer,
  exportNpcDocument
} = require('../shared/dnd-npc-tool.cjs');

const refs = { configStore: null, supervisor: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;
let registered = false;
let timer = null;
const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

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
function rootDirectory(store = refs.configStore) { return path.join(path.dirname(store.configPath), 'dnd-npcs'); }
function safeInside(root, candidate) {
  const base = path.resolve(root); const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw Object.assign(new Error('NPC asset path escaped protected storage.'), { code: 'DND_NPC_PATH_INVALID' });
  return resolved;
}
function safeName(value, fallback = 'npc') { return String(value || fallback).replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || fallback; }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function writeAtomic(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, buffer); fs.renameSync(temporary, filePath);
}
function imageSignature(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return { mimeType: 'image/png', extension: 'png' };
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  return null;
}
function inspectPortrait(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > PORTRAIT_MAX_BYTES) throw Object.assign(new Error('NPC portrait is empty or exceeds 5 MB.'), { code: 'DND_NPC_PORTRAIT_SIZE' });
  const signature = imageSignature(buffer);
  if (!signature) throw Object.assign(new Error('NPC portrait must be PNG, JPEG, or WebP.'), { code: 'DND_NPC_PORTRAIT_TYPE' });
  const image = electron.nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw Object.assign(new Error('NPC portrait could not be decoded safely.'), { code: 'DND_NPC_PORTRAIT_DECODE' });
  const size = image.getSize();
  if (size.width < 32 || size.height < 32 || size.width > 4096 || size.height > 4096) throw Object.assign(new Error('NPC portrait dimensions must be between 32 and 4096 pixels.'), { code: 'DND_NPC_PORTRAIT_DIMENSIONS' });
  return { ...signature, width: size.width, height: size.height, bytes: buffer.length, sha256: sha256(buffer) };
}

function payload() {
  const state = refs.configStore.getDndState(); ensureNpcToolCollections(state);
  return {
    role: currentRole(), state,
    links: {
      characters: clone(state.characters || []), factions: clone(state.factions || []), locations: clone(state.locations || []),
      quests: clone(state.quests || []), encounters: clone(state.encounters || []), combatants: clone(state.combatants || [])
    },
    policy: { localGeneration: true, externalGeneration: false, paidStatBlocks: false, portraitMaxBytes: PORTRAIT_MAX_BYTES }
  };
}
function push() {
  refs.supervisor?.pushDndConfig?.(); const value = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dnd:npc-update', value);
}
function audit(action, value = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({ action, outcome: 'success', actorId: actorId(), campaignId: value.campaignId, targetId: value.id, metadata });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId }, 'dnd');
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs'); const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndNpcToolPatched) return;
  class DndNpcToolConfigStore extends Original {
    constructor(...args) { super(...args); refs.configStore = this; this.mutateDnd((state) => { ensureNpcToolCollections(state); return true; }); scheduleRegister(); }
    upsertDndWorld(type, input) {
      if (type !== 'npc') return super.upsertDndWorld(type, input);
      return this.mutateDnd((state) => saveNpc(state, input));
    }
    saveDndNpc(input) { return this.mutateDnd((state) => saveNpc(state, input)); }
    duplicateDndNpc(npcId, name) { return this.mutateDnd((state) => duplicateNpc(state, npcId, name)); }
    setDndNpcStatus(npcId, status) { return this.mutateDnd((state) => setNpcStatus(state, npcId, status)); }
    saveDndNpcRelationship(input) { return this.mutateDnd((state) => saveRelationship(state, input)); }
    removeDndNpcRelationship(id) { return this.mutateDnd((state) => removeRelationship(state, id)); }
    insertDndNpcIntoEncounter(input) { return this.mutateDnd((state) => clone(insertNpcIntoEncounter(state, input))); }
    syncDndNpcCombatant(input) { return this.mutateDnd((state) => syncNpcCombatant(state, input)); }
  }
  Object.defineProperty(DndNpcToolConfigStore, '__khaosDndNpcToolPatched', { value: true }); target.ConfigStore = DndNpcToolConfigStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath); const Original = target[exportName];
  if (!Original || Original.__khaosDndNpcToolCapture) return;
  class Captured extends Original { constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); } }
  Object.defineProperty(Captured, '__khaosDndNpcToolCapture', { value: true }); target[exportName] = Captured;
}

async function pickPortrait(event, input = {}) {
  const campaignId = String(input.campaignId || '').trim(); const npcId = String(input.npcId || '').trim();
  if (!campaignId || !npcId) throw Object.assign(new Error('Save the NPC before adding a portrait.'), { code: 'DND_NPC_REQUIRED' });
  const npc = refs.configStore.getDndState().npcs?.find((item) => item.id === npcId && item.campaignId === campaignId);
  if (!npc) throw Object.assign(new Error('NPC was not found.'), { code: 'DND_NPC_NOT_FOUND' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showOpenDialog(window, { title: 'Choose NPC portrait or token', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const sourcePath = result.filePaths[0]; const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PORTRAIT_MAX_BYTES) throw Object.assign(new Error('NPC portrait file is invalid.'), { code: 'DND_NPC_PORTRAIT_SIZE' });
  const buffer = fs.readFileSync(sourcePath); const inspected = inspectPortrait(buffer);
  const relativePath = path.join(campaignId, npcId, `${safeName(npc.name)}.${inspected.extension}`);
  const destination = safeInside(rootDirectory(), path.join(rootDirectory(), relativePath)); writeAtomic(destination, buffer);
  const saved = refs.configStore.saveDndNpc({ ...npc, portrait: { relativePath, fileName: path.basename(destination), mimeType: inspected.mimeType, bytes: inspected.bytes, sha256: inspected.sha256, width: inspected.width, height: inspected.height } });
  audit('npc.portrait-saved', saved, { bytes: inspected.bytes, sha256: inspected.sha256, mimeType: inspected.mimeType }); push();
  return { canceled: false, npc: saved, state: payload() };
}
function portraitData(npcId) {
  const npc = refs.configStore.getDndState().npcs?.find((item) => item.id === npcId);
  if (!npc?.portrait?.relativePath) return null;
  const filePath = safeInside(rootDirectory(), path.join(rootDirectory(), npc.portrait.relativePath));
  const stat = fs.statSync(filePath); if (!stat.isFile() || stat.size > PORTRAIT_MAX_BYTES) throw Object.assign(new Error('NPC portrait is missing or invalid.'), { code: 'DND_NPC_PORTRAIT_INVALID' });
  const buffer = fs.readFileSync(filePath); if (sha256(buffer) !== npc.portrait.sha256) throw Object.assign(new Error('NPC portrait integrity check failed.'), { code: 'DND_NPC_PORTRAIT_HASH' });
  return { npcId, mimeType: npc.portrait.mimeType, dataUrl: `data:${npc.portrait.mimeType};base64,${buffer.toString('base64')}` };
}
async function pickImport(event, input = {}) {
  const campaignId = String(input.campaignId || '').trim(); if (!campaignId) throw Object.assign(new Error('Select a campaign before importing an NPC.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showOpenDialog(window, { title: 'Import NPC', properties: ['openFile'], filters: [{ name: 'NPC JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0]; const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > NPC_IMPORT_MAX_BYTES || path.extname(filePath).toLowerCase() !== '.json') throw Object.assign(new Error('NPC import must be a JSON file no larger than 1 MB.'), { code: 'DND_NPC_IMPORT_SIZE' });
  const draft = parseNpcImportBuffer(fs.readFileSync(filePath), { campaignId, sourceFileName: path.basename(filePath), importedAt: nowIso() });
  const collisions = refs.configStore.getDndState().npcs.filter((item) => item.campaignId === campaignId && item.name.toLowerCase() === draft.name.toLowerCase()).map((item) => ({ id: item.id, name: item.name }));
  audit('npc.import-reviewed', { campaignId, id: '' }, { fileName: path.basename(filePath), sha256: draft.metadata.import.sourceSha256, collisions: collisions.length });
  return { canceled: false, draft, collisions };
}
async function exportNpc(event, input = {}) {
  const npc = refs.configStore.getDndState().npcs?.find((item) => item.id === input.npcId);
  if (!npc) throw Object.assign(new Error('NPC was not found.'), { code: 'DND_NPC_NOT_FOUND' });
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showSaveDialog(window, { title: 'Export NPC', defaultPath: `${safeName(npc.name)}.json`, filters: [{ name: 'NPC JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  const document = exportNpcDocument(npc); fs.writeFileSync(result.filePath, JSON.stringify(document, null, 2), 'utf8');
  audit('npc.exported', npc, { fileName: path.basename(result.filePath) }); return { canceled: false, fileName: path.basename(result.filePath) };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true; const ipc = electron.ipcMain;
  ipc.handle('dnd:npcs-get', () => { assertOwner('View NPC tools'); return payload(); });
  ipc.handle('dnd:npc-save', (_event, input = {}) => { assertOwner('Manage NPCs'); const npc = refs.configStore.saveDndNpc(input); audit('npc.saved', npc, { mode: npc.mode, status: npc.status, revealed: npc.revealed }); push(); return { npc, state: payload() }; });
  ipc.handle('dnd:npc-generate', (_event, input = {}) => { assertOwner('Generate an NPC draft'); const draft = generateNpcDraft(input); audit('npc.generated-draft', draft, { seed: draft.metadata.generation.seed, mode: draft.mode }); return { draft }; });
  ipc.handle('dnd:npc-duplicate', (_event, input = {}) => { assertOwner('Duplicate an NPC'); const npc = refs.configStore.duplicateDndNpc(String(input.npcId || ''), String(input.name || '')); audit('npc.duplicated', npc, { sourceNpcId: input.npcId }); push(); return { npc, state: payload() }; });
  ipc.handle('dnd:npc-status', (_event, input = {}) => { assertOwner('Change NPC status'); const npc = refs.configStore.setDndNpcStatus(String(input.npcId || ''), String(input.status || '')); audit('npc.status-changed', npc, { status: npc.status }); push(); return { npc, state: payload() }; });
  ipc.handle('dnd:npc-relationship-save', (_event, input = {}) => { assertOwner('Manage NPC relationships'); const relationship = refs.configStore.saveDndNpcRelationship(input); audit('npc-relationship.saved', relationship, { targetType: relationship.targetType, targetId: relationship.targetId, revealed: relationship.revealed }); push(); return { relationship, state: payload() }; });
  ipc.handle('dnd:npc-relationship-remove', (_event, input = {}) => { assertOwner('Remove NPC relationships'); const relationship = refs.configStore.removeDndNpcRelationship(String(input.relationshipId || '')); audit('npc-relationship.removed', relationship); push(); return { relationship, state: payload() }; });
  ipc.handle('dnd:npc-portrait-pick', (event, input = {}) => { assertOwner('Add an NPC portrait'); return pickPortrait(event, input); });
  ipc.handle('dnd:npc-portrait-data', (_event, input = {}) => { assertOwner('View an NPC portrait'); return portraitData(String(input.npcId || '')); });
  ipc.handle('dnd:npc-import-pick', (event, input = {}) => { assertOwner('Import an NPC'); return pickImport(event, input); });
  ipc.handle('dnd:npc-export', (event, input = {}) => { assertOwner('Export an NPC'); return exportNpc(event, input); });
  ipc.handle('dnd:npc-encounter-add', (_event, input = {}) => { assertOwner('Add an NPC to an encounter'); const result = refs.configStore.insertDndNpcIntoEncounter(input); audit('npc.encounter-added', result.npc, { encounterId: input.encounterId, combatantId: result.combatant.id }); push(); return { result, state: payload() }; });
  ipc.handle('dnd:npc-combatant-sync', (_event, input = {}) => { assertOwner('Synchronize an NPC combatant'); const combatant = refs.configStore.syncDndNpcCombatant(input); audit('npc.combatant-synced', combatant, { npcId: input.npcId, syncHp: Boolean(input.syncHp) }); push(); return { combatant, state: payload() }; });
  return true;
}
function scheduleRegister() { clearTimeout(timer); timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100); timer.unref?.(); }
function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-npc-tool',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-npc-tool.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-npc-tool.js')],
    source: 'dnd-npc-tool-extension.cjs'
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

module.exports = { install, safeInside, inspectPortrait, portraitData, payload };
