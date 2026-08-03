'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  CO_DM_WORKFLOWS,
  normalizeCoDmSettings,
  normalizeContextOptions,
  normalizeDraft,
  normalizeGenerationInput,
  ensureCoDmState,
  buildCampaignContext,
  buildReadiness,
  buildOpenAiRequest,
  parseOpenAiResponse,
  sanitizeProviderError,
  clean,
  cleanLine,
  nowIso
} = require('../shared/dnd-co-dm.cjs');

const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
const REQUEST_TIMEOUT_MS = 90000;
const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let registerTimer = null;

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

    getDndCoDmApiKey() { return String(this.secrets.dndCoDmOpenAiKey || ''); }

    setDndCoDmApiKey(value) {
      const key = String(value || '').trim();
      if (key && (!key.startsWith('sk-') || key.length < 20 || key.length > 300)) {
        throw Object.assign(new Error('Enter a valid OpenAI API key.'), { code: 'DND_CO_DM_API_KEY_INVALID', field: 'apiKey' });
      }
      if (key) this.secrets.dndCoDmOpenAiKey = key;
      else delete this.secrets.dndCoDmOpenAiKey;
      this.saveSecrets();
      return { hasApiKey: Boolean(key) };
    }

    getSecretValues() {
      return [...super.getSecretValues(), this.secrets.dndCoDmOpenAiKey].filter(Boolean);
    }

    getDndCoDmSettings() {
      const state = this.getDndState();
      ensureCoDmState(state);
      return { ...clone(state.coDmSettings), hasApiKey: Boolean(this.getDndCoDmApiKey()) };
    }

    setDndCoDmSettings(input = {}) {
      return this.mutateDnd((state) => {
        ensureCoDmState(state);
        state.coDmSettings = normalizeCoDmSettings({ ...state.coDmSettings, ...input, updatedAt: nowIso() });
        return clone(state.coDmSettings);
      });
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

function providerSettings() {
  const settings = refs.configStore.getDndCoDmSettings();
  return {
    provider: 'OpenAI',
    model: settings.model,
    hasApiKey: settings.hasApiKey,
    endpoint: 'OpenAI Responses API',
    storeProviderResponses: false,
    toolsEnabled: false
  };
}

function readiness(campaignId) {
  return buildReadiness(refs.configStore.getDndState(), campaignId, providerSettings());
}

function publicPayload(campaignId = '') {
  const state = refs.configStore.getDndState();
  ensureCoDmState(state);
  const selected = cleanLine(campaignId, 100) || state.campaigns.find((item) => item.active !== false)?.id || '';
  return {
    role: currentRole(),
    settings: refs.configStore.getDndCoDmSettings(),
    workflows: clone(CO_DM_WORKFLOWS),
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, status: item.status })),
    selectedCampaignId: selected,
    readiness: readiness(selected),
    drafts: (state.coDmDrafts || []).filter((item) => !selected || item.campaignId === selected).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt))).map(clone),
    policy: {
      explicitGenerationOnly: true,
      autonomousActions: false,
      discordPosting: false,
      providerStorage: false,
      providerTools: false,
      licensedFullTextIncludedByDefault: false
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

async function callOpenAi(apiKey, request, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in this build.'), { code: 'DND_CO_DM_NETWORK_UNAVAILABLE' });
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'user-agent': 'Khaos-Nexus-Co-DM/1'
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw sanitizeProviderError(error, apiKey);
  }
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `OpenAI returned HTTP ${response.status}.`);
    error.code = payload?.error?.code || 'DND_CO_DM_PROVIDER_ERROR';
    error.status = response.status;
    throw sanitizeProviderError(error, apiKey);
  }
  return payload;
}

async function generate(input = {}) {
  const generation = normalizeGenerationInput(input);
  const apiKey = refs.configStore.getDndCoDmApiKey();
  if (!apiKey) throw Object.assign(new Error('Add an OpenAI API key in Co-DM settings before generating a draft.'), { code: 'DND_CO_DM_API_KEY_REQUIRED' });
  const state = refs.configStore.getDndState();
  ensureCoDmState(state);
  const settings = normalizeCoDmSettings(state.coDmSettings);
  const context = buildCampaignContext(state, generation.campaignId, generation.contextOptions, settings);
  const request = buildOpenAiRequest(settings, generation, context);
  const payload = await callOpenAi(apiKey, request);
  const content = parseOpenAiResponse(payload);
  const draft = refs.configStore.saveDndCoDmDraft({
    campaignId: generation.campaignId,
    workflow: generation.workflow,
    title: `${CO_DM_WORKFLOWS[generation.workflow].label} — ${new Date().toLocaleDateString()}`,
    content,
    model: settings.model,
    contextSummary: {
      characters: context.characters,
      characterLimit: context.characterLimit,
      sectionCounts: Object.fromEntries(context.sections.map((item) => [item.id, item.count])),
      options: context.options
    }
  });
  audit('co-dm.generated', draft, { workflow: draft.workflow, model: draft.model, outputCharacters: draft.content.length, contextCharacters: context.characters });
  return { draft, context: { ...context, text: undefined, preview: context.preview }, state: push(generation.campaignId) };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:co-dm-get', (_event, input = {}) => { assertOwner('View the D&D Co-DM workspace'); return publicPayload(input.campaignId); });
  ipc.handle('dnd:co-dm-set-api-key', (_event, input = {}) => {
    assertOwner('Change the D&D Co-DM API key');
    const result = refs.configStore.setDndCoDmApiKey(input.apiKey);
    audit(input.apiKey ? 'co-dm.api-key-saved' : 'co-dm.api-key-removed', {}, { configured: result.hasApiKey });
    return { ...result, state: push(input.campaignId) };
  });
  ipc.handle('dnd:co-dm-set-settings', (_event, input = {}) => {
    assertOwner('Change D&D Co-DM settings');
    const settings = refs.configStore.setDndCoDmSettings(input);
    audit('co-dm.settings-saved', {}, { model: settings.model, maxOutputTokens: settings.maxOutputTokens, contextCharacterLimit: settings.contextCharacterLimit });
    return { settings: { ...settings, hasApiKey: Boolean(refs.configStore.getDndCoDmApiKey()) }, state: push(input.campaignId) };
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
    audit('co-dm.draft-applied', { ...draft, draftId: input.draftId }, { destination: result.destination, targetId: result.targetId, mode: input.mode === 'append' ? 'append' : 'replace', characters: result.characters });
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
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-co-dm.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-co-dm.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
        await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
      } catch (error) {
        refs.logger?.error?.('D&D Co-DM assets failed to load.', { message: sanitizeProviderError(error).message });
      }
    });
  });
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'dnd-workspace');
    if (module) {
      module.description = 'Complete private campaign operations with characters, content, maps, NPCs, encounters, Discord workflows, readiness checks, and explicit AI Co-DM drafting.';
      module.features = [...new Set([...(module.features || []), 'Private AI Co-DM drafts', 'Campaign readiness and context preview'])];
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
  OPENAI_RESPONSES_ENDPOINT,
  REQUEST_TIMEOUT_MS,
  callOpenAi,
  publicPayload,
  generate,
  providerSettings
};
