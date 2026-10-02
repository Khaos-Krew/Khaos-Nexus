'use strict';

const { formatCt, nextResetAt } = require('../bungie/time.cjs');

function milestoneRows(payload) {
  const response = payload?.Response || payload || {};
  if (Array.isArray(response)) return response;
  return Object.entries(response).map(([hash, value]) => ({
    ...(value && typeof value === 'object' ? value : {}),
    milestoneHash: value?.milestoneHash || hash
  }));
}

function renderWeeklyReset({ milestones, names = new Map(), now = Date.now() } = {}) {
  const rows = milestoneRows(milestones);
  const resetAt = nextResetAt(rows, now);
  const lines = [];
  if (rows.length < 3) lines.push('Few public milestones are available right now.');
  if (!rows.length) lines.push('No public milestones were returned.');
  lines.push(resetAt ? `Next reset: ${formatCt(resetAt)}.` : 'Next reset: not listed on these milestones.');
  const named = [];
  for (const row of rows) {
    const hash = String(row.milestoneHash || '');
    const name = names.get(hash) || names.get(Number(hash)) || '';
    if (!name) continue;
    named.push({ name, when: row.endDate || row.resetDate });
  }
  for (const row of named.slice(0, 20)) {
    const stamp = row.when ? ` — ${formatCt(row.when)}` : '';
    lines.push(`• ${row.name}${stamp}`);
  }
  if (named.length > 20) lines.push(`…and ${named.length - 20} more`);
  return {
    title: 'Vanguard • Weekly Reset',
    description: lines.join('\n').slice(0, 4000),
    resetAt
  };
}

module.exports = { milestoneRows, renderWeeklyReset };
