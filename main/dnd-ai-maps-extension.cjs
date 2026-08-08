'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  AI_MAP_PATH,
  ensureMapProposalState,
  normalizeMapRequest,
  previewMapRequest,
  normalizeProposal,
  parseMapResponse,
  proposalFromGeneration,
  proposalToMapImport,
  proposalAuditMetadata
} = require('../shared/dnd-ai-maps.cjs');
const {
  ensureMapCollections,
  normalizeMap,
  saveMap,
  safeName
} = require('../shared/dnd-live-maps.cjs');
const {
  serviceUrl,
  sanitizeServiceError
} = require('../shared/dnd-ai-service.cjs');

const REQUEST_TIMEOUT_MS = 90000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;
const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
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
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw Object.assign(new Error('Map path escaped protected storage.'), { code: 'DND_MAP_PATH_INVALID' });
  return resolved;
}
function writeNewAtomic(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) throw Object.assign(new Error('A map asset already exists at the generated destination.'), { code: 'DND_AI_MAP_ASSET_EXISTS' });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, buffer, { flag: 'wx' });
  try { fs.renameSync(temporary, filePath); }
  catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiMapsPatched) return;

  class DndAiMapsConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { ensureMapProposalState(state); ensureMapCollections(state); return true; });
      scheduleRegister();
    }

    saveDndAiMapProposal(input = {}) {
      return this.mutateDnd((state) => {
        ensureMapProposalState(state);
        const proposal = normalizeProposal(input);
        const index = state.aiMapProposals.findIndex((item) => item.id === proposal.id);
        if (index >= 0) state.aiMapProposals[index] = proposal;
        else state.aiMapProposals.push(proposal);
        state.aiMapProposals = state.aiMapProposals.slice(-50);
        return clone(proposal);
      });
    }

    removeDndAiMapProposal(proposalId) {
      return this.mutateDnd((state) => {
        ensureMapProposalState(state);
        const index = state.aiMapProposals.findIndex((item) => item.id === proposalId);
        if (index < 0) return false;
        state.aiMapProposals.splice(index, 1);
        return true;
      });
    }

    completeDndAiMapImport(proposalId, mapInput = {}) {
      return this.mutateDnd((state) => {
        ensureMapProposalState(state);
        ensureMapCollections(state);
        const index = state.aiMapProposals.findIndex((item) => item.id === proposalId);
        if (index < 0) throw Object.assign(new Error('AI map proposal was not found or was already imported.'), { code: 'DND_AI_MAP_PROPOSAL_NOT_FOUND' });
        const map = saveMap(state, mapInput);
        state.aiMapProposals.splice(index, 1);
        return { map: clone(map), proposalRemoved: true };
      });
    }
  }

  Object.defineProperty(DndAiMapsConfigStore, '__khaosDndAiMapsPatched', { value: true });
  target.ConfigStore = DndAiMapsConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndAiMapsCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndAiMapsCapture', { value: true });
  target[exportName] = Captured;
}

function responseError(payload, status) {
  const value = payload?.error;
  const error = new Error(typeof value === 'string' ? value : value?.message || `Khaos Nexus AI returned HTTP ${status}.`);
  error.code = typeof value === 'object' ? value.code : 'DND_AI_SERVICE_HTTP_ERROR';
  error.status = status;
  return error;
}

async function callAiService(endpoint, pathname, { body, token = '', fetchImpl = global.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in this build.'), { code: 'DND_AI_NETWORK_UNAVAILABLE' });
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': 'Khaos-Nexus-Desktop-DnD/1',
    'x-khaos-request-id': crypto.randomUUID()
  };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(serviceUrl(endpoint, pathname), {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw sanitizeServiceError(error, token);
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Khaos Nexus AI returned an oversized map response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE', status: response.status });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Khaos Nexus AI returned an oversized map response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE', status: response.status });
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('Khaos Nexus AI returned invalid JSON.'), { code: 'DND_AI_INVALID_JSON', status: response.status }); }
  if (!response.ok) throw sanitizeServiceError(responseError(payload, response.status), token);
  return payload;
}

function proposalSummary(proposal = {}) {
  return {
    id: proposal.id,
    campaignId: proposal.campaignId,
    title: proposal.result?.title || '',
    summary: proposal.result?.summary || '',
    mapType: proposal.result?.mapType || '',
    seed: proposal.result?.seed || '',
    grid: clone(proposal.result?.grid || {}),
    originality: clone(proposal.result?.originality || { status: 'original', concerns: [] }),
    zones: proposal.result?.zones?.length || 0,
    visiblePoints: proposal.result?.pointsOfInterest?.filter((item) => !item.secret).length || 0,
    secretPoints: proposal.result?.pointsOfInterest?.filter((item) => item.secret).length || 0,
    encounters: proposal.result?.encounters?.length || 0,
    hazards: proposal.result?.hazards?.length || 0,
    provider: proposal.provider || '',
    model: proposal.model || '',
    generatedAt: proposal.generatedAt || '',
    createdAt: proposal.createdAt || ''
  };
}

