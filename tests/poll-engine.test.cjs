'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPollRecord, normalizeOptions } = require('../src/backend/services/poll-model.cjs');
const { applyPollProfile } = require('../src/backend/services/poll-profiles.cjs');
const { PollStore } = require('../src/backend/services/poll-store.cjs');
const { PollEngine, eligibility, evaluatePoll } = require('../src/backend/services/poll-engine.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-polls-'));
  return path.join(dir, 'polls.json');
}

function clock(start = '2026-08-25T12:00:00.000Z') {
  let current = new Date(start);
  return {
    now: () => new Date(current),
    advance(ms) { current = new Date(current.getTime() + ms); },
    set(value) { current = new Date(value); }
  };
}

function engine(options = {}) {
  const time = options.clock || clock();
  const store = new PollStore({ filePath: options.filePath || tempFile() });
  return { time, store, engine: new PollEngine({ store, now: time.now, hooks: options.hooks || {} }) };
}

function voter(id, roleIds = []) {
  return { id, bot: false, roleIds };
}

test('poll model enforces POLL IDs, 2-10 unique options, and valid close ordering', () => {
  assert.throws(() => normalizeOptions(['One']), /2 to 10/);
  assert.throws(() => normalizeOptions(Array.from({ length: 11 }, (_, i) => `Option ${i}`)), /2 to 10/);
  assert.throws(() => normalizeOptions(['Yes', 'yes']), /Duplicate/);
  const poll = createPollRecord({
    question: 'Pick one',
    options: ['A', 'B'],
    closesAt: '2026-08-26T12:00:00.000Z'
  }, { id: 'POLL-0042', now: '2026-08-25T12:00:00.000Z' });
  assert.equal(poll.id, 'POLL-0042');
  assert.deepEqual(poll.options.map((item) => item.id), ['OPT-1', 'OPT-2']);
  assert.throws(() => createPollRecord({ question: 'Bad time', options: ['A', 'B'], closesAt: '2026-08-24T12:00:00.000Z' }, { id: 'POLL-0043', now: '2026-08-25T12:00:00.000Z' }), /after its open time/);
});

test('Suggestion Gate profile preserves the approved 5 vote / 60% / 72 hour / no-self-vote defaults', () => {
  const start = new Date('2026-08-25T12:00:00.000Z');
  const profile = applyPollProfile({ profile: 'suggestion-gate', question: 'Add feature?' }, start);
  assert.deepEqual(profile.options, ['Approve', 'Reject']);
  assert.equal(profile.minVotes, 5);
  assert.equal(profile.thresholdPercent, 60);
  assert.equal(profile.excludeCreator, true);
  assert.equal(profile.decisionRule, 'threshold');
  assert.equal(Date.parse(profile.closesAt) - Date.parse(profile.opensAt), 72 * 60 * 60_000);
});

test('single-select votes are changeable, removable, and remain one record per voter', () => {
  const kit = engine();
  const poll = kit.engine.create({ question: 'Favorite?', options: ['A', 'B'], creatorId: 'owner' });
  kit.engine.castVote(poll.id, voter('u1'), 'OPT-1');
  kit.engine.castVote(poll.id, voter('u1'), 'OPT-2');
  let current = kit.engine.get(poll.id, { includeVotes: true });
  assert.deepEqual(Object.keys(current.votes), ['u1']);
  assert.deepEqual(current.votes.u1.optionIds, ['OPT-2']);
  kit.engine.removeVote(poll.id, voter('u1'));
  current = kit.engine.get(poll.id, { includeVotes: true });
  assert.deepEqual(current.votes, {});
});

