'use strict';

const PLAN_MARKER_PREFIX = '<!-- nexus-development-plan:';
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const MAX_PLAN_LENGTH = 6000;

function developmentPlanMarker(suggestionId) {
  return `${PLAN_MARKER_PREFIX}${String(suggestionId || '').trim()} -->`;
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

async function fetchDevelopmentPlan(suggestion, settings = {}, fetchImpl = globalThis.fetch) {
  const issueNumber = Number(suggestion?.githubIssueNumber || 0);
  if (!issueNumber) return { ok: false, pending: 'github-issue-unavailable' };
  if (!validRepository(settings.githubRepository)) return { ok: false, pending: 'github-repository-invalid' };
  if (typeof fetchImpl !== 'function') return { ok: false, pending: 'fetch-unavailable' };

  const headers = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2026-03-10',
    'user-agent': 'Khaos-Nexus/0.1 Sentinal suggestion planner'
  };
  if (settings.githubToken) headers.authorization = `Bearer ${settings.githubToken}`;

  const response = await fetchImpl(`https://api.github.com/repos/${settings.githubRepository}/issues/${issueNumber}/comments?per_page=100`, { headers });
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, pending: `github-comments-http-${response.status}` };
  return extractDevelopmentPlan(body, suggestion.id);
}

async function hydrateDevelopmentPlan(store, suggestion, settings = {}, fetchImpl = globalThis.fetch) {
  if (!suggestion || hasDevelopmentPlan(suggestion)) return { changed: false, suggestion };
  if (!suggestion.githubIssueNumber) return { changed: false, suggestion, pending: 'github-issue-unavailable' };
  const result = await fetchDevelopmentPlan(suggestion, settings, fetchImpl);
  if (!result.ok) return { changed: false, suggestion, pending: result.pending };
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
  TRUSTED_ASSOCIATIONS,
  MAX_PLAN_LENGTH,
  developmentPlanMarker,
  hasDevelopmentPlan,
  extractDevelopmentPlan,
  validRepository,
  fetchDevelopmentPlan,
  hydrateDevelopmentPlan
};
