'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const group = require('../shared/dnd-group-runtime.cjs');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const aiGm = require('./dnd-ai-gm-extension.cjs');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

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
  if (!Original || Original.__khaosDndGroupRuntime) return;
  class DndGroupRuntimeStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      this.mutateDnd((state) => { group.ensureGroupState(state); return true; });
      scheduleRegister();
    }
    mutateGroupRuntime(mutator) {
      return this.mutateDnd((state) => { group.ensureGroupState(state); return mutator(state); });
    }
  }
  Object.defineProperty(DndGroupRuntimeStore, '__khaosDndGroupRuntime', { value: true });
  target.ConfigStore = DndGroupRuntimeStore;
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndGroupRuntimeCapture) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndGroupRuntimeCapture', { value: true });
  target[exportName] = Captured;
}
function payload(campaignId = '') {
  const state = refs.configStore.getDndState();
  group.ensureGroupState(state);
  const selected = String(campaignId || '').trim() || state.campaigns?.find((item) => item.active !== false)?.id || '';
  const filter = (list) => clone((list || []).filter((item) => !selected || item.campaignId === selected));
  return {
    role: currentRole(), selectedCampaignId: selected,
    seats: filter(state.playerSeats).filter((item) => item.active !== false), profiles: filter(state.playProfiles),
    runs: filter(state.campaignRuns), scenes: filter(state.scenes),
    sessions: filter(state.groupSessions), rounds: filter(state.groupRounds), decisions: filter(state.groupDecisions),
    deliveries: filter(state.groupDeliveries).slice(-100),
    policy: { privateDevelopmentOnly: false, releaseAuthorized: true, automaticDiscordPublication: false, existingDiscordBindingsOnly: true }
  };
}
function push(campaignId = '') {
  refs.supervisor?.pushDndConfig?.();
  const next = payload(campaignId);
  for (const window of electron.BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('dnd:group-runtime-update', next);
  }
  return next;
}
function mutate(action, input, fn) {
  let result;
  refs.configStore.mutateGroupRuntime((state) => { result = fn(state); return true; });
  refs.configStore.appendDndAudit?.({
    action: `group-runtime.${action}`, outcome: 'success', actorId: actorId(),
    campaignId: String(input?.campaignId || result?.campaignId || result?.session?.campaignId || '').slice(0, 100),
    targetId: String(result?.id || result?.session?.id || result?.round?.id || input?.roundId || '').slice(0, 100),
    metadata: { privateDevelopmentOnly: false, automaticDiscordPublication: false, releaseAuthorized: true }
  });
  return result;
}
function aiProposal(turn = {}) {
  const response = turn.response || {};
  return runtime.validateVeyraProposal({
    narration: response.narration,
    npcDialogue: response.spokenDialogue || [],
    proposedChecks: response.suggestedChecks || [],
    proposedEvents: [],
    choices: response.choices || [],
    safety: response.safety || { status: 'ok', reason: '' }
  }, { playerCharacters: [] });
}
async function resolveRound(input = {}) {
  let envelope;
  let round;
  let session;
  let aiSession;
  refs.configStore.mutateGroupRuntime((state) => {
    const locked = group.forceLockRound(state, { roundId: input.roundId, humanDmOverride: input.humanDmOverride === true });
    round = state.groupRounds.find((item) => item.id === locked.round.id);
    session = state.groupSessions.find((item) => item.id === round.sessionId);
    round.status = 'resolving';
    round.updatedAt = runtime.nowIso();
    envelope = group.buildGroupVeyraEnvelope(state, { roundId: round.id });
    aiSession = (state.aiGmSessions || []).find((item) => item.campaignId === round.campaignId && item.mode !== 'ended');
    return true;
  });
  if (!aiSession) {
    refs.configStore.mutateGroupRuntime((state) => {
      const current = state.groupRounds.find((item) => item.id === round.id);
      if (current) { current.status = 'locked'; current.error = 'An explicit Veyra AI Game Master session is required.'; current.updatedAt = runtime.nowIso(); }
      return true;
    });
    push(round.campaignId);
    throw Object.assign(new Error('Start an explicit Veyra AI Game Master session before resolving group rounds.'), { code: 'DND_AI_GM_SESSION_REQUIRED' });
  }
  try {
    const generated = await aiGm.submitTurn({
      aiGmSessionId: aiSession.id,
      actor: 'Party',
      message: JSON.stringify({ round: envelope.round, scene: envelope.scene, publicActions: envelope.publicActions }),
      dmGuidance: `Narrate only the party-visible declarations. Do not infer or reveal private actions. ${envelope.privateActions.length} private declaration(s) remain DM-only. Preserve player agency and propose no mechanical mutations.`,
      clientTurnId: input.clientTurnId || `${round.id}:veyra`,
      confirmed: true
    });
    let completed;
    refs.configStore.mutateGroupRuntime((state) => {
      const proposal = aiProposal(generated.turn);
      completed = group.completeGroupRound(state, { roundId: round.id, result: { ...proposal, veyraTurnId: generated.turn.id } });
      group.queueDelivery(state, {
        sessionId: session.id, roundId: round.id, type: 'public_narration', audience: 'party',
        content: proposal.narration, clientDeliveryId: `${round.id}:public`, createdBy: 'veyra_validated'
      });
      if (envelope.privateActions.length) group.queueDelivery(state, {
        sessionId: session.id, roundId: round.id, type: 'private_action_review', audience: 'dm_only',
        content: `${envelope.privateActions.length} private player declaration(s) require separate DM review.`,
        clientDeliveryId: `${round.id}:private-review`, createdBy: 'runtime'
      });
      runtime.createCheckpoint(state, { campaignId: round.campaignId, runId: round.runId, label: `After group round ${round.number}`, createdBy: 'runtime' });
      return true;
    });
    return { round: completed, state: push(round.campaignId) };
  } catch (error) {
    refs.configStore.mutateGroupRuntime((state) => {
      const current = state.groupRounds.find((item) => item.id === round.id);
      if (current && current.status !== 'resolved') { current.status = 'locked'; current.error = String(error.message || error).slice(0, 1000); current.updatedAt = runtime.nowIso(); }
      return true;
    });
    push(round.campaignId);
    throw error;
  }
}
function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('dnd:group-runtime-get', (_event, input = {}) => { assertOwner('View D&D group runtime'); return payload(input.campaignId); });
  ipc.handle('dnd:group-session-start', (_event, input = {}) => { assertOwner('Start D&D group session'); const result = mutate('session-started', input, (state) => group.startGroupSession(state, { ...input, actorId: actorId() })); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-participant-status', (_event, input = {}) => { assertOwner('Update group participant'); const participant = mutate('participant-updated', input, (state) => group.setParticipantStatus(state, input)); return { participant, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-round-open', (_event, input = {}) => { assertOwner('Open group round'); const result = mutate('round-opened', input, (state) => group.openGroupRound(state, input)); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-action-submit', (_event, input = {}) => { assertOwner('Submit group action'); const result = mutate('action-submitted', input, (state) => group.submitGroupAction(state, input)); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-action-lock', (_event, input = {}) => { assertOwner('Lock group action'); const result = mutate('action-locked', input, (state) => group.lockGroupAction(state, input)); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-round-resolve', (_event, input = {}) => { assertOwner('Resolve group round'); return resolveRound(input); });
  ipc.handle('dnd:group-decision-start', (_event, input = {}) => { assertOwner('Start group decision'); const result = mutate('decision-started', input, (state) => group.startDecision(state, input)); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-vote-cast', (_event, input = {}) => { assertOwner('Cast group vote'); const result = mutate('vote-cast', input, (state) => group.castVote(state, input)); return { ...result, state: push(input.campaignId) }; });
  ipc.handle('dnd:group-delivery-review', (_event, input = {}) => { assertOwner('Review group delivery'); const delivery = mutate('delivery-reviewed', input, (state) => group.reviewDelivery(state, input)); return { delivery, state: push(input.campaignId) }; });
  return true;
}
function scheduleRegister() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  timer.unref?.();
}
function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-group-runtime',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-group-runtime.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-group-runtime.js')],
    source: 'dnd-group-runtime-extension.cjs'
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
module.exports = { install, payload, resolveRound, releaseAuthorized: true };