test('multi-select limits and role/user/creator eligibility are enforced at vote time', () => {
  const kit = engine();
  const poll = kit.engine.create({
    profile: 'event-scheduling',
    question: 'Dates?',
    options: ['Fri', 'Sat', 'Sun'],
    maxSelections: 2,
    creatorId: 'creator',
    excludeCreator: true,
    eligibleRoleIds: ['event-role'],
    excludedRoleIds: ['blocked-role'],
    excludedUserIds: ['banned-user']
  });
  assert.equal(eligibility(poll, voter('creator', ['event-role'])).reason, 'creator-excluded');
  assert.equal(eligibility(poll, voter('no-role')).reason, 'missing-eligible-role');
  assert.equal(eligibility(poll, voter('blocked', ['event-role', 'blocked-role'])).reason, 'role-excluded');
  assert.equal(eligibility(poll, voter('banned-user', ['event-role'])).reason, 'user-excluded');
  assert.throws(() => kit.engine.castVote(poll.id, voter('u1', ['event-role']), ['OPT-1', 'OPT-2', 'OPT-3']), /at most 2/);
  kit.engine.castVote(poll.id, voter('u1', ['event-role']), ['OPT-1', 'OPT-3']);
  assert.deepEqual(kit.engine.get(poll.id, { includeVotes: true }).votes.u1.optionIds, ['OPT-1', 'OPT-3']);
});

test('quorum, plurality, majority, threshold, supermajority, and informational rules are deterministic', () => {
  const base = {
    id: 'POLL-9000', question: 'Decision', options: [{ id: 'OPT-1', label: 'Yes' }, { id: 'OPT-2', label: 'No' }],
    minVotes: 3, thresholdPercent: 60, thresholdOptionId: 'OPT-1', tieRule: 'no-decision', votes: {
      a: { userId: 'a', optionIds: ['OPT-1'] },
      b: { userId: 'b', optionIds: ['OPT-1'] },
      c: { userId: 'c', optionIds: ['OPT-2'] }
    }
  };
  assert.equal(evaluatePoll({ ...base, decisionRule: 'plurality' }).winnerOptionIds[0], 'OPT-1');
  assert.equal(evaluatePoll({ ...base, decisionRule: 'majority' }).passed, true);
  assert.equal(evaluatePoll({ ...base, decisionRule: 'threshold' }).passed, true);
  assert.equal(evaluatePoll({ ...base, decisionRule: 'supermajority', thresholdPercent: 75 }).passed, false);
  assert.equal(evaluatePoll({ ...base, decisionRule: 'informational' }).outcome, 'informational');
  assert.equal(evaluatePoll({ ...base, decisionRule: 'plurality', minVotes: 4 }).outcome, 'no-quorum');
});

test('tie rules support runoff, staff review, no decision, and bounded extension', async () => {
  const time = clock();
  const kit = engine({ clock: time });
  const runoff = kit.engine.create({ question: 'Tie?', options: ['A', 'B'], tieRule: 'runoff', minVotes: 2 });
  kit.engine.castVote(runoff.id, voter('u1'), 'OPT-1');
  kit.engine.castVote(runoff.id, voter('u2'), 'OPT-2');
  const runoffClosed = await kit.engine.close(runoff.id, 'owner');
  assert.equal(runoffClosed.status, 'runoff');
  assert.equal(runoffClosed.finalResult.outcome, 'runoff');

  const review = kit.engine.create({ question: 'Review?', options: ['A', 'B'], tieRule: 'staff-review', minVotes: 2 });
  kit.engine.castVote(review.id, voter('u3'), 'OPT-1');
  kit.engine.castVote(review.id, voter('u4'), 'OPT-2');
  const reviewClosed = await kit.engine.close(review.id, 'owner');
  assert.equal(reviewClosed.status, 'closed');
  assert.equal(reviewClosed.finalResult.outcome, 'staff-review');

  const extension = kit.engine.create({ question: 'Extend?', options: ['A', 'B'], tieRule: 'extend', extensionMinutes: 30, minVotes: 2 });
  kit.engine.castVote(extension.id, voter('u5'), 'OPT-1');
  kit.engine.castVote(extension.id, voter('u6'), 'OPT-2');
  const previousClose = extension.closesAt;
  const extended = await kit.engine.close(extension.id, 'owner');
  assert.equal(extended.status, 'open');
  assert.equal(Date.parse(extended.closesAt) - Date.parse(previousClose), 30 * 60_000);
  assert.equal(extended.finalResult, null);
});

