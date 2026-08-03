'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  AI_HOMEBREW_PATH,
  previewHomebrewRequest,
  parseHomebrewResponse,
  normalizeProposal,
  ensureHomebrewProposalState,
  proposalFromGeneration,
  proposalToHomebrewDraft,
  proposalAuditMetadata,
  cleanLine,
  clone,
  nowIso
} = require('../shared/dnd-ai-homebrew.cjs');
const { callAiService, checkService } = require('./dnd-co-dm-extension.cjs');

const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let registerTimer = null;

function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) {
    throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  }
  return true;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiHomebrewPatched) return;

  class DndAiHomebrewStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { ensureHomebrewProposalState(state); return true; });
      scheduleRegister();
    }

    saveDndAiHomebrewProposal(input = {}) {
      return this.mutateDnd((state) => {
        ensureHomebrewProposalState(state);
        const existing = state.aiHomebrewProposals.find((item) => item.id === input.id);
        const proposal = normalizeProposal({ ...(existing || {}), ...input, createdAt: existing?.createdAt || input.createdAt, updatedAt: nowIso() });
        const index = state.aiHomebrewProposals.findIndex((item) => item.id === proposal.id);
        if (index >= 0) state.aiHomebrewProposals[index] = proposal;
        else state.aiHomebrewProposals.push(proposal);
        if (state.aiHomebrewProposals.length > 100) state.aiHomebrewProposals.splice(0, state.aiHomebrewProposals.length - 100);
        return clone(proposal);
      });
    }

    removeDndAiHomebrewProposal(proposalId) {
      return this.mutateDnd((state) => {
        ensureHomebrewProposalState(state);
        const index = state.aiHomebrewProposals.findIndex((item) => item.id === proposalId);
        if (index < 0) return false;
        state.aiHomebrewProposals.splice(index, 1);
        return true;
      });
    }

    convertDndAiHomebrewProposal(input = {}) {
      const state = this.getDndState();
      ensureHomebrewProposalState(state);
      const proposal = state.aiHomebrewProposals.find((item) => item.id === input.proposalId);
      if (!proposal) throw Object.assign(new Error('AI homebrew proposal was not found.'), { code: 'DND_AI_HOMEBREW_PROPOSAL_NOT_FOUND' });
      if (!input.confirmed) throw Object.assign(new Error('Confirm before converting an AI proposal into a homebrew draft.'), { code: 'CONFIRMATION_REQUIRED' });
      const draft = proposalToHomebrewDraft(proposal, { acknowledgedOriginality: Boolean(input.acknowledgedOriginality) });
      if (typeof this.saveDndHomebrew !== 'function') throw Object.assign(new Error('The D&D homebrew workflow is unavailable.'), { code: 'DND_HOMEBREW_WORKFLOW_UNAVAILABLE' });
      const result = this.saveDndHomebrew({ ...draft, authorUserId: actorId() });
      return { proposal: clone(proposal), homebrew: clone(result.record), createdRevision: Boolean(result.createdRevision) };
    }
  }

  Object.defineProperty(DndAiHomebrewStore, '__khaosDndAiHomebrewPatched', { value: true });
  target.ConfigStore = DndAiHomebrewStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndAiHomebrewCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosDndAiHomebrewCapture', { value: true });
  target[exportName] = Captured;
}

function proposalsForCampaign(campaignId = '') {
  const state = refs.configStore.getDndState();
  ensureHomebrewProposalState(state);
  return state.aiHomebrewProposals
    .filter((item) => !campaignId || item.campaignId === campaignId)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(clone);
}

async function publicPayload(campaignId = '', { refreshService = false } = {}) {
  const settings = refs.configStore.getDndCoDmSettings();
  const service = await checkService({ force: refreshService });
  const state = refs.configStore.getDndState();
  const selected = cleanLine(campaignId, 100) || state.campaigns.find((item) => item.active !== false)?.id || '';
  return {
    role: currentRole(),
    settings: {
      serviceEndpoint: settings.serviceEndpoint,
      hasServiceToken: Boolean(settings.hasServiceToken)
    },
    service,
    selectedCampaignId: selected,
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, ruleset: item.ruleset || item.system || '' })),
    proposals: proposalsForCampaign(selected),
    policy: {
      endpoint: AI_HOMEBREW_PATH,
      originalConceptsOnly: true,
      rawInspirationStored: false,
      conversionTarget: 'homebrew-draft',
      autoSubmit: false,
      autoApprove: false,
      autoPublish: false
    }
  };
}

