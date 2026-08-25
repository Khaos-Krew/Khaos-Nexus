'use strict';

const { createPollRecord, pollOptionIds, publicPollRecord } = require('./poll-model.cjs');
const { applyPollProfile } = require('./poll-profiles.cjs');
const { PollStore } = require('./poll-store.cjs');

function nowIso(nowFn) {
  const value = typeof nowFn === 'function' ? nowFn() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Poll engine clock returned an invalid date.');
  return date.toISOString();
}

function voterRoleIds(voter = {}) {
  const values = Array.isArray(voter.roleIds)
    ? voter.roleIds
    : voter.roles?.cache?.keys ? [...voter.roles.cache.keys()] : [];
  return new Set(values.map(String));
}

function eligibility(poll, voter = {}) {
  const userId = String(voter.id || voter.user?.id || '');
  if (!userId) return { ok: false, reason: 'missing-user-id' };
  if (voter.bot === true || voter.user?.bot === true) return { ok: false, reason: 'bots-cannot-vote' };
  if (poll.excludeCreator && userId === String(poll.creatorId || '')) return { ok: false, reason: 'creator-excluded' };
  if ((poll.excludedUserIds || []).map(String).includes(userId)) return { ok: false, reason: 'user-excluded' };
  const roles = voterRoleIds(voter);
  if ((poll.excludedRoleIds || []).some((roleId) => roles.has(String(roleId)))) return { ok: false, reason: 'role-excluded' };
  if ((poll.eligibleRoleIds || []).length && !(poll.eligibleRoleIds || []).some((roleId) => roles.has(String(roleId)))) {
    return { ok: false, reason: 'missing-eligible-role' };
  }
  return { ok: true, userId };
}

function normalizedChoices(poll, choicesInput) {
  const choices = [...new Set((Array.isArray(choicesInput) ? choicesInput : [choicesInput]).map(String).filter(Boolean))];
  if (!choices.length) throw new Error('At least one poll option must be selected.');
  const valid = pollOptionIds(poll);
  for (const choice of choices) if (!valid.has(choice)) throw new Error(`Unknown poll option: ${choice}`);
  if (!poll.multiSelect && choices.length !== 1) throw new Error('This poll accepts one selection per voter.');
  if (choices.length > Number(poll.maxSelections || 1)) throw new Error(`This poll allows at most ${poll.maxSelections} selections.`);
  return choices;
}

function tallyPoll(poll) {
  const counts = new Map((poll.options || []).map((option) => [String(option.id), 0]));
  const votes = Object.values(poll.votes || {});
  for (const vote of votes) {
    for (const optionId of vote.optionIds || []) {
      if (counts.has(String(optionId))) counts.set(String(optionId), counts.get(String(optionId)) + 1);
    }
  }
  const totalVoters = votes.length;
  const totalSelections = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const rows = (poll.options || []).map((option) => {
    const count = counts.get(String(option.id)) || 0;
    return {
      optionId: String(option.id),
      label: String(option.label || ''),
      votes: count,
      percentOfVoters: totalVoters ? Number(((count / totalVoters) * 100).toFixed(2)) : 0
    };
  });
  return { totalVoters, totalSelections, counts: rows };
}

function topRows(tally) {
  const max = Math.max(0, ...(tally.counts || []).map((row) => Number(row.votes || 0)));
  return (tally.counts || []).filter((row) => Number(row.votes || 0) === max && max > 0);
}

