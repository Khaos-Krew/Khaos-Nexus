'use strict';

const PLAN_MARKER_PREFIX = '<!-- nexus-development-plan:';
const PLAN_REQUEST_MARKER_PREFIX = '<!-- nexus-development-plan-request:';
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAX_PLAN_LENGTH = 6000;
const GITHUB_API_VERSION = '2026-03-10';

function developmentPlanMarker(suggestionId) {
  return `${PLAN_MARKER_PREFIX}${String(suggestionId || '').trim()} -->`;
}

function developmentPlanRequestMarker(suggestionId) {
  return `${PLAN_REQUEST_MARKER_PREFIX}${String(suggestionId || '').trim()} -->`;
}

function developmentPlanRequestBody(suggestion) {
  const id = String(suggestion?.id || '').trim();
  return [
    developmentPlanRequestMarker(id),
    '## Nexus development plan requested',
    '',
    `Community suggestion **${id}** passed its vote gate and is waiting for a repository-aware implementation plan before Owner approval.`,
    '',
    'Analyze the current codebase and post one trusted repository comment beginning exactly with:',
    '',
    developmentPlanMarker(id),
    '',
    'The plan should cover:',
    '- scope and affected Nexus components;',
    '- concrete implementation steps and likely files/services;',
    '- tests and live acceptance checks;',
    '- migration, permission, security, or rollback risks;',
    '- any owner decision points that must be resolved first.',
    '',
    '**Do not implement the suggestion until the Nexus Owner approves the reviewed plan.**'
  ].join('\n');
}

function hasDevelopmentPlan(suggestion) {
  return Boolean(String(suggestion?.developmentPlan || '').trim());
}

function extractDevelopmentPlan(comments, suggestionId) {
  const marker = developmentPlanMarker(suggestionId);
  const candidates = (Array.isArray(comments) ? comments : [])
    .filter((comment) => TRUSTED_ASSOCIATIONS.has(String(comment?.author_association || '').toUpperCase()))
    .filter((comment) => String(comment?.body || '').includes(marker))
    .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0));
  for (const comment of candidates) {
    const body = String(comment.body || '');
    const index = body.indexOf(marker);
    const plan = body.slice(index + marker.length).trim().slice(0, MAX_PLAN_LENGTH);
    if (!plan) continue;
    return {
      ok: true,
      plan,
      url: String(comment.html_url || '').slice(0, 1000),
      author: String(comment.user?.login || '').slice(0, 100),
      authorAssociation: String(comment.author_association || '').toUpperCase(),
      createdAt: String(comment.created_at || '')
    };
  }
  return { ok: false, pending: 'development-plan-not-found' };
}

function validRepository(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || '').trim());
}

function githubHeaders(settings = {}) {
  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': 'Khaos-Nexus/0.1 Sentinal suggestion planner'
  };
  if (settings.githubToken) headers.authorization = `Bearer ${settings.githubToken}`;
  return headers;
}

function commentsUrl(suggestion, settings = {}) {
  const issueNumber = Number(suggestion?.githubIssueNumber || 0);
  if (!issueNumber || !validRepository(settings.githubRepository)) return '';
  return `https://api.github.com/repos/${settings.githubRepository}/issues/${issueNumber}/comments`;
}

async function fetchIssueComments(suggestion, settings = {}, fetchImpl = globalThis.fetch) {
  const url = commentsUrl(suggestion, settings);
  if (!Number(suggestion?.githubIssueNumber || 0)) return { ok: false, pending: 'github-issue-unavailable', comments: [] };
  if (!validRepository(settings.githubRepository)) return { ok: false, pending: 'github-repository-invalid', comments: [] };
  if (typeof fetchImpl !== 'function') return { ok: false, pending: 'fetch-unavailable', comments: [] };
  const response = await fetchImpl(`${url}?per_page=100`, { headers: githubHeaders(settings) });
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, pending: `github-comments-http-${response.status}`, comments: [] };
  return { ok: true, comments: Array.isArray(body) ? body : [] };
}

