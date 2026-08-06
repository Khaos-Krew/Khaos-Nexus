'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const aiGm = require('./dnd-ai-gm-extension.cjs');

const ENABLE_PHRASE = 'ENABLE D&D RUNTIME PREVIEW';
const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let timer = null;

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const actorId = () => String(refs.discordAuth?.getState?.().user?.id || 'local-owner');
const currentRole = () => {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
};

function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  return true;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndCampaignRuntime) return;
  class DndCampaignRuntimeStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { runtime.ensureCampaignRuntimeState(state); return true; });
      scheduleRegister();
    }
    mutateCampaignRuntime(mutator) {
      return this.mutateDnd((state) => { runtime.ensureCampaignRuntimeState(state); return mutator(state); });
    }
  }
  Object.defineProperty(DndCampaignRuntimeStore, '__khaosDndCampaignRuntime', { value: true });
  target.ConfigStore = DndCampaignRuntimeStore;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndCampaignRuntimeCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndCampaignRuntimeCapture', { value: true });
  target[exportName] = Captured;
}

function campaignPayload(campaignId = '') {
  const state = refs.configStore.getDndState();
  runtime.ensureCampaignRuntimeState(state);
  const selected = String(campaignId || '').trim() || state.campaigns?.find((item) => item.active !== false)?.id || '';
  const campaignFilter = (list) => clone((list || []).filter((item) => !selected || item.campaignId === selected));
  return {
    role: currentRole(),
    selectedCampaignId: selected,
    campaigns: (state.campaigns || []).filter((item) => item.active !== false).map((item) => ({ id: item.id, name: item.name, status: item.status })),
    gate: { ...clone(state.runtimeGate), releaseAuthorized: false },
    profiles: campaignFilter(state.playProfiles), seats: campaignFilter(state.playerSeats),
    runs: campaignFilter(state.campaignRuns), scenes: campaignFilter(state.scenes), turns: campaignFilter(state.turnCycles),
    checkpoints: campaignFilter(state.checkpoints).map((item) => ({ id: item.id, campaignId: item.campaignId, runId: item.runId, label: item.label, createdAt: item.createdAt, createdBy: item.createdBy })),
    recentEvents: campaignFilter(state.stateEvents).slice(-50),
    policy: {
      privateDevelopmentOnly: true, releaseAuthorized: false, enablePhrase: ENABLE_PHRASE,
      automaticDiscordPublication: false, automaticMechanicalEvents: false,
      veyraDirectStorageAccess: false, nexusSentinelCampaignAccess: false
    }
  };
}

function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const payload = campaignPayload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:campaign-runtime-update', payload);
  }
  return payload;
}

function mutate(action, input, fn) {
  let result;
  refs.configStore.mutateCampaignRuntime((state) => { result = fn(state); return true; });
  refs.configStore.appendDndAudit?.({
    action: `campaign-runtime.${action}`, outcome: 'success', actorId: actorId(),
    campaignId: String(input?.campaignId || result?.campaignId || '').slice(0, 100),
    targetId: String(result?.id || input?.id || input?.turnCycleId || '').slice(0, 100),
    metadata: { privateDevelopmentOnly: true, releaseAuthorized: false }
  });
  return result;
}

function enablePreview(input = {}) {
  if (String(input.confirmation || '') !== ENABLE_PHRASE) throw Object.assign(new Error(`Type ${ENABLE_PHRASE} exactly to enable the private preview.`), { code: 'CONFIRMATION_REQUIRED' });
  const gate = mutate('preview-enabled', input, (state) => runtime.enableOwnerPreview(state, actorId()));
  return { gate, state: push(input.campaignId) };
}