function evaluatePoll(poll, at = new Date().toISOString()) {
  const tally = tallyPoll(poll);
  const quorumMet = tally.totalVoters >= Number(poll.minVotes || 0);
  const threshold = Number(poll.thresholdPercent || 0);
  const result = {
    pollId: String(poll.id),
    decisionRule: String(poll.decisionRule),
    quorumRequired: Number(poll.minVotes || 0),
    quorumMet,
    thresholdPercent: threshold,
    thresholdOptionId: String(poll.thresholdOptionId || ''),
    totalVoters: tally.totalVoters,
    totalSelections: tally.totalSelections,
    counts: tally.counts,
    winnerOptionIds: [],
    passed: null,
    tie: false,
    outcome: 'no-decision',
    finalizedAt: String(at)
  };

  if (!quorumMet) {
    result.passed = false;
    result.outcome = 'no-quorum';
    return result;
  }

  if (poll.decisionRule === 'informational') {
    result.outcome = 'informational';
    return result;
  }

  if (poll.decisionRule === 'threshold' || poll.decisionRule === 'supermajority') {
    const target = tally.counts.find((row) => row.optionId === String(poll.thresholdOptionId));
    const percent = target?.percentOfVoters || 0;
    result.passed = percent >= threshold;
    result.winnerOptionIds = result.passed && target ? [target.optionId] : [];
    result.outcome = result.passed ? 'passed' : 'failed';
    return result;
  }

  const tops = topRows(tally);
  if (!tops.length) {
    result.passed = false;
    result.outcome = 'no-decision';
    return result;
  }
  if (tops.length > 1) {
    result.tie = true;
    result.winnerOptionIds = tops.map((row) => row.optionId);
    result.outcome = poll.tieRule === 'runoff'
      ? 'runoff'
      : poll.tieRule === 'staff-review'
        ? 'staff-review'
        : poll.tieRule === 'extend'
          ? 'extended'
          : 'no-decision';
    return result;
  }

  const winner = tops[0];
  result.winnerOptionIds = [winner.optionId];
  if (poll.decisionRule === 'majority') {
    result.passed = winner.percentOfVoters > 50;
    result.outcome = result.passed ? 'passed' : 'failed';
  } else {
    result.passed = true;
    result.outcome = 'passed';
  }
  return result;
}

function visibleResult(poll, result, options = {}) {
  if (!result) return null;
  const closed = ['closed', 'cancelled', 'runoff'].includes(String(poll.status));
  if (!closed && poll.visibility === 'results-after-close' && options.authorized !== true) {
    return {
      pollId: result.pollId,
      decisionRule: result.decisionRule,
      quorumRequired: result.quorumRequired,
      hidden: true
    };
  }
  const clone = JSON.parse(JSON.stringify(result));
  clone.hidden = false;
  return clone;
}

class PollEngine {
  constructor(options = {}) {
    this.store = options.store || new PollStore(options);
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.hooks = options.hooks || {};
  }

  create(input = {}) {
    const now = nowIso(this.now);
    const profiled = applyPollProfile(input, now);
    const id = this.store.allocateId();
    const poll = createPollRecord(profiled, { id, now });
    return this.store.create(poll);
  }

  get(id, options = {}) {
    const poll = this.store.get(id);
    return options.includeVotes ? poll : publicPollRecord(poll);
  }

  list(options = {}) {
    return this.store.list(options).map((poll) => options.includeVotes ? poll : publicPollRecord(poll));
  }

  open(id, actorId = '') {
    const at = nowIso(this.now);
    return this.store.update(id, (poll) => {
      if (poll.finalResult || ['closed', 'cancelled'].includes(poll.status)) throw new Error('Finalized polls cannot be reopened.');
      poll.status = 'open';
      poll.openedAt ||= at;
      poll.updatedAt = at;
      poll.audit.push({ action: 'opened', actorId: String(actorId || ''), at });
      return poll;
    });
  }

  castVote(id, voter, choicesInput) {
    const poll = this.store.get(id);
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    const at = nowIso(this.now);
    if (poll.status === 'scheduled' && Date.parse(poll.opensAt) <= Date.parse(at)) this.open(id, 'scheduler');
    const current = this.store.get(id);
    if (current.status !== 'open' || current.finalResult) throw new Error('Poll is not open for voting.');
    if (Date.parse(current.closesAt) <= Date.parse(at)) throw new Error('Poll voting window has ended.');
    const access = eligibility(current, voter);
    if (!access.ok) throw new Error(`Vote rejected: ${access.reason}`);
    const optionIds = normalizedChoices(current, choicesInput);
    return this.store.update(id, (mutable) => {
      mutable.votes ||= {};
      mutable.votes[access.userId] = {
        userId: access.userId,
        optionIds,
        updatedAt: at
      };
      mutable.updatedAt = at;
      return mutable;
    });
  }

  removeVote(id, voter) {
    const poll = this.store.get(id);
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    if (poll.status !== 'open' || poll.finalResult) throw new Error('Poll is not open for voting.');
    const access = eligibility(poll, voter);
    if (!access.ok) throw new Error(`Vote rejected: ${access.reason}`);
    const at = nowIso(this.now);
    return this.store.update(id, (mutable) => {
      delete mutable.votes?.[access.userId];
      mutable.updatedAt = at;
      return mutable;
    });
  }

