'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const electron = require('electron');
const {
  CAMPAIGNS_PATH,
  parseLegacyCampaignResponse,
  serviceUrl,
  sanitizeServiceError
} = require('../shared/dnd-ai-service.cjs');
const {
  AI_GM_SNAPSHOT,
  buildAiGmSyncPreview,
  normalizeBinding,
  normalizeAiGmSession,
  ensureAiGmState,
  recordPendingTurn,
  completeTurn,
  failTurn,
  resumeAiGmSession,
  campaignPath,
  campaignTurnsPath
} = require('../shared/dnd-ai-gm.cjs');
const {
  retryFailedTurn,
  applySelectedSuggestions,
  buildAiGmRecapDraft,
  endAiGmSession
} = require('../shared/dnd-ai-gm-actions.cjs');

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
function responseError(payload, status) {
  const value = payload?.error;
  const error = new Error(typeof value === 'string' ? value : value?.message || `Khaos Nexus AI returned HTTP ${status}.`);
  error.code = typeof value === 'object' ? value.code : 'DND_AI_SERVICE_HTTP_ERROR';
  error.status = status;
  return error;
}
async function callAiService(endpoint, pathname, { method = 'GET', body = null, token = '', fetchImpl = global.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in this build.'), { code: 'DND_AI_NETWORK_UNAVAILABLE' });
  const headers = { accept: 'application/json', 'user-agent': 'Khaos-Nexus-Desktop-DnD/1', 'x-khaos-request-id': crypto.randomUUID() };
  if (body !== null) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(serviceUrl(endpoint, pathname), {
      method, headers, ...(body === null ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) { throw sanitizeServiceError(error, token); }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Khaos Nexus AI returned an oversized response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE' });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('Khaos Nexus AI returned an oversized response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE' });
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('Khaos Nexus AI returned invalid JSON.'), { code: 'DND_AI_INVALID_JSON' }); }
  if (!response.ok) throw sanitizeServiceError(responseError(payload, response.status), token);
  return payload;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiGmRuntime) return;
  class DndAiGmRuntimeStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { ensureAiGmState(state); return true; });
      scheduleRegister();
    }
    mutateAiGm(mutator) {
      return this.mutateDnd((state) => { ensureAiGmState(state); return mutator(state); });
    }
  }
  Object.defineProperty(DndAiGmRuntimeStore, '__khaosDndAiGmRuntime', { value: true });
  target.ConfigStore = DndAiGmRuntimeStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndAiGmCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndAiGmCapture', { value: true });
  target[exportName] = Captured;
}
function settings() { return refs.configStore.getDndCoDmSettings?.() || { serviceEndpoint: 'http://127.0.0.1:8787' }; }
function token() { return refs.configStore.getDndAiServiceToken?.() || ''; }
function audit(action, input = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action, outcome: 'success', actorId: actorId(), campaignId: String(input.campaignId || '').slice(0, 100),
    targetId: String(input.id || input.turnId || input.aiGmSessionId || '').slice(0, 100), metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId, ...metadata }, 'dnd');
  return entry;
}
function summaryTurn(turn = {}) {
  return {
    id: turn.id, clientTurnId: turn.clientTurnId, aiGmSessionId: turn.aiGmSessionId, actor: turn.actor,
    message: turn.message, dmGuidance: turn.dmGuidance, status: turn.status, response: clone(turn.response),
    error: turn.error, retryable: turn.retryable, retryCount: turn.retryCount, createdAt: turn.createdAt,
    submittedAt: turn.submittedAt, completedAt: turn.completedAt, updatedAt: turn.updatedAt
  };
}
function payload(campaignId = '') {
  const state = refs.configStore.getDndState();
  ensureAiGmState(state);
  const selected = String(campaignId || '').trim() || state.campaigns?.find((item) => item.active !== false)?.id || '';
  const desktopSessions = (state.sessions || []).filter((item) => item.campaignId === selected && ['planned', 'active'].includes(item.status));
  const bindings = state.aiGmBindings.filter((item) => item.campaignId === selected);
  const sessions = state.aiGmSessions.filter((item) => item.campaignId === selected).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const sessionIds = new Set(sessions.map((item) => item.id));
  return {
    role: currentRole(),
    service: { endpoint: settings().serviceEndpoint || 'http://127.0.0.1:8787', hasServiceToken: Boolean(settings().hasServiceToken) },
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, status: item.status })),
    selectedCampaignId: selected,
    desktopSessions: desktopSessions.map((item) => ({ id: item.id, title: item.title || item.name || 'Session', status: item.status, scheduledAt: item.scheduledAt || '' })),
    bindings: clone(bindings), sessions: clone(sessions),
    turns: state.aiGmTurns.filter((item) => sessionIds.has(item.aiGmSessionId)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(summaryTurn),
    policy: {
      serviceRepository: 'Khaos-Krew/Khaos-Nexus-AI', serviceSnapshot: AI_GM_SNAPSHOT,
      explicitSyncOnly: true, explicitTurnOnly: true, servicePersistsCampaignCopy: true,
      playerAgencyRequired: true, safetyLockRequired: true, automaticRolls: false,
      automaticStateMutation: false, automaticDiscordPublication: false
    }
  };
}
function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const value = payload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:ai-gm-update', value);
  }
  return value;
}
function findBinding(state, sessionId) {
  const session = state.aiGmSessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error('AI Game Master session was not found.'), { code: 'DND_AI_GM_SESSION_NOT_FOUND' });
  const binding = state.aiGmBindings.find((item) => item.id === session.bindingId);
  if (!binding) throw Object.assign(new Error('AI Game Master service binding was not found.'), { code: 'DND_AI_GM_BINDING_NOT_FOUND' });
  return { session, binding };
}