async function fetchDevelopmentPlan(suggestion, settings = {}, fetchImpl = globalThis.fetch) {
  const result = await fetchIssueComments(suggestion, settings, fetchImpl);
  if (!result.ok) return { ok: false, pending: result.pending };
  return extractDevelopmentPlan(result.comments, suggestion.id);
}

function hasDevelopmentPlanRequest(comments, suggestionId) {
  const marker = developmentPlanRequestMarker(suggestionId);
  return (Array.isArray(comments) ? comments : []).some((comment) => String(comment?.body || '').includes(marker));
}

async function ensureDevelopmentPlanRequest(suggestion, settings = {}, fetchImpl = globalThis.fetch, knownComments = null) {
  if (!settings.githubToken) return { ok: false, created: false, pending: 'github-token-unavailable' };
  const url = commentsUrl(suggestion, settings);
  if (!url) return { ok: false, created: false, pending: 'github-issue-or-repository-unavailable' };
  if (typeof fetchImpl !== 'function') return { ok: false, created: false, pending: 'fetch-unavailable' };

  let comments = knownComments;
  if (!Array.isArray(comments)) {
    const result = await fetchIssueComments(suggestion, settings, fetchImpl);
    if (!result.ok) return { ok: false, created: false, pending: result.pending };
    comments = result.comments;
  }
  if (hasDevelopmentPlanRequest(comments, suggestion.id)) return { ok: true, created: false, existing: true };

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { ...githubHeaders(settings), 'content-type': 'application/json' },
    body: JSON.stringify({ body: developmentPlanRequestBody(suggestion) })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, created: false, pending: `github-plan-request-http-${response.status}` };
  return {
    ok: true,
    created: true,
    url: String(body?.html_url || '').slice(0, 1000)
  };
}

async function hydrateDevelopmentPlan(store, suggestion, settings = {}, fetchImpl = globalThis.fetch) {
  if (!suggestion || hasDevelopmentPlan(suggestion)) return { changed: false, suggestion };
  if (!suggestion.githubIssueNumber) return { changed: false, suggestion, pending: 'github-issue-unavailable' };

  const commentsResult = await fetchIssueComments(suggestion, settings, fetchImpl);
  if (!commentsResult.ok) return { changed: false, suggestion, pending: commentsResult.pending };
  const result = extractDevelopmentPlan(commentsResult.comments, suggestion.id);
  if (!result.ok) {
    const handoff = await ensureDevelopmentPlanRequest(suggestion, settings, fetchImpl, commentsResult.comments);
    return {
      changed: false,
      suggestion,
      pending: result.pending,
      planningRequestCreated: Boolean(handoff.created),
      planningRequestPending: handoff.ok ? '' : handoff.pending
    };
  }

  const next = {
    ...suggestion,
    developmentPlan: result.plan,
    developmentPlanUrl: result.url,
    developmentPlanAuthor: result.author,
    developmentPlanAuthorAssociation: result.authorAssociation,
    developmentPlannedAt: result.createdAt || new Date().toISOString()
  };
  store.setSuggestion(next.id, next);
  return { changed: true, suggestion: next };
}

module.exports = {
  PLAN_MARKER_PREFIX,
  PLAN_REQUEST_MARKER_PREFIX,
  TRUSTED_ASSOCIATIONS,
  MAX_PLAN_LENGTH,
  GITHUB_API_VERSION,
  developmentPlanMarker,
  developmentPlanRequestMarker,
  developmentPlanRequestBody,
  hasDevelopmentPlan,
  extractDevelopmentPlan,
  validRepository,
  githubHeaders,
  commentsUrl,
  fetchIssueComments,
  fetchDevelopmentPlan,
  hasDevelopmentPlanRequest,
  ensureDevelopmentPlanRequest,
  hydrateDevelopmentPlan
};
