'use strict';

const { normalizedName } = require('./self-role-model.cjs');

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function tokens(value) {
  return normalizedName(value).split('-').filter(Boolean);
}

function compact(value) {
  return normalizedName(value).replace(/-/g, '');
}

function similarityScore(label, roleName) {
  const left = normalizedName(label);
  const right = normalizedName(roleName);
  if (!left || !right) return 0;
  if (left === right) return 10;

  const leftCompact = compact(label);
  const rightCompact = compact(roleName);
  let score = 0;
  if (leftCompact.length >= 2 && rightCompact.includes(leftCompact)) score += 4;
  if (rightCompact.length >= 2 && leftCompact.includes(rightCompact)) score += 3;

  const leftTokens = new Set(tokens(label));
  const rightTokens = new Set(tokens(roleName));
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size || 1;
  score += (intersection / union) * 3;

  if (leftTokens.size === 1) {
    const only = [...leftTokens][0];
    if ([...rightTokens].some((token) => token.startsWith(only) || only.startsWith(token))) score += 1;
  }
  return score;
}

function candidateRoleNames(label, roles, limit = 6) {
  return valuesOf(roles)
    .filter((role) => role?.id && role?.name && role.name !== '@everyone')
    .map((role) => ({ name: String(role.name), score: similarityScore(label, role.name) }))
    .filter((item) => item.score >= 1.5)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Number(limit) || 6))
    .map((item) => item.name);
}

function unmatchedCandidateSummary(unmatched, roles, maxLabels = 20) {
  return (Array.isArray(unmatched) ? unmatched : [])
    .slice(0, maxLabels)
    .map((label) => {
      const candidates = candidateRoleNames(label, roles);
      return `${label}=>${candidates.length ? `[${candidates.join(' | ')}]` : '[no-nearby-role]'}`;
    })
    .join('; ');
}

module.exports = {
  valuesOf,
  tokens,
  compact,
  similarityScore,
  candidateRoleNames,
  unmatchedCandidateSummary
};