function profileUpsert(input = {}) {
  const profile = mutate('profile-upserted', input, (state) => runtime.upsertPlayProfile(state, input));
  return { profile, state: push(profile.campaignId) };
}
function seatUpsert(input = {}) {
  const seat = mutate('seat-upserted', input, (state) => runtime.upsertPlayerSeat(state, input));
  return { seat, state: push(seat.campaignId) };
}
function runStart(input = {}) {
  const run = mutate('run-started', input, (state) => runtime.startCampaignRun(state, { ...input, actorId: actorId() }));
  return { run, state: push(run.campaignId) };
}
function sceneStart(input = {}) {
  const scene = mutate('scene-started', input, (state) => runtime.startScene(state, { ...input, actorId: actorId() }));
  return { scene, state: push(scene.campaignId) };
}
function turnOpen(input = {}) {
  const turn = mutate('turn-opened', input, (state) => runtime.openTurnCycle(state, input));
  return { turn, state: push(turn.campaignId) };
}
function actionSubmit(input = {}) {
  const result = mutate('action-submitted', input, (state) => runtime.submitTurnAction(state, input));
  return { ...result, state: push(input.campaignId) };
}
function actionLock(input = {}) {
  const result = mutate('action-locked', input, (state) => runtime.lockTurnAction(state, input));
  return { ...result, state: push(input.campaignId) };
}
function checkpointCreate(input = {}) {
  const checkpoint = mutate('checkpoint-created', input, (state) => runtime.createCheckpoint(state, { ...input, createdBy: actorId() }));
  return { checkpoint, state: push(checkpoint.campaignId) };
}
function checkpointRestore(input = {}) {
  if (input.confirmed !== true) throw Object.assign(new Error('Confirm before restoring this campaign checkpoint.'), { code: 'CONFIRMATION_REQUIRED' });
  const checkpoint = mutate('checkpoint-restored', input, (state) => runtime.restoreCheckpoint(state, input.checkpointId, { actorId: actorId() }));
  return { checkpoint, state: push(checkpoint.campaignId) };
}
function eventAppend(input = {}) {
  const result = mutate('event-appended', input, (state) => runtime.appendStateEvent(state, { ...input, actorId: actorId() }));
  return { ...result, state: push(input.campaignId) };
}

function proposalFromAiTurn(turn = {}) {
  const response = turn.response || {};
  const stateUpdates = response.stateUpdates || {};
  const proposedEvents = [];
  if (stateUpdates.currentScene) proposedEvents.push({ type: 'scene.updated', payload: { publicDescription: stateUpdates.currentScene } });
  for (const text of stateUpdates.addWorldFacts || []) proposedEvents.push({ type: 'knowledge.learned', payload: { text, visibility: 'party' } });
  return {
    narration: response.narration,
    npcDialogue: response.spokenDialogue || [], proposedChecks: response.suggestedChecks || [],
    proposedEvents, choices: response.choices || [], safety: response.safety || { status: 'ok', reason: '' }
  };
}