  results(id, options = {}) {
    const poll = this.store.get(id);
    if (!poll) throw new Error(`Poll ${id} does not exist.`);
    const result = poll.finalResult || evaluatePoll(poll, nowIso(this.now));
    return visibleResult(poll, result, options);
  }

  async deliverCompletionHook(poll) {
    if (!poll?.finalResult || poll.status !== 'closed') return false;
    const hookKey = `completion:${poll.source || poll.profile}`;
    if (this.store.hookDelivered(poll.id, hookKey)) return false;
    const handler = this.hooks[poll.source] || this.hooks[poll.profile] || this.hooks.completion;
    if (typeof handler === 'function') await handler(publicPollRecord(poll, { includeVotes: false }), JSON.parse(JSON.stringify(poll.finalResult)));
    this.store.markHookDelivered(poll.id, hookKey, nowIso(this.now));
    return typeof handler === 'function';
  }

  async close(id, actorId = 'scheduler') {
    const existing = this.store.get(id);
    if (!existing) throw new Error(`Poll ${id} does not exist.`);
    if (existing.status === 'cancelled') throw new Error('Cancelled polls cannot be closed.');
    if (existing.finalResult) {
      await this.deliverCompletionHook(existing);
      return existing;
    }
    const at = nowIso(this.now);
    const evaluation = evaluatePoll(existing, at);

    if (evaluation.tie && existing.tieRule === 'extend') {
      const extended = this.store.update(id, (poll) => {
        poll.closesAt = new Date(Date.parse(poll.closesAt) + Number(poll.extensionMinutes || 60) * 60_000).toISOString();
        poll.updatedAt = at;
        poll.audit.push({ action: 'tie-extended', actorId: String(actorId || ''), at });
        return poll;
      });
      return extended;
    }

    if (evaluation.tie && existing.tieRule === 'runoff') {
      return this.store.update(id, (poll) => {
        poll.status = 'runoff';
        poll.updatedAt = at;
        poll.closedAt = at;
        poll.finalResult = evaluation;
        poll.audit.push({ action: 'runoff-required', actorId: String(actorId || ''), at });
        return poll;
      });
    }

    const closed = this.store.update(id, (poll) => {
      poll.status = 'closed';
      poll.updatedAt = at;
      poll.closedAt = at;
      poll.finalResult = evaluation;
      poll.audit.push({ action: 'closed', actorId: String(actorId || ''), at });
      return poll;
    });
    await this.deliverCompletionHook(closed);
    return this.store.get(id);
  }

  cancel(id, actorId = '', reason = '') {
    const at = nowIso(this.now);
    return this.store.update(id, (poll) => {
      if (poll.finalResult || ['closed', 'cancelled'].includes(poll.status)) throw new Error('Finalized polls cannot be cancelled.');
      poll.status = 'cancelled';
      poll.cancelledAt = at;
      poll.cancelledBy = String(actorId || '');
      poll.cancelReason = String(reason || '').trim().slice(0, 500);
      poll.updatedAt = at;
      poll.audit.push({ action: 'cancelled', actorId: String(actorId || ''), at });
      return poll;
    });
  }

  async tick() {
    const at = nowIso(this.now);
    const opened = [];
    const closed = [];
    for (const poll of this.store.list({ statuses: ['scheduled', 'open'] })) {
      if (poll.status === 'scheduled' && Date.parse(poll.opensAt) <= Date.parse(at)) {
        this.open(poll.id, 'scheduler');
        opened.push(poll.id);
      }
      const current = this.store.get(poll.id);
      if (current?.status === 'open' && Date.parse(current.closesAt) <= Date.parse(at)) {
        const result = await this.close(current.id, 'scheduler');
        if (result.status === 'closed' || result.status === 'runoff') closed.push(current.id);
      }
    }
    return { at, opened, closed };
  }
}

module.exports = {
  PollEngine,
  eligibility,
  evaluatePoll,
  normalizedChoices,
  nowIso,
  tallyPoll,
  topRows,
  visibleResult,
  voterRoleIds
};
