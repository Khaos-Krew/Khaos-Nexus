'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  developmentPlanMarker,
  hasDevelopmentPlan,
  extractDevelopmentPlan,
  fetchDevelopmentPlan,
  hydrateDevelopmentPlan
} = require('../src/sentinel/suggestion-development-plan.cjs');

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

const suggestion = {
  id: 'SUG-0042',
  githubIssueNumber: 999,
  githubIssueUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/999'
};

test('development plan marker is stable and suggestion-specific', () => {
  assert.equal(developmentPlanMarker('SUG-0042'), '<!-- nexus-development-plan:SUG-0042 -->');
  assert.equal(hasDevelopmentPlan({ developmentPlan: 'Build it.' }), true);
  assert.equal(hasDevelopmentPlan({ developmentPlan: '   ' }), false);
});

test('plan extraction ignores untrusted public comments and accepts trusted repository collaborators', () => {
  const marker = developmentPlanMarker(suggestion.id);
  const result = extractDevelopmentPlan([
    { id: 10, author_association: 'NONE', body: `${marker}\nFake public plan`, user: { login: 'random-user' } },
    { id: 11, author_association: 'COLLABORATOR', body: `${marker}\n## Implementation\n1. Add backend contract.\n2. Add tests.`, html_url: 'https://github.com/example/issues/999#issuecomment-11', user: { login: 'planner' }, created_at: '2026-08-25T01:00:00Z' }
  ], suggestion.id);
  assert.equal(result.ok, true);
  assert.match(result.plan, /Add backend contract/);
  assert.equal(result.author, 'planner');
  assert.equal(result.authorAssociation, 'COLLABORATOR');
});

test('plan extraction rejects empty marker comments', () => {
  const result = extractDevelopmentPlan([
    { id: 1, author_association: 'OWNER', body: developmentPlanMarker(suggestion.id) }
  ], suggestion.id);
  assert.deepEqual(result, { ok: false, pending: 'development-plan-not-found' });
});

test('GitHub plan fetch uses the issue comments endpoint and current API version', async () => {
  let request = null;
  const result = await fetchDevelopmentPlan(suggestion, {
    githubRepository: 'Khaos-Krew/Khaos-Nexus',
    githubToken: 'secret'
  }, async (url, options) => {
    request = { url, options };
    return response(200, [{
      id: 12,
      author_association: 'MEMBER',
      body: `${developmentPlanMarker(suggestion.id)}\nReady-to-review implementation plan.`,
      html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/issues/999#issuecomment-12',
      user: { login: 'nexus-planner' }
    }]);
  });
  assert.equal(result.ok, true);
  assert.match(request.url, /issues\/999\/comments\?per_page=100$/);
  assert.equal(request.options.headers.authorization, 'Bearer secret');
  assert.equal(request.options.headers['x-github-api-version'], '2026-03-10');
});

test('hydration persists a discovered plan only once', async () => {
  let stored = null;
  let calls = 0;
  const store = { setSuggestion(id, value) { assert.equal(id, suggestion.id); stored = value; } };
  const fetchImpl = async () => {
    calls += 1;
    return response(200, [{ id: 13, author_association: 'OWNER', body: `${developmentPlanMarker(suggestion.id)}\nPlan body.` }]);
  };
  const first = await hydrateDevelopmentPlan(store, suggestion, { githubRepository: 'Khaos-Krew/Khaos-Nexus' }, fetchImpl);
  assert.equal(first.changed, true);
  assert.equal(stored.developmentPlan, 'Plan body.');
  const second = await hydrateDevelopmentPlan(store, stored, { githubRepository: 'Khaos-Krew/Khaos-Nexus' }, fetchImpl);
  assert.equal(second.changed, false);
  assert.equal(calls, 1);
});