async function resolveTurn(input = {}) {
  let envelope;
  let turn;
  let aiSession;
  refs.configStore.mutateCampaignRuntime((state) => {
    turn = runtime.markTurnResolving(state, input.turnCycleId);
    envelope = runtime.buildVeyraRuntimeEnvelope(state, {
      campaignId: turn.campaignId, runId: turn.runId, sceneId: turn.sceneId, turnCycleId: turn.id
    });
    aiSession = (state.aiGmSessions || []).find((item) => item.campaignId === turn.campaignId && item.mode !== 'ended');
    return true;
  });
  if (!aiSession) throw Object.assign(new Error('Start an explicit Veyra AI Game Master session before resolving runtime turns.'), { code: 'DND_AI_GM_SESSION_REQUIRED' });
  try {
    const generated = await aiGm.submitTurn({
      aiGmSessionId: aiSession.id, actor: 'Party',
      message: JSON.stringify({ scene: envelope.scene, actions: envelope.actions }),
      dmGuidance: 'Narrate only. Preserve player agency. Propose no mechanical state changes.',
      clientTurnId: input.clientTurnId || `${turn.id}:veyra`, confirmed: true
    });
    let completed;
    refs.configStore.mutateCampaignRuntime((state) => {
      const proposal = runtime.validateVeyraProposal(proposalFromAiTurn(generated.turn), {
        playerCharacters: envelope.characters
      });
      const profile = state.playProfiles.find((item) => item.campaignId === turn.campaignId);
      if (profile?.automation?.applyNarrativeEvents) {
        for (const [index, event] of proposal.proposedEvents.entries()) {
          runtime.appendStateEvent(state, {
            campaignId: turn.campaignId, runId: turn.runId, sceneId: turn.sceneId, turnCycleId: turn.id,
            type: event.type, actorType: 'veyra_validated', actorId: 'veyra',
            idempotencyKey: `${turn.id}:narrative:${index}`, payload: { ...event.payload, sceneId: turn.sceneId }
          });
        }
      }
      completed = runtime.completeTurnCycle(state, turn.id, { ...proposal, veyraTurnId: generated.turn.id });
      runtime.createCheckpoint(state, { campaignId: turn.campaignId, runId: turn.runId, label: `After turn ${turn.id}`, createdBy: 'runtime' });
      return true;
    });
    refs.configStore.appendDndAudit?.({
      action: 'campaign-runtime.turn-resolved', outcome: 'success', actorId: actorId(), campaignId: turn.campaignId,
      targetId: turn.id, metadata: { veyraTurnId: generated.turn.id, releaseAuthorized: false }
    });
    return { turn: completed, state: push(turn.campaignId) };
  } catch (error) {
    refs.configStore.mutateCampaignRuntime((state) => {
      const current = state.turnCycles.find((item) => item.id === turn.id);
      if (current) { current.status = 'locked'; current.error = String(error.message || error).slice(0, 1000); current.updatedAt = new Date().toISOString(); }
      return true;
    });
    push(turn.campaignId);
    throw error;
  }
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:campaign-runtime-get', (_event, input = {}) => { assertOwner('View D&D campaign runtime'); return campaignPayload(input.campaignId); });
  ipc.handle('dnd:campaign-runtime-enable', (_event, input = {}) => { assertOwner('Enable D&D runtime preview'); return enablePreview(input); });
  ipc.handle('dnd:campaign-runtime-profile-upsert', (_event, input = {}) => { assertOwner('Configure D&D runtime profile'); return profileUpsert(input); });
  ipc.handle('dnd:campaign-runtime-seat-upsert', (_event, input = {}) => { assertOwner('Configure D&D runtime seat'); return seatUpsert(input); });
  ipc.handle('dnd:campaign-runtime-run-start', (_event, input = {}) => { assertOwner('Start D&D campaign run'); return runStart(input); });
  ipc.handle('dnd:campaign-runtime-scene-start', (_event, input = {}) => { assertOwner('Start D&D campaign scene'); return sceneStart(input); });
  ipc.handle('dnd:campaign-runtime-turn-open', (_event, input = {}) => { assertOwner('Open D&D runtime turn'); return turnOpen(input); });
  ipc.handle('dnd:campaign-runtime-action-submit', (_event, input = {}) => { assertOwner('Submit D&D runtime action'); return actionSubmit(input); });
  ipc.handle('dnd:campaign-runtime-action-lock', (_event, input = {}) => { assertOwner('Lock D&D runtime action'); return actionLock(input); });
  ipc.handle('dnd:campaign-runtime-turn-resolve', (_event, input = {}) => { assertOwner('Resolve D&D runtime turn'); return resolveTurn(input); });
  ipc.handle('dnd:campaign-runtime-event-append', (_event, input = {}) => { assertOwner('Apply D&D runtime event'); return eventAppend(input); });
  ipc.handle('dnd:campaign-runtime-checkpoint-create', (_event, input = {}) => { assertOwner('Create D&D runtime checkpoint'); return checkpointCreate(input); });
  ipc.handle('dnd:campaign-runtime-checkpoint-restore', (_event, input = {}) => { assertOwner('Restore D&D runtime checkpoint'); return checkpointRestore(input); });
  ipc.handle('dnd:campaign-runtime-roll-check', (_event, input = {}) => { assertOwner('Resolve D&D ability check'); return runtime.resolveAbilityCheck(input); });
  ipc.handle('dnd:campaign-runtime-roll-damage', (_event, input = {}) => { assertOwner('Resolve D&D damage'); return runtime.resolveDamage(input); });
  return true;
}

function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-campaign-runtime.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-campaign-runtime.js');
  electron.app.on('browser-window-created', (_event, window) => window.webContents.on('did-finish-load', async () => {
    try {
      await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
      await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
    } catch (error) { refs.logger?.error?.('D&D campaign runtime assets failed to load.', { message: error.message }); }
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

module.exports = {
  ENABLE_PHRASE, install, campaignPayload, enablePreview, profileUpsert, seatUpsert, runStart, sceneStart,
  turnOpen, actionSubmit, actionLock, resolveTurn, eventAppend, checkpointCreate, checkpointRestore,
  releaseAuthorized: false
};