function payload(campaignId = '') {
  const state = refs.configStore.getDndState();
  ensureMapProposalState(state);
  const settings = refs.configStore.getDndCoDmSettings?.() || {};
  const selected = String(campaignId || '').trim() || state.campaigns?.find((item) => item.active !== false)?.id || '';
  return {
    role: currentRole(),
    service: {
      endpoint: settings.serviceEndpoint || 'http://127.0.0.1:8787',
      hasServiceToken: Boolean(settings.hasServiceToken)
    },
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, status: item.status })),
    selectedCampaignId: selected,
    proposals: (state.aiMapProposals || []).filter((item) => !selected || item.campaignId === selected).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(proposalSummary),
    policy: {
      serviceRepository: 'Khaos-Krew/Khaos-Nexus-AI',
      serviceSnapshot: '32021e678d90271eaf31ba5273103ecb0f562ab2',
      endpoint: AI_MAP_PATH,
      explicitGenerationOnly: true,
      existingMapAssetsSent: false,
      serviceSvgStoredDirectly: false,
      autoImport: false,
      importedMapsStartHidden: true,
      importedMapsStartInactive: true,
      automaticDiscordPosting: false,
      automaticEncounterCreation: false
    }
  };
}

function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const value = payload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:ai-map-update', value);
  }
  return value;
}

function audit(action, input = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action, outcome: 'success', actorId: actorId(), campaignId: String(input.campaignId || '').slice(0, 100),
    targetId: String(input.id || input.proposalId || '').slice(0, 100), metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId, ...metadata }, 'dnd');
  return entry;
}

async function generateProposal(input = {}, fetchImpl = global.fetch) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm the exact AI map request before sending it.'), { code: 'CONFIRMATION_REQUIRED' });
  const normalized = normalizeMapRequest(input);
  const settings = refs.configStore.getDndCoDmSettings();
  const token = refs.configStore.getDndAiServiceToken();
  const servicePayload = await callAiService(settings.serviceEndpoint, AI_MAP_PATH, { body: normalized.request, token, fetchImpl });
  const parsed = parseMapResponse(servicePayload, normalized.request);
  const proposal = proposalFromGeneration({ campaignId: normalized.campaignId, request: normalized.request, response: parsed });
  const saved = refs.configStore.saveDndAiMapProposal(proposal);
  audit('ai-map.generated', saved, proposalAuditMetadata(saved));
  return { proposal: proposalSummary(saved), state: push(saved.campaignId) };
}

function proposalDetail(proposalId) {
  const state = refs.configStore.getDndState();
  ensureMapProposalState(state);
  const proposal = state.aiMapProposals.find((item) => item.id === proposalId);
  if (!proposal) throw Object.assign(new Error('AI map proposal was not found.'), { code: 'DND_AI_MAP_PROPOSAL_NOT_FOUND' });
  return clone(proposal);
}

function importProposal(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before importing this proposal into campaign maps.'), { code: 'CONFIRMATION_REQUIRED' });
  const proposal = proposalDetail(String(input.proposalId || ''));
  const imported = proposalToMapImport(proposal, { acknowledgedOriginality: input.acknowledgedOriginality === true });
  const draft = normalizeMap({
    ...imported.mapInput,
    generationMode: '',
    metadata: { ...imported.mapInput.metadata, generationMode: 'ai_structured' },
    createdBy: actorId(), updatedBy: actorId()
  });
  const relativePath = path.join(draft.campaignId, draft.id, `${safeName(draft.name)}.svg`);
  const destination = safeInside(mapRoot(), path.join(mapRoot(), relativePath));
  const buffer = Buffer.from(imported.svg, 'utf8');
  writeNewAtomic(destination, buffer);
  try {
    const completed = refs.configStore.completeDndAiMapImport(proposal.id, { ...draft, relativePath, fileName: path.basename(destination) });
    audit('ai-map.imported', { id: completed.map.id, campaignId: completed.map.campaignId }, {
      proposalId: proposal.id, mapType: proposal.result.mapType, seed: proposal.result.seed,
      originalityStatus: proposal.result.originality.status, activated: false, revealed: false
    });
    return { map: completed.map, proposalRemoved: completed.proposalRemoved, state: push(completed.map.campaignId) };
  } catch (error) {
    try { fs.unlinkSync(destination); } catch {}
    throw error;
  }
}

function removeProposal(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before deleting this AI map proposal.'), { code: 'CONFIRMATION_REQUIRED' });
  const proposal = proposalDetail(String(input.proposalId || ''));
  refs.configStore.removeDndAiMapProposal(proposal.id);
  audit('ai-map.proposal-removed', proposal, { mapType: proposal.result.mapType, seed: proposal.result.seed });
  return { removed: true, state: push(proposal.campaignId) };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:ai-maps-get', (_event, input = {}) => { assertOwner('View AI map proposals'); return payload(String(input.campaignId || '')); });
  ipc.handle('dnd:ai-map-preview', (_event, input = {}) => { assertOwner('Preview an AI map request'); return previewMapRequest(input); });
  ipc.handle('dnd:ai-map-generate', (_event, input = {}) => { assertOwner('Generate an AI map proposal'); return generateProposal(input); });
  ipc.handle('dnd:ai-map-proposal-get', (_event, input = {}) => { assertOwner('Review an AI map proposal'); return proposalDetail(String(input.proposalId || '')); });
  ipc.handle('dnd:ai-map-import', (_event, input = {}) => { assertOwner('Import an AI map proposal'); return importProposal(input); });
  ipc.handle('dnd:ai-map-proposal-remove', (_event, input = {}) => { assertOwner('Delete an AI map proposal'); return removeProposal(input); });
  return true;
}

function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-ai-maps',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-ai-maps.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-ai-maps.js')],
    source: 'dnd-ai-maps-extension.cjs'
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
  callAiService,
  proposalSummary,
  payload,
  generateProposal,
  proposalDetail,
  importProposal,
  removeProposal,
  safeInside,
  writeNewAtomic
};