async function synchronize(input = {}, fetchImpl = global.fetch) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm the exact campaign synchronization preview before sending it.'), { code: 'CONFIRMATION_REQUIRED' });
  const state = refs.configStore.getDndState();
  const preview = buildAiGmSyncPreview(state, input);
  const servicePayload = await callAiService(settings().serviceEndpoint, CAMPAIGNS_PATH, { method: 'POST', body: preview.request, token: token(), fetchImpl });
  const serviceCampaign = parseLegacyCampaignResponse(servicePayload);
  const timestamp = nowIso();
  const binding = normalizeBinding({
    campaignId: preview.campaignId, sessionId: preview.sessionId, endpoint: settings().serviceEndpoint,
    serviceCampaignId: serviceCampaign.id, contextFingerprint: preview.contextFingerprint,
    contextOptions: preview.contextOptions, playerCharacterNames: preview.playerCharacterNames,
    serviceVersion: servicePayload?.meta?.version || servicePayload?.version || '',
    provider: servicePayload?.meta?.provider || '', model: servicePayload?.meta?.model || '', syncedAt: timestamp
  });
  const aiSession = normalizeAiGmSession({ campaignId: preview.campaignId, desktopSessionId: preview.sessionId, bindingId: binding.id, mode: 'ready' });
  refs.configStore.mutateAiGm((draft) => {
    draft.aiGmBindings = draft.aiGmBindings.filter((item) => !(item.campaignId === binding.campaignId && item.sessionId === binding.sessionId));
    draft.aiGmBindings.push(binding);
    draft.aiGmSessions = draft.aiGmSessions.filter((item) => !(item.campaignId === aiSession.campaignId && item.desktopSessionId === aiSession.desktopSessionId && item.mode !== 'ended'));
    draft.aiGmSessions.push(aiSession);
    return true;
  });
  audit('ai-gm.synchronized', { id: aiSession.id, campaignId: aiSession.campaignId }, { serviceCampaignId: binding.serviceCampaignId, contextFingerprint: binding.contextFingerprint });
  return { binding: clone(binding), session: clone(aiSession), state: push(aiSession.campaignId) };
}
async function submitTurn(input = {}, fetchImpl = global.fetch) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before sending this table turn to Khaos Nexus AI.'), { code: 'CONFIRMATION_REQUIRED' });
  const current = refs.configStore.getDndState();
  const { session, binding } = findBinding(current, String(input.aiGmSessionId || ''));
  let pending;
  refs.configStore.mutateAiGm((state) => {
    pending = recordPendingTurn(state, { ...input, aiGmSessionId: session.id, serviceCampaignId: binding.serviceCampaignId });
    return true;
  });
  if (pending.duplicate && pending.turn.status !== 'failed') return { turn: pending.turn, duplicate: true, state: push(session.campaignId) };
  try {
    const servicePayload = await callAiService(binding.endpoint, campaignTurnsPath(binding.serviceCampaignId), { method: 'POST', body: pending.request, token: token(), fetchImpl });
    let completed;
    refs.configStore.mutateAiGm((state) => {
      completed = completeTurn(state, pending.turn.id, servicePayload, { playerCharacterNames: binding.playerCharacterNames });
      return true;
    });
    audit('ai-gm.turn-completed', { id: completed.turn.id, campaignId: session.campaignId }, { safetyStatus: completed.turn.response?.safety?.status || 'ok', suggestions: completed.turn.response?.suggestions?.length || 0 });
    return { turn: completed.turn, duplicate: completed.duplicate, state: push(session.campaignId) };
  } catch (error) {
    const safe = sanitizeServiceError(error, token());
    let failed;
    refs.configStore.mutateAiGm((state) => {
      failed = failTurn(state, pending.turn.id, { message: safe.message, retryable: ![400, 401, 403, 404, 409, 422].includes(Number(safe.status || 0)) });
      return true;
    });
    push(session.campaignId);
    throw safe;
  }
}
async function retryTurn(input = {}, fetchImpl = global.fetch) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before retrying this failed AI Game Master turn.'), { code: 'CONFIRMATION_REQUIRED' });
  let retry;
  refs.configStore.mutateAiGm((state) => { retry = retryFailedTurn(state, input.turnId); return true; });
  const state = refs.configStore.getDndState();
  const turn = state.aiGmTurns.find((item) => item.id === retry.turn.id);
  const { session, binding } = findBinding(state, turn.aiGmSessionId);
  try {
    const servicePayload = await callAiService(binding.endpoint, campaignTurnsPath(binding.serviceCampaignId), { method: 'POST', body: retry.request, token: token(), fetchImpl });
    let completed;
    refs.configStore.mutateAiGm((draft) => { completed = completeTurn(draft, turn.id, servicePayload, { playerCharacterNames: binding.playerCharacterNames }); return true; });
    audit('ai-gm.turn-retried', { id: turn.id, campaignId: session.campaignId }, { retryCount: completed.turn.retryCount });
    return { turn: completed.turn, state: push(session.campaignId) };
  } catch (error) {
    const safe = sanitizeServiceError(error, token());
    refs.configStore.mutateAiGm((draft) => { failTurn(draft, turn.id, { message: safe.message, retryable: ![400, 401, 403, 404, 409, 422].includes(Number(safe.status || 0)) }); return true; });
    push(session.campaignId);
    throw safe;
  }
}
function resume(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm the safety-lock resume reason.'), { code: 'CONFIRMATION_REQUIRED' });
  let result;
  refs.configStore.mutateAiGm((state) => { result = resumeAiGmSession(state, input.aiGmSessionId, input.reason); return true; });
  audit('ai-gm.resumed', { id: result.session.id, campaignId: result.session.campaignId }, { reasonRecorded: true });
  return { session: result.session, state: push(result.session.campaignId) };
}
function applySuggestions(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm the selected suggestions and destination.'), { code: 'CONFIRMATION_REQUIRED' });
  let result;
  refs.configStore.mutateAiGm((state) => { result = applySelectedSuggestions(state, input); return true; });
  const turn = result.state.aiGmTurns.find((item) => item.id === input.turnId);
  audit('ai-gm.suggestions-applied', { id: input.turnId, campaignId: turn?.campaignId || '' }, { target: input.target, count: result.applied.length, duplicate: result.duplicate });
  return { applied: result.applied, duplicate: result.duplicate, state: push(turn?.campaignId || '') };
}
function recap(input = {}) {
  const state = refs.configStore.getDndState();
  const text = buildAiGmRecapDraft(state, input.aiGmSessionId);
  return { text };
}
function end(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before ending AI Game Master mode for this session.'), { code: 'CONFIRMATION_REQUIRED' });
  let result;
  refs.configStore.mutateAiGm((state) => { result = endAiGmSession(state, input.aiGmSessionId); return true; });
  audit('ai-gm.ended', { id: result.session.id, campaignId: result.session.campaignId }, {});
  return { session: result.session, state: push(result.session.campaignId) };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:ai-gm-get', (_event, input = {}) => { assertOwner('View AI Game Master sessions'); return payload(String(input.campaignId || '')); });
  ipc.handle('dnd:ai-gm-preview', (_event, input = {}) => { assertOwner('Preview AI Game Master synchronization'); return buildAiGmSyncPreview(refs.configStore.getDndState(), input); });
  ipc.handle('dnd:ai-gm-sync', (_event, input = {}) => { assertOwner('Synchronize an AI Game Master session'); return synchronize(input); });
  ipc.handle('dnd:ai-gm-turn', (_event, input = {}) => { assertOwner('Submit an AI Game Master turn'); return submitTurn(input); });
  ipc.handle('dnd:ai-gm-retry', (_event, input = {}) => { assertOwner('Retry an AI Game Master turn'); return retryTurn(input); });
  ipc.handle('dnd:ai-gm-resume', (_event, input = {}) => { assertOwner('Resume AI Game Master generation'); return resume(input); });
  ipc.handle('dnd:ai-gm-apply', (_event, input = {}) => { assertOwner('Apply AI Game Master suggestions'); return applySuggestions(input); });
  ipc.handle('dnd:ai-gm-recap', (_event, input = {}) => { assertOwner('Draft an AI Game Master recap'); return recap(input); });
  ipc.handle('dnd:ai-gm-end', (_event, input = {}) => { assertOwner('End AI Game Master mode'); return end(input); });
  return true;
}
function scheduleRegister() { clearTimeout(timer); timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100); timer.unref?.(); }
function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-ai-gm.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-ai-gm.js');
  electron.app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', async () => {
    try {
      await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
      await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
    } catch (error) { refs.logger?.error?.('Veyra Game Master assets failed to load.', { message: error.message }); }
  }));
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
module.exports = { install, callAiService, payload, synchronize, submitTurn, retryTurn, resume, applySuggestions, recap, end };
