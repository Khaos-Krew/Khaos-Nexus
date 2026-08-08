'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');
const {
  CO_DM_WORKFLOWS,
  normalizeCoDmSettings,
  normalizeContextOptions,
  normalizeDraft,
  normalizeServiceBinding,
  normalizeGenerationInput,
  ensureCoDmState,
  buildCampaignContext,
  buildReadiness,
  cleanLine,
  nowIso
} = require('../shared/dnd-co-dm.cjs');
const {
  HEALTH_PATH,
  CAMPAIGNS_PATH,
  DRAFTS_PATH,
  serviceUrl,
  normalizeHealth,
  unavailableHealth,
  contextFingerprint,
  buildDedicatedDraftRequest,
  buildLegacyCampaignRequest,
  buildLegacyTurnRequest,
  parseDedicatedDraftResponse,
  parseLegacyCampaignResponse,
  parseLegacyTurnResponse,
  sanitizeServiceError
} = require('../shared/dnd-ai-service.cjs');

const REQUEST_TIMEOUT_MS = 90000;
const HEALTH_CACHE_MS = 30000;
const MAX_RESPONSE_CHARACTERS = 1_000_000;
const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let registerTimer = null;
let healthCache = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
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

function ensureStoreState(store) {
  if (typeof store.mutateDnd !== 'function') return;
  store.mutateDnd((state) => { ensureCoDmState(state); return true; });
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndCoDmPatched) return;
  class DndCoDmConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureStoreState(this);
      scheduleRegister();
    }

    getDndAiServiceToken() { return String(this.secrets.dndAiServiceToken || ''); }

    setDndAiServiceToken(value) {
      const token = String(value || '').trim();
      if (token && (token.length < 8 || token.length > 500 || /\s/.test(token))) {
        throw Object.assign(new Error('The Khaos Nexus AI service token must be 8–500 characters without spaces.'), { code: 'DND_AI_SERVICE_TOKEN_INVALID', field: 'serviceToken' });
      }
      if (token) this.secrets.dndAiServiceToken = token;
      else delete this.secrets.dndAiServiceToken;
      delete this.secrets.dndCoDmOpenAiKey;
      this.saveSecrets();
      healthCache = null;
      return { hasServiceToken: Boolean(token) };
    }

    getSecretValues() {
      return [...super.getSecretValues(), this.secrets.dndAiServiceToken].filter(Boolean);
    }

    getDndCoDmSettings() {
      const state = this.getDndState();
      ensureCoDmState(state);
      return { ...clone(state.coDmSettings), hasServiceToken: Boolean(this.getDndAiServiceToken()) };
    }

    setDndCoDmSettings(input = {}) {
      const result = this.mutateDnd((state) => {
        ensureCoDmState(state);
        state.coDmSettings = normalizeCoDmSettings({ ...state.coDmSettings, ...input, updatedAt: nowIso() });
        return clone(state.coDmSettings);
      });
      healthCache = null;
      return result;
    }

    saveDndCoDmDraft(input = {}) {
      return this.mutateDnd((state) => {
        ensureCoDmState(state);
        const existing = state.coDmDrafts.find((item) => item.id === input.id);
        const draft = normalizeDraft({ ...(existing || {}), ...input, createdAt: existing?.createdAt || input.createdAt });
        const index = state.coDmDrafts.findIndex((item) => item.id === draft.id);
        if (index >= 0) state.coDmDrafts[index] = draft;
        else state.coDmDrafts.push(draft);
        state.coDmDrafts.sort((a, b) => Number(Boolean(a.pinned)) - Number(Boolean(b.pinned)) || String(a.updatedAt).localeCompare(String(b.updatedAt)));
        const limit = state.coDmSettings.historyLimit;
        if (state.coDmDrafts.length > limit) {
          const unpinned = state.coDmDrafts.filter((item) => !item.pinned);
          while (state.coDmDrafts.length > limit && unpinned.length) {
            const remove = unpinned.shift();
            const removeIndex = state.coDmDrafts.findIndex((item) => item.id === remove.id);
            if (removeIndex >= 0) state.coDmDrafts.splice(removeIndex, 1);
          }
          if (state.coDmDrafts.length > 100) state.coDmDrafts.splice(0, state.coDmDrafts.length - 100);
        }
        return clone(draft);
      });
    }

    removeDndCoDmDraft(draftId) {
      return this.mutateDnd((state) => {
        ensureCoDmState(state);
        const index = state.coDmDrafts.findIndex((item) => item.id === draftId);
        if (index < 0) return false;
        state.coDmDrafts.splice(index, 1);
        return true;
      });
    }

    upsertDndCoDmServiceBinding(input = {}) {
      return this.mutateDnd((state) => {
        ensureCoDmState(state);
        const binding = normalizeServiceBinding(input);
        const index = state.coDmServiceBindings.findIndex((item) => item.id === binding.id || (item.campaignId === binding.campaignId && item.endpoint === binding.endpoint));
        if (index >= 0) state.coDmServiceBindings[index] = { ...binding, id: state.coDmServiceBindings[index].id, createdAt: state.coDmServiceBindings[index].createdAt };
        else state.coDmServiceBindings.push(binding);
        return clone(index >= 0 ? state.coDmServiceBindings[index] : binding);
      });
    }

    applyDndCoDmDraft(input = {}) {
      return this.mutateDnd((state) => {
        ensureCoDmState(state);
        const draft = state.coDmDrafts.find((item) => item.id === input.draftId);
        if (!draft) throw Object.assign(new Error('Co-DM draft was not found.'), { code: 'DND_CO_DM_DRAFT_NOT_FOUND' });
        if (!input.confirmed) throw Object.assign(new Error('Confirm before copying a Co-DM draft into campaign records.'), { code: 'CONFIRMATION_REQUIRED' });
        const mode = input.mode === 'append' ? 'append' : 'replace';
        if (input.destination === 'session-recap') {
          const session = state.sessions.find((item) => item.id === input.sessionId && item.campaignId === draft.campaignId)
            || state.sessions.find((item) => item.campaignId === draft.campaignId && item.status === 'active')
            || state.sessions.filter((item) => item.campaignId === draft.campaignId).slice(-1)[0];
          if (!session) throw Object.assign(new Error('No campaign session is available for the recap draft.'), { code: 'DND_CO_DM_SESSION_REQUIRED' });
          session.recapDraft = mode === 'append' && session.recapDraft ? `${session.recapDraft}\n\n${draft.content}`.slice(0, 40000) : draft.content;
          session.updatedAt = nowIso();
          return { destination: 'session-recap', targetId: session.id, characters: session.recapDraft.length };
        }
        if (input.destination === 'campaign-notes') {
          const campaign = state.campaigns.find((item) => item.id === draft.campaignId);
          if (!campaign) throw Object.assign(new Error('Campaign was not found.'), { code: 'DND_CAMPAIGN_REQUIRED' });
          campaign.coDmNotes = mode === 'append' && campaign.coDmNotes ? `${campaign.coDmNotes}\n\n${draft.content}`.slice(0, 40000) : draft.content;
          campaign.updatedAt = nowIso();
          return { destination: 'campaign-notes', targetId: campaign.id, characters: campaign.coDmNotes.length };
        }
        throw Object.assign(new Error('Choose a supported Co-DM draft destination.'), { code: 'DND_CO_DM_DESTINATION_INVALID' });
      });
    }
  }
  Object.defineProperty(DndCoDmConfigStore, '__khaosDndCoDmPatched', { value: true });
  target.ConfigStore = DndCoDmConfigStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndCoDmCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndCoDmCapture', { value: true });
  target[exportName] = Captured;
}

