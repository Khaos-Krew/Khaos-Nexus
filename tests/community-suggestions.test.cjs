'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const {
  PANEL_MARKER,
  suggestionSettings,
  panelPayload,
  voteCounts,
  suggestionPayload,
  castVote,
  passesCommunityGate,
  githubIssueBody,
  createGithubIssue
} = require('../src/sentinel/suggestions-extension.cjs');

function sampleSuggestion(overrides = {}) {
  return {
    id: 'SUG-0001',
    number: 1,
    title: 'Add a useful Nexus feature',
    category: 'Discord',
    details: 'Build a tracked feature requested by the community.',
    submitterId: '111111111111111111',
    submitterName: 'Submitter',
    createdAt: '2026-08-25T00:00:00.000Z',
    closesAt: '2026-08-28T00:00:00.000Z',
    status: 'voting',
    votes: {},
    channelId: '222222222222222222',
    messageId: '333333333333333333',
    githubIssueUrl: '',
    githubIssueNumber: null,
    reviewReason: '',
    ...overrides
  };
}

test('suggestion defaults are configurable but safe for the first live rollout', () => {
  assert.deepEqual(suggestionSettings({}), {
    votingHours: 72,
    minVotes: 5,
    passPercent: 60,
    githubRepository: 'Khaos-Krew/Khaos-Nexus',
    githubToken: ''
  });
  assert.deepEqual(suggestionSettings({
    NEXUS_SUGGESTION_VOTING_HOURS: '96',
    NEXUS_SUGGESTION_MIN_VOTES: '8',
    NEXUS_SUGGESTION_PASS_PERCENT: '70',
    NEXUS_GITHUB_REPOSITORY: 'Khaos-Krew/Ideas',
    NEXUS_GITHUB_TOKEN: 'secret'
  }), {
    votingHours: 96,
    minVotes: 8,
    passPercent: 70,
    githubRepository: 'Khaos-Krew/Ideas',
    githubToken: 'secret'
  });
});

test('suggestion intake panel explains anti-burial workflow and self-vote prevention', () => {
  const payload = panelPayload(suggestionSettings({}));
  const text = JSON.stringify(payload);
  assert.match(text, /instead of getting buried/i);
  assert.match(text, /submitter cannot vote on their own suggestion/i);
  assert.match(text, /5 total votes/);
  assert.match(text, /60% approval/);
  assert.match(text, /Owner approval/);
  assert.equal(payload.embeds[0].footer.text, PANEL_MARKER);
});

test('submitters cannot self-vote and other users have one changeable vote', () => {
  const original = sampleSuggestion();
  assert.equal(castVote(original, original.submitterId, 'up').blocked, 'self-vote');

  const first = castVote(original, '444444444444444444', 'up');
  assert.equal(first.blocked, '');
  assert.equal(first.action, 'cast');
  assert.deepEqual(voteCounts(first.suggestion), { up: 1, down: 0, total: 1, approval: 100 });

  const changed = castVote(first.suggestion, '444444444444444444', 'down');
  assert.equal(changed.action, 'changed');
  assert.deepEqual(voteCounts(changed.suggestion), { up: 0, down: 1, total: 1, approval: 0 });

  const removed = castVote(changed.suggestion, '444444444444444444', 'down');
  assert.equal(removed.action, 'removed');
  assert.deepEqual(voteCounts(removed.suggestion), { up: 0, down: 0, total: 0, approval: 0 });
});

test('community gate requires both minimum turnout and approval threshold', () => {
  const settings = suggestionSettings({});
  assert.equal(passesCommunityGate(sampleSuggestion({ votes: { a: 'up', b: 'up', c: 'up', d: 'up' } }), settings), false);
  assert.equal(passesCommunityGate(sampleSuggestion({ votes: { a: 'up', b: 'up', c: 'up', d: 'down', e: 'down' } }), settings), true);
  assert.equal(passesCommunityGate(sampleSuggestion({ votes: { a: 'up', b: 'up', c: 'down', d: 'down', e: 'down' } }), settings), false);
});

test('suggestion card carries stable ID, vote controls, and no automatic mentions', () => {
  const payload = suggestionPayload(sampleSuggestion(), suggestionSettings({}));
  const text = JSON.stringify(payload);
  assert.match(text, /SUG-0001/);
  assert.match(text, /kn:suggest:vote:SUG-0001:up/);
  assert.match(text, /kn:suggest:vote:SUG-0001:down/);
  assert.match(text, /Voting Closes/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('GitHub issue body carries the approved idea and vote evidence without Discord identity data', () => {
  const suggestion = sampleSuggestion({ votes: { a: 'up', b: 'up', c: 'up', d: 'down', e: 'down' } });
  const body = githubIssueBody(suggestion);
  assert.match(body, /SUG-0001/);
  assert.match(body, /3 up \/ 2 down \(60% approval\)/);
  assert.match(body, /Owner approval is still required before implementation/);
  assert.doesNotMatch(body, new RegExp(suggestion.submitterId));
  assert.doesNotMatch(body, new RegExp(suggestion.submitterName));
});

test('GitHub sync stays pending without a runtime credential instead of losing the suggestion', async () => {
  let called = false;
  const result = await createGithubIssue(sampleSuggestion(), suggestionSettings({}), async () => {
    called = true;
    throw new Error('should not fetch');
  });
  assert.deepEqual(result, { ok: false, pending: 'github-token-unconfigured' });
  assert.equal(called, false);
});

test('GitHub sync creates a bounded issue when configured and never sends the token in the body', async () => {
  let request = null;
  const settings = suggestionSettings({ NEXUS_GITHUB_TOKEN: 'top-secret-token' });
  const result = await createGithubIssue(sampleSuggestion({ votes: { a: 'up', b: 'up', c: 'up', d: 'up', e: 'down' } }), settings, async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() { return { number: 432, html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/432' }; }
    };
  });
  assert.equal(result.ok, true);
  assert.equal(result.number, 432);
  assert.match(request.url, /Khaos-Krew\/Khaos-Nexus\/issues$/);
  assert.equal(request.options.headers.Authorization, 'Bearer top-secret-token');
  assert.doesNotMatch(request.options.body, /top-secret-token/);
  assert.match(request.options.body, /Community Suggestion SUG-0001/);
});

test('suggestion state allocates stable IDs and persists records across store instances', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-suggestions-'));
  try {
    const first = new StateStore(root);
    assert.deepEqual(first.allocateSuggestionId(), { id: 'SUG-0001', number: 1 });
    first.setSuggestion('SUG-0001', sampleSuggestion());
    assert.deepEqual(first.allocateSuggestionId(), { id: 'SUG-0002', number: 2 });

    const second = new StateStore(root);
    assert.equal(second.getSuggestion('SUG-0001').title, 'Add a useful Nexus feature');
    assert.equal(second.getSuggestionMeta().nextNumber, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