test('closing freezes votes, cancellation never produces a winner, and hidden results stay hidden until close', async () => {
  const kit = engine();
  const hidden = kit.engine.create({
    question: 'Private totals?', options: ['Yes', 'No'], visibility: 'results-after-close', minVotes: 1
  });
  kit.engine.castVote(hidden.id, voter('u1'), 'OPT-1');
  assert.equal(kit.engine.results(hidden.id).hidden, true);
  const closed = await kit.engine.close(hidden.id, 'owner');
  assert.equal(closed.status, 'closed');
  assert.equal(kit.engine.results(hidden.id).hidden, false);
  assert.throws(() => kit.engine.castVote(hidden.id, voter('u2'), 'OPT-2'), /not open/);

  const cancelled = kit.engine.create({ question: 'Cancel?', options: ['A', 'B'] });
  const cancelledRecord = kit.engine.cancel(cancelled.id, 'owner', 'No longer needed');
  assert.equal(cancelledRecord.status, 'cancelled');
  assert.equal(cancelledRecord.finalResult, null);
  assert.throws(() => kit.engine.castVote(cancelled.id, voter('u1'), 'OPT-1'), /not open/);
});

test('poll IDs and active state persist across a store restart', () => {
  const filePath = tempFile();
  const first = engine({ filePath });
  const created = first.engine.create({ question: 'Persist?', options: ['A', 'B'] });
  first.engine.castVote(created.id, voter('u1'), 'OPT-1');

  const secondStore = new PollStore({ filePath });
  const second = new PollEngine({ store: secondStore, now: first.time.now });
  assert.deepEqual(second.get(created.id, { includeVotes: true }).votes.u1.optionIds, ['OPT-1']);
  assert.equal(second.create({ question: 'Next?', options: ['A', 'B'] }).id, 'POLL-0002');
});

test('completion hooks fire exactly once even when close is retried after restart', async () => {
  const filePath = tempFile();
  let calls = 0;
  const hooks = { suggestion: async (poll, result) => { calls += 1; assert.equal(poll.source, 'suggestion'); assert.equal(result.outcome, 'passed'); } };
  const first = engine({ filePath, hooks });
  const poll = first.engine.create({
    profile: 'suggestion-gate', source: 'suggestion', question: 'Ship it?', creatorId: 'creator'
  });
  for (let index = 0; index < 5; index += 1) first.engine.castVote(poll.id, voter(`u${index}`), index < 3 ? 'OPT-1' : 'OPT-2');
  await first.engine.close(poll.id, 'scheduler');
  assert.equal(calls, 1);
  await first.engine.close(poll.id, 'scheduler');
  assert.equal(calls, 1);

  const restarted = new PollEngine({ store: new PollStore({ filePath }), now: first.time.now, hooks });
  await restarted.close(poll.id, 'scheduler');
  assert.equal(calls, 1);
});

test('scheduler tick opens scheduled polls and closes expired polls deterministically', async () => {
  const time = clock('2026-08-25T12:00:00.000Z');
  const kit = engine({ clock: time });
  const scheduled = kit.engine.create({
    question: 'Later?', options: ['A', 'B'], opensAt: '2026-08-25T13:00:00.000Z', closesAt: '2026-08-25T14:00:00.000Z'
  });
  assert.equal(scheduled.status, 'scheduled');
  time.set('2026-08-25T13:00:01.000Z');
  let tick = await kit.engine.tick();
  assert.deepEqual(tick.opened, [scheduled.id]);
  assert.equal(kit.engine.get(scheduled.id).status, 'open');
  kit.engine.castVote(scheduled.id, voter('u1'), 'OPT-1');
  time.set('2026-08-25T14:00:01.000Z');
  tick = await kit.engine.tick();
  assert.deepEqual(tick.closed, [scheduled.id]);
  assert.equal(kit.engine.get(scheduled.id).status, 'closed');
});

test('scheduler emits each configured reminder once and persists its audit ledger', async () => {
  const time = clock('2026-08-25T12:00:00.000Z');
  const kit = engine({ clock: time });
  const poll = kit.engine.create({
    question: 'Reminder?', options: ['A', 'B'], closesAt: '2026-08-25T14:00:00.000Z', reminderMinutes: [60]
  });
  time.set('2026-08-25T13:00:01.000Z');
  let tick = await kit.engine.tick();
  assert.deepEqual(tick.reminders, [{ id: poll.id, minutes: 60 }]);
  tick = await kit.engine.tick();
  assert.deepEqual(tick.reminders, []);
  const current = kit.engine.get(poll.id, { includeVotes: false });
  assert.deepEqual(current.remindersSent, [60]);
  assert.equal(current.audit.at(-1).action, 'reminder-sent');
});