function cachedServiceStatus(settings) {
  if (healthCache?.endpoint === settings.serviceEndpoint) return clone(healthCache);
  return unavailableHealth(settings.serviceEndpoint, 'Connection has not been checked yet.');
}

function readiness(campaignId) {
  const settings = refs.configStore.getDndCoDmSettings();
  return buildReadiness(refs.configStore.getDndState(), campaignId, cachedServiceStatus(settings));
}

function publicPayload(campaignId = '') {
  const state = refs.configStore.getDndState();
  ensureCoDmState(state);
  const settings = refs.configStore.getDndCoDmSettings();
  const service = cachedServiceStatus(settings);
  const selected = cleanLine(campaignId, 100) || state.campaigns.find((item) => item.active !== false)?.id || '';
  return {
    role: currentRole(),
    settings,
    service,
    workflows: clone(CO_DM_WORKFLOWS),
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, status: item.status })),
    selectedCampaignId: selected,
    readiness: buildReadiness(state, selected, service),
    drafts: (state.coDmDrafts || []).filter((item) => !selected || item.campaignId === selected).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt))).map(clone),
    policy: {
      serviceRepository: 'Khaos-Krew/Khaos-Nexus-AI',
      explicitGenerationOnly: true,
      autonomousActions: false,
      discordPosting: false,
      desktopProviderCredentials: false,
      providerToolsControlledByService: true,
      licensedFullTextIncludedByDefault: false,
      legacyCampaignPersistence: service.legacyCampaignTurns && !service.dedicatedDrafts
    }
  };
}

