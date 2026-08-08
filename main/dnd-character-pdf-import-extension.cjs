'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  CHARACTER_IMPORT_MAX_BYTES,
  clean,
  parseCharacterImportBuffer
} = require('../shared/dnd-content-catalog.cjs');
const {
  CHARACTER_PDF_MAX_BYTES,
  parsePdfCharacterImportBuffer
} = require('../shared/dnd-character-pdf-import.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, logger: null };
let installed = false;

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

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndPdfImportCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosDndPdfImportCapture', { value: true });
  target[exportName] = Captured;
}

function audit(action, value = {}, metadata = {}) {
  const entry = refs.configStore?.appendDndAudit?.({
    action,
    outcome: 'success',
    actorId: actorId(),
    campaignId: value.campaignId,
    targetId: value.id || '',
    metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { targetId: entry?.targetId || '' }, 'dnd');
  return entry;
}

function validateImportFile(filePath, extension) {
  const stat = fs.lstatSync(filePath);
  const maxBytes = extension === '.pdf' ? CHARACTER_PDF_MAX_BYTES : CHARACTER_IMPORT_MAX_BYTES;
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > maxBytes) {
    const error = new Error(`Character ${extension === '.pdf' ? 'PDF' : 'JSON'} is invalid or too large.`);
    error.code = 'DND_CHARACTER_IMPORT_SIZE';
    throw error;
  }
  return stat;
}

async function pickCharacterImport(event, input = {}) {
  const campaignId = clean(input.campaignId, 100);
  if (!campaignId) {
    const error = new Error('Select a campaign before importing a character.');
    error.code = 'DND_CAMPAIGN_REQUIRED';
    throw error;
  }
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const result = await electron.dialog.showOpenDialog(window, {
    title: 'Import D&D character',
    properties: ['openFile'],
    filters: [
      { name: 'D&D Character', extensions: ['pdf', 'json'] },
      { name: 'D&D Beyond / Fillable PDF', extensions: ['pdf'] },
      { name: 'Khaos Nexus JSON', extensions: ['json'] }
    ]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).toLowerCase();
  if (!['.pdf', '.json'].includes(extension)) {
    const error = new Error('Character imports must be PDF or JSON files.');
    error.code = 'DND_CHARACTER_IMPORT_TYPE';
    throw error;
  }
  const stat = validateImportFile(filePath, extension);
  const buffer = fs.readFileSync(filePath);
  const context = { campaignId, sourceFileName: path.basename(filePath), importedAt: nowIso() };
  const draft = extension === '.pdf'
    ? await parsePdfCharacterImportBuffer(buffer, context)
    : parseCharacterImportBuffer(buffer, context);
  const characters = refs.configStore?.getDndState?.().characters || [];
  const collisions = characters
    .filter((item) => item.campaignId === campaignId && String(item.name || '').toLowerCase() === draft.name.toLowerCase())
    .map((item) => ({ id: item.id, name: item.name }));
  audit('character.import-reviewed', { campaignId, id: '' }, {
    sourceFileName: path.basename(filePath),
    sourceFormat: draft.metadata?.import?.format,
    sourceSha256: draft.metadata?.import?.sourceSha256,
    collisions: collisions.length
  });
  return {
    canceled: false,
    draft,
    collisions,
    review: {
      sourceFileName: path.basename(filePath),
      bytes: stat.size,
      format: draft.metadata?.import?.format || (extension === '.pdf' ? 'dnd-character-pdf-form-v1' : 'generic-json-v1'),
      sha256: draft.metadata?.import?.sourceSha256 || ''
    }
  };
}

function interceptCharacterImportHandler() {
  const ipc = electron.ipcMain;
  const originalHandle = ipc.handle;
  if (originalHandle.__khaosDndPdfImportIntercepted) return;
  function interceptedHandle(channel, listener) {
    if (channel !== 'dnd:character-import-pick') return originalHandle.call(ipc, channel, listener);
    ipc.handle = originalHandle;
    return originalHandle.call(ipc, channel, async (event, input = {}) => {
      assertOwner('Import a D&D character');
      return pickCharacterImport(event, input);
    });
  }
  Object.defineProperty(interceptedHandle, '__khaosDndPdfImportIntercepted', { value: true });
  ipc.handle = interceptedHandle;
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/config-store.cjs', 'ConfigStore', 'configStore');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  interceptCharacterImportHandler();
}

module.exports = { install, pickCharacterImport, validateImportFile };
