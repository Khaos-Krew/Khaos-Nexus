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
  const lines = ['LIMITED. Public milestones are a short list.'];
  if (rows.length < 3) lines.push('Few public milestones are available right now.');
  if (!rows.length) lines.push('No public milestones were returned.');
  lines.push(resetAt ? `Next reset: ${formatCt(resetAt)}.` : 'Next reset: not listed on these milestones.');
  for (const row of rows.slice(0, 20)) {
    const hash = String(row.milestoneHash || '');
    const name = names.get(hash) || names.get(Number(hash)) || `Milestone ${hash}`;
    const when = row.endDate || row.resetDate;
    const stamp = when ? ` — ${formatCt(when)}` : '';
    lines.push(`• ${name}${stamp}`);
  }
  if (rows.length > 20) lines.push(`…and ${rows.length - 20} more`);
  return {
    title: 'Vanguard • Weekly Reset',
    description: lines.join('\n').slice(0, 4000),
    resetAt
  };
}

module.exports = { milestoneRows, renderWeeklyReset };