function audit(action, input = {}, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action,
    outcome: 'success',
    actorId: actorId(),
    campaignId: cleanLine(input.campaignId, 100),
    targetId: cleanLine(input.id || input.draftId, 100),
    metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId, ...metadata }, 'dnd');
  return entry;
}

function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const value = publicPayload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:co-dm-update', value);
  }
  return value;
}

function responseError(payload, status) {
  const value = payload?.error;
  const error = new Error(typeof value === 'string' ? value : value?.message || `Khaos Nexus AI returned HTTP ${status}.`);
  error.code = typeof value === 'object' ? value.code : 'DND_AI_SERVICE_HTTP_ERROR';
  error.retryable = Boolean(typeof value === 'object' && value.retryable);
  error.status = status;
  return error;
}

async function callAiService(endpoint, pathname, { method = 'GET', body = null, token = '', fetchImpl = global.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in this build.'), { code: 'DND_AI_NETWORK_UNAVAILABLE' });
  const requestId = cryptoRandomId();
  const headers = {
    accept: 'application/json',
    'user-agent': 'Khaos-Nexus-Desktop-DnD/1',
    'x-khaos-request-id': requestId
  };
  if (body !== null) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(serviceUrl(endpoint, pathname), {
      method,
      headers,
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw sanitizeServiceError(error, token);
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) {
    throw Object.assign(new Error('Khaos Nexus AI returned an oversized response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE', status: response.status });
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) {
    throw Object.assign(new Error('Khaos Nexus AI returned an oversized response.'), { code: 'DND_AI_RESPONSE_TOO_LARGE', status: response.status });
  }
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch {
    throw Object.assign(new Error('Khaos Nexus AI returned invalid JSON.'), { code: 'DND_AI_INVALID_JSON', status: response.status });
  }
  if (!response.ok) throw sanitizeServiceError(responseError(payload, response.status), token);
  return { payload, requestId };
}

function cryptoRandomId() {
  try { return require('node:crypto').randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

async function checkService({ force = false, fetchImpl = global.fetch } = {}) {
  const settings = refs.configStore.getDndCoDmSettings();
  if (!force && healthCache?.endpoint === settings.serviceEndpoint) {
    const age = Date.now() - Date.parse(healthCache.checkedAt || 0);
    if (age >= 0 && age < HEALTH_CACHE_MS) return clone(healthCache);
  }
  try {
    const { payload } = await callAiService(settings.serviceEndpoint, HEALTH_PATH, {
      token: refs.configStore.getDndAiServiceToken(),
      fetchImpl
    });
    healthCache = normalizeHealth(payload, settings.serviceEndpoint);
  } catch (error) {
    const safe = sanitizeServiceError(error, refs.configStore.getDndAiServiceToken());
    healthCache = unavailableHealth(settings.serviceEndpoint, safe);
  }
  return clone(healthCache);
}

function findServiceBinding(state, campaignId, endpoint) {
  return (state.coDmServiceBindings || []).find((item) => item.campaignId === campaignId && item.endpoint === endpoint) || null;
}

async function ensureLegacyCampaign(state, settings, service, context, token, fetchImpl) {
  const fingerprint = contextFingerprint(context);
  const existing = findServiceBinding(state, context.campaignId, settings.serviceEndpoint);
  if (existing?.serviceCampaignId && existing.contextFingerprint === fingerprint) return existing;
  const request = buildLegacyCampaignRequest(state, context.campaignId, context);
  const { payload } = await callAiService(settings.serviceEndpoint, CAMPAIGNS_PATH, {
    method: 'POST', body: request, token, fetchImpl
  });
  const created = parseLegacyCampaignResponse(payload);
  return refs.configStore.upsertDndCoDmServiceBinding({
    id: existing?.id,
    campaignId: context.campaignId,
    endpoint: settings.serviceEndpoint,
    serviceCampaignId: created.id,
    contextFingerprint: fingerprint,
    serviceVersion: service.version,
    createdAt: existing?.createdAt,
    updatedAt: nowIso()
  });
}

async function generate(input = {}, fetchImpl = global.fetch) {
  const generation = normalizeGenerationInput(input);
  const state = refs.configStore.getDndState();
  ensureCoDmState(state);
  const settings = normalizeCoDmSettings(state.coDmSettings);
  const context = buildCampaignContext(state, generation.campaignId, generation.contextOptions, settings);
  const service = await checkService({ force: true, fetchImpl });
  if (!service.reachable) throw Object.assign(new Error(service.error || 'Khaos Nexus AI is unavailable.'), { code: 'DND_AI_SERVICE_UNAVAILABLE', retryable: true });
  const token = refs.configStore.getDndAiServiceToken();
  let generated;
  let mode;

  if (service.dedicatedDrafts) {
    const request = buildDedicatedDraftRequest(settings, generation, context);
    const { payload } = await callAiService(settings.serviceEndpoint, DRAFTS_PATH, {
      method: 'POST', body: request, token, fetchImpl
    });
    generated = parseDedicatedDraftResponse(payload);
    mode = 'dedicated-draft';
  } else if (service.legacyCampaignTurns) {
    if (!input.allowLegacyCampaignPersistence) {
      throw Object.assign(new Error('The current Khaos Nexus AI compatibility mode stores a synchronized campaign copy and turn history. Confirm that behavior before generating.'), { code: 'DND_AI_LEGACY_PERSISTENCE_CONFIRMATION_REQUIRED', field: 'allowLegacyCampaignPersistence' });
    }
    const binding = await ensureLegacyCampaign(state, settings, service, context, token, fetchImpl);
    const request = buildLegacyTurnRequest(CO_DM_WORKFLOWS[generation.workflow], generation);
    const { payload } = await callAiService(settings.serviceEndpoint, `${CAMPAIGNS_PATH}/${encodeURIComponent(binding.serviceCampaignId)}/turns`, {
      method: 'POST', body: request, token, fetchImpl
    });
    generated = parseLegacyTurnResponse(payload);
    mode = 'campaign-turn-compatibility';
  } else {
    throw Object.assign(new Error('This Khaos Nexus AI service does not expose a supported D&D Co-DM capability.'), { code: 'DND_AI_CAPABILITY_UNAVAILABLE' });
  }

  const model = generated.model || service.model || settings.model;
  const provider = generated.provider || service.provider || service.service;
  const draft = refs.configStore.saveDndCoDmDraft({
    campaignId: generation.campaignId,
    workflow: generation.workflow,
    title: `${CO_DM_WORKFLOWS[generation.workflow].label} — ${new Date().toLocaleDateString()}`,
    content: generated.content,
    model,
    provider,
    serviceVersion: service.version,
    contextSummary: {
      characters: context.characters,
      characterLimit: context.characterLimit,
      sectionCounts: Object.fromEntries(context.sections.map((item) => [item.id, item.count])),
      options: context.options,
      serviceMode: mode
    }
  });
  audit('co-dm.generated', draft, {
    workflow: draft.workflow,
    serviceMode: mode,
    provider,
    model,
    serviceVersion: service.version,
    outputCharacters: draft.content.length,
    contextCharacters: context.characters
  });
  return {
    draft,
    service,
    context: { ...context, text: undefined, preview: context.preview },
    state: push(generation.campaignId)
  };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:co-dm-get', (_event, input = {}) => { assertOwner('View the D&D Co-DM workspace'); return publicPayload(input.campaignId); });
  ipc.handle('dnd:co-dm-service-check', async (_event, input = {}) => {
    assertOwner('Check the Khaos Nexus AI service');
    const service = await checkService({ force: true });
    audit('co-dm.service-checked', { campaignId: input.campaignId }, { reachable: service.reachable, serviceVersion: service.version, capabilities: service.capabilities });
    return { service, state: push(input.campaignId) };
  });
  ipc.handle('dnd:co-dm-set-service-token', (_event, input = {}) => {
    assertOwner('Change the Khaos Nexus AI service token');
    const result = refs.configStore.setDndAiServiceToken(input.serviceToken);
    audit(input.serviceToken ? 'co-dm.service-token-saved' : 'co-dm.service-token-removed', {}, { configured: result.hasServiceToken });
    return { ...result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:co-dm-set-settings', (_event, input = {}) => {
    assertOwner('Change D&D Co-DM settings');
    const settings = refs.configStore.setDndCoDmSettings(input);
    audit('co-dm.settings-saved', {}, {
      serviceEndpoint: settings.serviceEndpoint,
      model: settings.model,
      maxOutputCharacters: settings.maxOutputCharacters,
      contextCharacterLimit: settings.contextCharacterLimit
    });
    return { settings: { ...settings, hasServiceToken: Boolean(refs.configStore.getDndAiServiceToken()) }, state: push(input.campaignId) };
  });
  ipc.handle('dnd:co-dm-preview-context', (_event, input = {}) => {
    assertOwner('Preview D&D Co-DM context');
    const state = refs.configStore.getDndState();
    const context = buildCampaignContext(state, input.campaignId, normalizeContextOptions(input.contextOptions), state.coDmSettings);
    return { ...context, text: undefined };
  });
  ipc.handle('dnd:co-dm-generate', (_event, input = {}) => { assertOwner('Generate a D&D Co-DM draft'); return generate(input); });
  ipc.handle('dnd:co-dm-draft-save', (_event, input = {}) => {
    assertOwner('Edit a D&D Co-DM draft');
    const draft = refs.configStore.saveDndCoDmDraft(input);
    audit('co-dm.draft-saved', draft, { workflow: draft.workflow, pinned: draft.pinned, outputCharacters: draft.content.length });
    return { draft, state: push(draft.campaignId) };
  });
  ipc.handle('dnd:co-dm-draft-delete', (_event, input = {}) => {
    assertOwner('Delete a D&D Co-DM draft');
    const state = refs.configStore.getDndState();
    const draft = state.coDmDrafts?.find((item) => item.id === input.draftId);
    const removed = refs.configStore.removeDndCoDmDraft(cleanLine(input.draftId, 100));
    if (removed) audit('co-dm.draft-deleted', { draftId: input.draftId, campaignId: draft?.campaignId }, { workflow: draft?.workflow || '' });
    return { removed, state: push(draft?.campaignId || input.campaignId) };
  });
  ipc.handle('dnd:co-dm-draft-apply', (_event, input = {}) => {
    assertOwner('Copy a D&D Co-DM draft into campaign records');
    const result = refs.configStore.applyDndCoDmDraft(input);
    const state = refs.configStore.getDndState();
    const draft = state.coDmDrafts?.find((item) => item.id === input.draftId);
    audit('co-dm.draft-applied', { ...draft, draftId: input.draftId }, {
      destination: result.destination,
      targetId: result.targetId,
      mode: input.mode === 'append' ? 'append' : 'replace',
      characters: result.characters
    });
    return { result, state: push(draft?.campaignId || input.campaignId) };
  });
  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  registerTimer.unref?.();
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-co-dm',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-co-dm.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-co-dm.js')],
    source: 'dnd-co-dm-extension.cjs'
  });
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'dnd-workspace');
    if (module) {
      module.description = 'Complete private campaign operations with characters, content, maps, NPCs, encounters, Discord workflows, readiness checks, and Khaos Nexus AI Co-DM drafting.';
      module.features = [...new Set([...(module.features || []), 'Khaos Nexus AI Co-DM drafts', 'Campaign readiness and context preview'])];
    }
  } catch {}
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  promoteCatalog();
  installRendererAssets();
  scheduleRegister();
}

module.exports = {
  install,
  REQUEST_TIMEOUT_MS,
  HEALTH_CACHE_MS,
  callAiService,
  checkService,
  publicPayload,
  generate
};
