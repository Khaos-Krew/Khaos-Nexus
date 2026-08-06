'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const group = require('../shared/dnd-group-runtime.cjs');

function preparedState(policy = 'all_required', absencePolicy = 'background') {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [],
    characters: [
      { id: 'c1', campaignId: 'campaign-1', name: 'Vorkesh', active: true, hp: 20, maxHp: 20, armorClass: 16, conditions: [] },
      { id: 'c2', campaignId: 'campaign-1', name: 'Asuna', active: true, hp: 18, maxHp: 18, armorClass: 15, conditions: [] },
      { id: 'c3', campaignId: 'campaign-1', name: 'Ember', active: true, hp: 14, maxHp: 14, armorClass: 14, conditions: [] }
    ],
    quests: [], aiGmSessions: []
  };
  group.ensureGroupState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, { campaignId: 'campaign-1', enabled: true, mode: 'group_ai_dm', pace: 'asynchronous', groupResolution: policy, absencePolicy });
  const seats = ['c1','c2','c3'].map((characterId, index) => runtime.upsertPlayerSeat(state, { campaignId: 'campaign-1', characterId, type: 'human_player', displayName: `Player ${index + 1}`, ready: true }));
  const run = runtime.startCampaignRun(state, { campaignId: 'campaign-1', actorId: 'owner', worldTime: 'Day 1' });
  const scene = runtime.startScene(state, { campaignId: 'campaign-1', runId: run.id, actorId: 'owner', locationName: 'Crossroads', publicDescription: 'Three roads split beneath a storm.', participantSeatIds: seats.map((item) => item.id) });
  const session = group.startGroupSession(state, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, participants: seats.map((item) => ({ seatId: item.id })), resolutionPolicy: policy, absencePolicy, actorId: 'owner', clientSessionId: 'session-1' }).session;
  return { state, seats, run, scene, session };
}

test('group sessions require two to six human player seats', () => {
  const { state, seats, run, scene } = preparedState();
  state.groupSessions = [];
  assert.throws(() => group.startGroupSession(state, { campaignId: 'campaign-1', runId: run.id, sceneId: scene.id, participants: [{ seatId: seats[0].id }] }), /two to six/);
});

test('all-required rounds lock only after every required declaration is locked', () => {
  const { state, seats, session } = preparedState('all_required');
  const round = group.openGroupRound(state, { sessionId: session.id, prompt: 'Choose a road.', clientRoundId: 'round-1' }).round;
  for (let index = 0; index < seats.length; index += 1) {
    const submitted = group.submitGroupAction(state, { roundId: round.id, seatId: seats[index].id, declaration: `Road ${index}`, clientActionId: `action-${index}` });
    const locked = group.lockGroupAction(state, { roundId: round.id, actionId: submitted.action.id });
    assert.equal(locked.readiness.ready, index === seats.length - 1);
  }
  assert.equal(state.groupRounds[0].status, 'locked');
});

test('majority and party-leader policies resolve with bounded participation', () => {
  const majority = preparedState('majority');
  const round = group.openGroupRound(majority.state, { sessionId: majority.session.id, prompt: 'Vote with actions.' }).round;
  for (const [index, seat] of majority.seats.slice(0, 2).entries()) {
    const action = group.submitGroupAction(majority.state, { roundId: round.id, seatId: seat.id, declaration: `Choice ${index}`, locked: true, clientActionId: `m-${index}` });
    assert.equal(action.duplicate, false);
  }
  assert.equal(majority.state.groupRounds[0].status, 'locked');

  const leader = preparedState('party_leader');
  const leaderRound = group.openGroupRound(leader.state, { sessionId: leader.session.id, prompt: 'Leader chooses.' }).round;
  group.submitGroupAction(leader.state, { roundId: leaderRound.id, seatId: leader.session.partyLeaderSeatId, declaration: 'Take the northern road.', locked: true, clientActionId: 'leader-action' });
  assert.equal(leader.state.groupRounds[0].status, 'locked');
});

test('deadline rounds require the deadline and at least one locked action', () => {
  const { state, seats, session } = preparedState('deadline');
  const round = group.openGroupRound(state, { sessionId: session.id, prompt: 'Respond by tomorrow.', deadlineHours: 1 }).round;
  group.submitGroupAction(state, { roundId: round.id, seatId: seats[0].id, declaration: 'Wait.', locked: true, clientActionId: 'deadline-action' });
  assert.equal(group.roundReadiness(session, state.groupRounds[0], new Date(round.deadlineAt)).ready, true);
  assert.equal(group.forceLockRound(state, { roundId: round.id, now: round.deadlineAt }).round.status, 'locked');
});

