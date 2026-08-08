'use strict';

const runtime = require('./dnd-campaign-runtime.cjs');

const GROUP_MODES = new Set(['group_ai_dm', 'human_dm', 'human_dm_with_ai', 'hybrid']);
const PACES = new Set(['live', 'asynchronous', 'mixed']);
const RESOLUTION_POLICIES = new Set(['all_required', 'majority', 'party_leader', 'deadline', 'human_dm']);
const ABSENCE_POLICIES = new Set(['background', 'ai_conservative', 'temporary_controller', 'leave_scene', 'pause']);

function ensureGroupState(state = {}) {
  runtime.ensureCampaignRuntimeState(state);
  for (const key of ['groupSessions', 'groupRounds', 'groupDecisions', 'groupDeliveries']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  return state;
}

const groupSessionById = (state, sessionId) => state.groupSessions.find((item) => item.id === sessionId);
const groupRoundById = (state, roundId) => state.groupRounds.find((item) => item.id === roundId);
const activeGroupSession = (state, campaignId) => state.groupSessions.find((item) => item.campaignId === campaignId && item.status === 'active');

function participantFromSeat(state, campaignId, seatId, input = {}) {
  const seat = state.playerSeats.find((item) => item.id === seatId && item.campaignId === campaignId && item.active !== false);
  if (!seat) runtime.fail(`Active player seat ${seatId} was not found.`, 'DND_GROUP_SEAT_NOT_FOUND');
  if (!['human_player', 'human_dm', 'assistant_dm', 'ai_companion'].includes(seat.type)) runtime.fail('Viewer seats cannot join active group play.', 'DND_GROUP_SEAT_NOT_PLAYABLE');
  return {
    seatId: seat.id,
    characterId: seat.characterId || '',
    displayName: seat.displayName,
    seatType: seat.type,
    discordUserId: runtime.clean(input.discordUserId, 100),
    status: input.status === 'absent' ? 'absent' : 'active',
    ready: input.ready === true,
    temporaryControllerSeatId: runtime.clean(input.temporaryControllerSeatId, 100),
    lastAcknowledgedRoundId: '',
    joinedAt: runtime.nowIso(),
    updatedAt: runtime.nowIso()
  };
}

function startGroupSession(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const campaignId = runtime.clean(input.campaignId, 100);
  const profile = state.playProfiles.find((item) => item.campaignId === campaignId && item.enabled);
  if (!profile || !GROUP_MODES.has(profile.mode)) runtime.fail('Enable a group-capable play profile first.', 'DND_GROUP_PROFILE_REQUIRED');
  const existing = activeGroupSession(state, campaignId);
  if (existing) return { session: runtime.clone(existing), duplicate: true };
  const requested = [...new Set((input.participants || []).map((item) => runtime.clean(item.seatId, 100)).filter(Boolean))];
  if (requested.length < 2 || requested.length > 6) runtime.fail('Group play requires two to six participant seats.', 'DND_GROUP_PARTICIPANT_COUNT');
  const participantInput = new Map((input.participants || []).map((item) => [runtime.clean(item.seatId, 100), item]));
  const participants = requested.map((seatId) => participantFromSeat(state, campaignId, seatId, participantInput.get(seatId)));
  const humanPlayers = participants.filter((item) => item.seatType === 'human_player');
  if (humanPlayers.length < 2 && profile.mode === 'group_ai_dm') runtime.fail('AI-DM group play requires at least two human player seats.', 'DND_GROUP_HUMAN_PLAYERS_REQUIRED');
  const run = state.campaignRuns.find((item) => item.id === input.runId && item.campaignId === campaignId && item.status === 'active');
  const scene = state.scenes.find((item) => item.id === input.sceneId && item.campaignId === campaignId && item.status === 'active');
  if (!run || !scene || scene.runId !== run.id) runtime.fail('An active campaign run and scene are required.', 'DND_GROUP_SCENE_REQUIRED');
  const leaderSeatId = runtime.clean(input.partyLeaderSeatId, 100) || humanPlayers[0]?.seatId || participants[0].seatId;
  if (!participants.some((item) => item.seatId === leaderSeatId)) runtime.fail('Party leader must be an active participant.', 'DND_GROUP_LEADER_INVALID');
  const clientSessionId = runtime.clean(input.clientSessionId, 160);
  const session = {
    id: runtime.makeId('group_session'), clientSessionId, campaignId, runId: run.id, sceneId: scene.id,
    status: 'active', pace: PACES.has(input.pace) ? input.pace : profile.pace || 'mixed',
    resolutionPolicy: RESOLUTION_POLICIES.has(input.resolutionPolicy) ? input.resolutionPolicy : profile.groupResolution || 'all_required',
    absencePolicy: ABSENCE_POLICIES.has(input.absencePolicy) ? input.absencePolicy : profile.absencePolicy || 'background',
    partyLeaderSeatId: leaderSeatId, participants, currentRoundId: '', roundNumber: 0,
    defaultDeadlineHours: Math.max(1, Math.min(168, Number(input.defaultDeadlineHours || 24))),
    discordBindingId: runtime.clean(input.discordBindingId, 100),
    automaticDiscordPublication: false, releaseAuthorized: false,
    startedBy: runtime.clean(input.actorId, 100), startedAt: runtime.nowIso(), updatedAt: runtime.nowIso()
  };
  state.groupSessions.push(session);
  return { session: runtime.clone(session), duplicate: false };
}

function setParticipantStatus(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const session = groupSessionById(state, input.sessionId);
  if (!session || session.status !== 'active') runtime.fail('Active group session not found.', 'DND_GROUP_SESSION_NOT_FOUND');
  const participant = session.participants.find((item) => item.seatId === input.seatId);
  if (!participant) runtime.fail('Group participant not found.', 'DND_GROUP_PARTICIPANT_NOT_FOUND');
  const status = ['active', 'absent', 'left'].includes(input.status) ? input.status : 'active';
  participant.status = status;
  participant.ready = input.ready === true;
  participant.temporaryControllerSeatId = runtime.clean(input.temporaryControllerSeatId, 100);
  if (participant.temporaryControllerSeatId && !session.participants.some((item) => item.seatId === participant.temporaryControllerSeatId && item.status === 'active')) {
    runtime.fail('Temporary controller must be an active participant.', 'DND_GROUP_CONTROLLER_INVALID');
  }
  participant.updatedAt = runtime.nowIso();
  session.updatedAt = runtime.nowIso();
  return runtime.clone(participant);
}

function effectiveRequiredSeats(session, input = {}) {
  const requested = [...new Set((input.requiredSeatIds || []).map((item) => runtime.clean(item, 100)).filter(Boolean))];
  const candidates = session.participants.filter((item) => item.status !== 'left' && item.seatType !== 'human_dm' && item.seatType !== 'assistant_dm');
  const selected = requested.length ? candidates.filter((item) => requested.includes(item.seatId)) : candidates;
  const required = [];
  for (const participant of selected) {
    if (participant.status === 'active') required.push(participant.seatId);
    else if (participant.status === 'absent') {
      if (session.absencePolicy === 'pause') runtime.fail('The group session is paused because a required participant is absent.', 'DND_GROUP_ABSENCE_PAUSE');
      if (session.absencePolicy === 'temporary_controller' && participant.temporaryControllerSeatId) required.push(participant.temporaryControllerSeatId);
      if (session.absencePolicy === 'ai_conservative' && participant.seatType === 'human_player') required.push(participant.seatId);
    }
  }
  return [...new Set(required)];
}

function openGroupRound(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const session = groupSessionById(state, input.sessionId);
  if (!session || session.status !== 'active') runtime.fail('Active group session not found.', 'DND_GROUP_SESSION_NOT_FOUND');
  if (state.groupRounds.some((item) => item.sessionId === session.id && ['collecting', 'locked', 'resolving'].includes(item.status))) runtime.fail('Resolve the active group round before opening another.', 'DND_GROUP_ROUND_ACTIVE');
  const clientRoundId = runtime.clean(input.clientRoundId, 160);
  if (clientRoundId) {
    const duplicate = state.groupRounds.find((item) => item.sessionId === session.id && item.clientRoundId === clientRoundId);
    if (duplicate) return { round: runtime.clone(duplicate), duplicate: true };
  }
  const requiredSeatIds = effectiveRequiredSeats(session, input);
  if (!requiredSeatIds.length && session.resolutionPolicy !== 'human_dm') runtime.fail('At least one active participant is required.', 'DND_GROUP_NO_REQUIRED_PARTICIPANTS');
  const deadlineHours = Math.max(1, Math.min(168, Number(input.deadlineHours || session.defaultDeadlineHours)));
  const deadlineAt = session.pace === 'live' ? '' : new Date(Date.now() + deadlineHours * 3600000).toISOString();
  const round = {
    id: runtime.makeId('group_round'), clientRoundId, campaignId: session.campaignId, sessionId: session.id,
    runId: session.runId, sceneId: session.sceneId, number: session.roundNumber + 1,
    status: 'collecting', prompt: runtime.clean(input.prompt, 8000),
    requiredSeatIds, actions: [], resolutionPolicy: session.resolutionPolicy,
    deadlineAt, openedAt: runtime.nowIso(), updatedAt: runtime.nowIso(), resolvedAt: '', result: null
  };
  state.groupRounds.push(round);
  session.currentRoundId = round.id;
  session.roundNumber = round.number;
  session.updatedAt = runtime.nowIso();
  return { round: runtime.clone(round), duplicate: false };
}

function submitGroupAction(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const round = groupRoundById(state, input.roundId);
  if (!round || !['collecting', 'locked'].includes(round.status)) runtime.fail('Group round is not accepting actions.', 'DND_GROUP_ROUND_CLOSED');
  const session = groupSessionById(state, round.sessionId);
  const seatId = runtime.clean(input.seatId, 100);
  const participant = session?.participants.find((item) => item.seatId === seatId && item.status !== 'left');
  if (!participant) runtime.fail('Active group participant not found.', 'DND_GROUP_PARTICIPANT_NOT_FOUND');
  const clientActionId = runtime.clean(input.clientActionId, 160) || runtime.makeId('group_client_action');
  const duplicate = round.actions.find((item) => item.clientActionId === clientActionId);
  if (duplicate) return { action: runtime.clone(duplicate), duplicate: true };
  if (round.actions.some((item) => item.seatId === seatId && item.status !== 'withdrawn')) runtime.fail('This participant already submitted an action.', 'DND_GROUP_ACTION_EXISTS');
  const audience = ['party', 'dm_only'].includes(input.audience) ? input.audience : 'party';
  const action = {
    id: runtime.makeId('group_action'), clientActionId, seatId, characterId: participant.characterId,
    declaration: runtime.clean(input.declaration, 12000), privateGuidance: runtime.clean(input.privateGuidance, 4000),
    audience, status: input.locked === true ? 'locked' : 'submitted',
    submittedAt: runtime.nowIso(), lockedAt: input.locked === true ? runtime.nowIso() : ''
  };
  if (!action.declaration) runtime.fail('Action declaration is required.', 'DND_GROUP_ACTION_REQUIRED');
  round.actions.push(action);
  round.updatedAt = runtime.nowIso();
  updateRoundLockState(session, round);
  return { action: runtime.clone(action), duplicate: false };
}

function lockGroupAction(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const round = groupRoundById(state, input.roundId);
  const action = round?.actions.find((item) => item.id === input.actionId);
  if (!round || !action || round.status === 'resolved') runtime.fail('Group action not found.', 'DND_GROUP_ACTION_NOT_FOUND');
  action.status = 'locked';
  action.lockedAt = runtime.nowIso();
  round.updatedAt = runtime.nowIso();
  const session = groupSessionById(state, round.sessionId);
  return { action: runtime.clone(action), readiness: updateRoundLockState(session, round) };
}

function roundReadiness(session, round, now = new Date()) {
  const lockedSeatIds = new Set(round.actions.filter((item) => item.status === 'locked').map((item) => item.seatId));
  const required = round.requiredSeatIds;
  const lockedRequired = required.filter((seatId) => lockedSeatIds.has(seatId));
  const deadlineReached = Boolean(round.deadlineAt && now >= new Date(round.deadlineAt));
  let ready = false;
  if (round.resolutionPolicy === 'all_required') ready = required.every((seatId) => lockedSeatIds.has(seatId));
  if (round.resolutionPolicy === 'majority') ready = lockedRequired.length > required.length / 2;
  if (round.resolutionPolicy === 'party_leader') ready = lockedSeatIds.has(session.partyLeaderSeatId);
  if (round.resolutionPolicy === 'deadline') ready = deadlineReached && lockedRequired.length > 0;
  if (round.resolutionPolicy === 'human_dm') ready = false;
  return { ready, lockedRequired: lockedRequired.length, required: required.length, deadlineReached, missingSeatIds: required.filter((seatId) => !lockedSeatIds.has(seatId)) };
}

function updateRoundLockState(session, round, now = new Date()) {
  const readiness = roundReadiness(session, round, now);
  if (readiness.ready) round.status = 'locked';
  else if (round.status !== 'resolving') round.status = 'collecting';
  return readiness;
}

function forceLockRound(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const round = groupRoundById(state, input.roundId);
  const session = round && groupSessionById(state, round.sessionId);
  if (!round || !session || !['collecting', 'locked'].includes(round.status)) runtime.fail('Open group round not found.', 'DND_GROUP_ROUND_NOT_FOUND');
  const readiness = roundReadiness(session, round, input.now ? new Date(input.now) : new Date());
  if (!readiness.ready && input.humanDmOverride !== true) runtime.fail('The group round is not ready to resolve.', 'DND_GROUP_ROUND_NOT_READY');
  round.status = 'locked';
  round.updatedAt = runtime.nowIso();
  return { round: runtime.clone(round), readiness };
}

function buildGroupVeyraEnvelope(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const round = groupRoundById(state, input.roundId);
  const session = round && groupSessionById(state, round.sessionId);
  if (!round || !session || round.status !== 'locked') runtime.fail('A locked group round is required.', 'DND_GROUP_ROUND_NOT_LOCKED');
  const publicActions = round.actions.filter((item) => item.status === 'locked' && item.audience === 'party').map((item) => ({ seatId: item.seatId, characterId: item.characterId, declaration: item.declaration }));
  const privateActions = round.actions.filter((item) => item.status === 'locked' && item.audience === 'dm_only').map((item) => ({ seatId: item.seatId, characterId: item.characterId, declaration: item.declaration, privateGuidance: item.privateGuidance }));
  const campaign = (state.campaigns || []).find((item) => item.id === round.campaignId);
  const run = state.campaignRuns.find((item) => item.id === round.runId);
  const scene = state.scenes.find((item) => item.id === round.sceneId);
  const participantCharacterIds = session.participants.filter((item) => item.status !== 'left').map((item) => item.characterId).filter(Boolean);
  const characters = (state.characters || []).filter((item) => participantCharacterIds.includes(item.id)).map((item) => ({
    id: item.id, name: item.name, level: item.level, className: item.className, hp: item.hp, maxHp: item.maxHp,
    armorClass: item.armorClass, conditions: runtime.clone(item.conditions || [])
  }));
  const knowledge = state.knowledgeRecords.filter((item) => item.campaignId === round.campaignId && item.visibility === 'party').map((item) => ({ text: item.text, visibility: item.visibility }));
  return {
    schema: 'khaos-nexus.dnd-group-runtime.v1',
    session: { id: session.id, pace: session.pace, resolutionPolicy: session.resolutionPolicy, absencePolicy: session.absencePolicy },
    round: { id: round.id, number: round.number, prompt: round.prompt, deadlineAt: round.deadlineAt },
    campaign: { id: round.campaignId, name: campaign?.name || '' },
    run: { id: run?.id || '', worldTime: run?.worldTime || '', branch: run?.branch || '' },
    scene: { id: scene?.id || '', locationName: scene?.locationName || '', publicDescription: scene?.publicDescription || '', worldTime: scene?.worldTime || '' },
    characters, knowledge,
    publicActions, privateActions,
    safety: { preservePlayerAgency: true, keepPrivateActionsPrivate: true, publishDiscord: false, releaseAuthorized: false }
  };
}

function completeGroupRound(state, input = {}) {
  ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const round = groupRoundById(state, input.roundId);
  const session = round && groupSessionById(state, round.sessionId);
  if (!round || !session || !['locked', 'resolving'].includes(round.status)) runtime.fail('Locked group round not found.', 'DND_GROUP_ROUND_NOT_LOCKED');
  round.status = 'resolved';
  round.result = runtime.clone(input.result || {});
  round.resolvedAt = runtime.nowIso();
  round.updatedAt = runtime.nowIso();
  session.currentRoundId = '';
  session.updatedAt = runtime.nowIso();
  return runtime.clone(round);
}

module.exports = {
  runtime, GROUP_MODES, PACES, RESOLUTION_POLICIES, ABSENCE_POLICIES,
  ensureGroupState, groupSessionById, groupRoundById, activeGroupSession,
  startGroupSession, setParticipantStatus, openGroupRound, submitGroupAction,
  lockGroupAction, roundReadiness, forceLockRound, buildGroupVeyraEnvelope, completeGroupRound
};
