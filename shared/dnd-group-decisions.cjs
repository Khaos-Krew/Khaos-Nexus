'use strict';

const core = require('./dnd-group-core.cjs');
const { runtime } = core;

function startDecision(state, input = {}) {
  core.ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const session = core.groupSessionById(state, input.sessionId);
  if (!session || session.status !== 'active') runtime.fail('Active group session not found.', 'DND_GROUP_SESSION_NOT_FOUND');
  const clientDecisionId = runtime.clean(input.clientDecisionId, 160);
  if (clientDecisionId) {
    const duplicate = state.groupDecisions.find((item) => item.sessionId === session.id && item.clientDecisionId === clientDecisionId);
    if (duplicate) return { decision: runtime.clone(duplicate), duplicate: true };
  }
  const options = [...new Set((input.options || []).map((item) => runtime.clean(item, 500)).filter(Boolean))];
  if (options.length < 2 || options.length > 10) runtime.fail('A group decision requires two to ten options.', 'DND_GROUP_DECISION_OPTIONS');
  const eligibleSeatIds = session.participants.filter((item) => item.status === 'active' && item.seatType === 'human_player').map((item) => item.seatId);
  const decision = {
    id: runtime.makeId('group_decision'), clientDecisionId, campaignId: session.campaignId,
    sessionId: session.id, roundId: runtime.clean(input.roundId, 100), question: runtime.clean(input.question, 2000),
    options, policy: ['majority', 'unanimous', 'party_leader'].includes(input.policy) ? input.policy : 'majority',
    eligibleSeatIds, votes: [], status: 'open', result: '', openedAt: runtime.nowIso(), resolvedAt: ''
  };
  if (!decision.question) runtime.fail('Decision question is required.', 'DND_GROUP_DECISION_QUESTION');
  state.groupDecisions.push(decision);
  return { decision: runtime.clone(decision), duplicate: false };
}

function castVote(state, input = {}) {
  core.ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const decision = state.groupDecisions.find((item) => item.id === input.decisionId && item.status === 'open');
  if (!decision) runtime.fail('Open group decision not found.', 'DND_GROUP_DECISION_NOT_FOUND');
  const seatId = runtime.clean(input.seatId, 100);
  if (!decision.eligibleSeatIds.includes(seatId)) runtime.fail('This seat is not eligible to vote.', 'DND_GROUP_VOTER_INELIGIBLE');
  const option = runtime.clean(input.option, 500);
  if (!decision.options.includes(option)) runtime.fail('Select a valid decision option.', 'DND_GROUP_VOTE_OPTION_INVALID');
  const clientVoteId = runtime.clean(input.clientVoteId, 160) || runtime.makeId('vote_client');
  const duplicate = decision.votes.find((item) => item.clientVoteId === clientVoteId);
  if (duplicate) return { vote: runtime.clone(duplicate), duplicate: true, decision: runtime.clone(decision) };
  const previous = decision.votes.find((item) => item.seatId === seatId);
  const vote = { id: previous?.id || runtime.makeId('vote'), clientVoteId, seatId, option, castAt: runtime.nowIso() };
  if (previous) decision.votes[decision.votes.indexOf(previous)] = vote; else decision.votes.push(vote);
  resolveDecisionIfReady(state, decision.id);
  return { vote: runtime.clone(vote), duplicate: false, decision: runtime.clone(decision) };
}

function tally(decision) {
  const counts = Object.fromEntries(decision.options.map((option) => [option, 0]));
  for (const vote of decision.votes) counts[vote.option] = (counts[vote.option] || 0) + 1;
  return counts;
}

function resolveDecisionIfReady(state, decisionId, input = {}) {
  const decision = state.groupDecisions.find((item) => item.id === decisionId);
  if (!decision || decision.status !== 'open') return decision ? runtime.clone(decision) : null;
  const session = core.groupSessionById(state, decision.sessionId);
  const counts = tally(decision);
  let result = '';
  if (decision.policy === 'unanimous' && decision.votes.length === decision.eligibleSeatIds.length) {
    const unique = new Set(decision.votes.map((item) => item.option));
    if (unique.size === 1) result = decision.votes[0].option;
  }
  if (decision.policy === 'party_leader') result = decision.votes.find((item) => item.seatId === session?.partyLeaderSeatId)?.option || '';
  if (decision.policy === 'majority') {
    const ordered = Object.entries(counts).sort((a, b) => b[1] - a[1] || decision.options.indexOf(a[0]) - decision.options.indexOf(b[0]));
    if (ordered[0]?.[1] > decision.eligibleSeatIds.length / 2) result = ordered[0][0];
  }
  if (!result && input.forceOption) {
    if (!decision.options.includes(input.forceOption)) runtime.fail('Forced option is invalid.', 'DND_GROUP_DECISION_FORCE_INVALID');
    result = input.forceOption;
  }
  if (result) {
    decision.status = 'resolved';
    decision.result = result;
    decision.resolvedAt = runtime.nowIso();
  }
  return runtime.clone(decision);
}

module.exports = { startDecision, castVote, tally, resolveDecisionIfReady };