test('pause absence policy prevents opening a round while a participant is absent', () => {
  const { state, seats, session } = preparedState('all_required', 'pause');
  group.setParticipantStatus(state, { sessionId: session.id, seatId: seats[1].id, status: 'absent' });
  assert.throws(() => group.openGroupRound(state, { sessionId: session.id, prompt: 'Continue?' }), /paused/);
});

test('private declarations are separated from public Veyra actions and party knowledge', () => {
  const { state, seats, run, session } = preparedState('majority');
  state.knowledgeRecords.push({ id: 'party-fact', campaignId: 'campaign-1', runId: run.id, text: 'The bridge is broken.', visibility: 'party', characterIds: [] });
  state.knowledgeRecords.push({ id: 'secret', campaignId: 'campaign-1', runId: run.id, text: 'Vorkesh holds the hidden key.', visibility: 'selected_characters', characterIds: ['c1'] });
  const round = group.openGroupRound(state, { sessionId: session.id, prompt: 'What do you do?' }).round;
  group.submitGroupAction(state, { roundId: round.id, seatId: seats[0].id, declaration: 'I search the ruins.', audience: 'party', locked: true, clientActionId: 'public' });
  group.submitGroupAction(state, { roundId: round.id, seatId: seats[1].id, declaration: 'I secretly signal the guard.', audience: 'dm_only', privateGuidance: 'Do not reveal this.', locked: true, clientActionId: 'private' });
  const envelope = group.buildGroupVeyraEnvelope(state, { roundId: round.id });
  assert.match(JSON.stringify(envelope.publicActions), /search the ruins/);
  assert.doesNotMatch(JSON.stringify(envelope.publicActions), /signal the guard/);
  assert.match(JSON.stringify(envelope.privateActions), /signal the guard/);
  assert.match(JSON.stringify(envelope.knowledge), /bridge is broken/);
  assert.doesNotMatch(JSON.stringify(envelope.knowledge), /hidden key/);
  assert.equal(envelope.safety.publishDiscord, false);
});

test('majority decisions resolve only after a true majority', () => {
  const { state, seats, session } = preparedState();
  const decision = group.startDecision(state, { sessionId: session.id, question: 'Which road?', options: ['North','South'], policy: 'majority', clientDecisionId: 'decision-1' }).decision;
  group.castVote(state, { decisionId: decision.id, seatId: seats[0].id, option: 'North', clientVoteId: 'vote-1' });
  assert.equal(state.groupDecisions[0].status, 'open');
  group.castVote(state, { decisionId: decision.id, seatId: seats[1].id, option: 'North', clientVoteId: 'vote-2' });
  assert.equal(state.groupDecisions[0].status, 'resolved');
  assert.equal(state.groupDecisions[0].result, 'North');
});

test('delivery queue remains review-only and never marks Discord published', () => {
  const { state, seats, session } = preparedState();
  const queued = group.queueDelivery(state, { sessionId: session.id, audience: 'selected_seats', selectedSeatIds: [seats[0].id], type: 'private_recap', content: 'Only Vorkesh learned this.', clientDeliveryId: 'delivery-1' });
  assert.equal(queued.delivery.status, 'review');
  assert.equal(queued.delivery.automatic, false);
  assert.equal(queued.delivery.discordPublished, false);
  const approved = group.reviewDelivery(state, { deliveryId: queued.delivery.id, action: 'approve' });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.discordPublished, false);
  assert.equal(approved.releaseAuthorized, false);
});

test('group state is included in campaign checkpoints', () => {
  const { state, run, session } = preparedState();
  group.queueDelivery(state, { sessionId: session.id, content: 'Review me.', clientDeliveryId: 'checkpoint-delivery' });
  const checkpoint = runtime.createCheckpoint(state, { campaignId: 'campaign-1', runId: run.id, label: 'Group state', createdBy: 'owner' });
  assert.equal(checkpoint.snapshot.groupSessions.length, 1);
  assert.equal(checkpoint.snapshot.groupDeliveries.length, 1);
});