function audit(action, proposal, metadata = {}) {
  const entry = refs.configStore.appendDndAudit({
    action,
    outcome: 'success',
    actorId: actorId(),
    campaignId: proposal?.campaignId,
    targetId: proposal?.id,
    metadata
  });
  refs.logger?.write?.('info', `D&D: ${action}`, {
    campaignId: entry.campaignId,
    targetId: entry.targetId,
    ...metadata
  }, 'dnd');
  return entry;
}

async function broadcast(campaignId = '') {
  const value = await publicPayload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:ai-homebrew-update', value);
  }
  return value;
}

async function generate(input = {}, fetchImpl = global.fetch) {
  const preview = previewHomebrewRequest(input);
  const settings = refs.configStore.getDndCoDmSettings();
  const service = await checkService({ force: true, fetchImpl });
  if (!service.reachable) throw Object.assign(new Error(service.error || 'Khaos Nexus AI is unavailable.'), { code: 'DND_AI_SERVICE_UNAVAILABLE', retryable: true });
  const token = refs.configStore.getDndAiServiceToken();
  const { payload } = await callAiService(settings.serviceEndpoint, AI_HOMEBREW_PATH, {
    method: 'POST',
    body: preview.request,
    token,
    fetchImpl
  });
  const response = parseHomebrewResponse(payload);
  const proposal = refs.configStore.saveDndAiHomebrewProposal(proposalFromGeneration({
    campaignId: preview.campaignId,
    request: preview.request,
    response
  }));
  audit('ai-homebrew.generated', proposal, proposalAuditMetadata(proposal));
  return {
    proposal,
    preview: { ...preview, request: undefined },
    state: await broadcast(preview.campaignId)
  };
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth || !refs.logger) return false;
  registered = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd:ai-homebrew-get', async (_event, input = {}) => {
    assertOwner('View AI homebrew proposals');
    return publicPayload(input.campaignId, { refreshService: Boolean(input.refreshService) });
  });

  ipc.handle('dnd:ai-homebrew-preview', (_event, input = {}) => {
    assertOwner('Preview an AI homebrew request');
    return previewHomebrewRequest(input);
  });

  ipc.handle('dnd:ai-homebrew-generate', (_event, input = {}) => {
    assertOwner('Generate an AI homebrew proposal');
    return generate(input);
  });

  ipc.handle('dnd:ai-homebrew-delete', async (_event, input = {}) => {
    assertOwner('Delete an AI homebrew proposal');
    const state = refs.configStore.getDndState();
    ensureHomebrewProposalState(state);
    const proposal = state.aiHomebrewProposals.find((item) => item.id === input.proposalId);
    const removed = refs.configStore.removeDndAiHomebrewProposal(cleanLine(input.proposalId, 100));
    if (removed && proposal) audit('ai-homebrew.deleted', proposal, proposalAuditMetadata(proposal));
    return { removed, state: await broadcast(proposal?.campaignId || input.campaignId) };
  });

  ipc.handle('dnd:ai-homebrew-convert', async (_event, input = {}) => {
    assertOwner('Convert an AI homebrew proposal into a draft');
    const result = refs.configStore.convertDndAiHomebrewProposal(input);
    audit('ai-homebrew.converted-to-draft', result.proposal, {
      ...proposalAuditMetadata(result.proposal),
      homebrewId: result.homebrew.id,
      status: result.homebrew.status,
      acknowledgedOriginality: Boolean(input.acknowledgedOriginality)
    });
    refs.supervisor?.pushDndConfig?.();
    return { result, state: await broadcast(result.proposal.campaignId) };
  });

  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  registerTimer.unref?.();
}

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-ai-homebrew.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-ai-homebrew.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
        await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
      } catch (error) {
        refs.logger?.error?.('D&D AI homebrew assets failed to load.', { message: error.message });
      }
    });
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAssets();
  scheduleRegister();
}

module.exports = {
  install,
  publicPayload,
  generate,
  proposalsForCampaign
};
