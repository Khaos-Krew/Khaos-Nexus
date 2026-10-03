'use strict';

const { appendDisclaimer } = require('../panels.cjs');
const { boundedLines } = require('../style.cjs');
const { collectDates, nextResetAt } = require('../bungie/time.cjs');

const SECTIONS = Object.freeze([
  Object.freeze({ key: 'week', name: '🗓️ This Week' }),
  Object.freeze({ key: 'nightfall', name: '⚔️ Nightfall' }),
  Object.freeze({ key: 'raid', name: '🛡️ Raid & Dungeon' }),
  Object.freeze({ key: 'rewards', name: '🎁 Rewards' })
]);

function milestoneRows(payload) {
  const response = payload?.Response || payload || {};
  if (Array.isArray(response)) return response;
  return Object.entries(response).map(([hash, value]) => ({
    ...(value && typeof value === 'object' ? value : {}),
    milestoneHash: value?.milestoneHash || hash
  }));
}

function entryName(value) {
  if (typeof value === 'string') return value.trim();
  return String(value?.name || '').trim();
}

function relativeTag(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return `<t:${Math.floor(time / 1000)}:R>`;
}

function sectionFor(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('nightfall') || text.includes('grandmaster') || text.includes('ordeal')) return 'nightfall';
  if (text.includes('raid') || text.includes('dungeon')) return 'raid';
  if (/engram|reward|pinnacle|powerful|challenge/.test(text)) return 'rewards';
  return 'week';
}

function milestoneTime(row, resetAt, now) {
  const direct = Date.parse(row?.endDate || row?.resetDate || '');
  if (Number.isFinite(direct)) return direct;
  const availability = Date.parse(row?.availability?.endDate || row?.availabilityEndDate || '');
  if (Number.isFinite(availability)) return availability;
  const dates = collectDates(row);
  if (dates.length) {
    const future = dates.filter((time) => !now || time >= now).sort((left, right) => left - right);
    if (future.length) return future[0];
    return [...dates].sort((left, right) => right - left)[0];
  }
  return Number.isFinite(resetAt) && resetAt ? resetAt : null;
}

function timedLine(name, when) {
  const stamp = relativeTag(when) || 'time not listed';
  const suffix = ` ${stamp}`;
  const room = Math.max(8, 60 - suffix.length);
  const label = String(name || '').replace(/\s+/g, ' ').trim().slice(0, room);
  return `${label}${suffix}`.trim().slice(0, 60);
}

function renderWeeklyReset({ milestones, names = new Map(), now = Date.now() } = {}) {
  const rows = milestoneRows(milestones);
  const resetAt = nextResetAt(rows, now);
  const buckets = { week: [], nightfall: [], raid: [], rewards: [] };
  for (const row of rows) {
    const hash = String(row.milestoneHash || '');
    const name = entryName(names.get(hash) || names.get(Number(hash)) || '');
    if (!name) continue;
    const when = milestoneTime(row, resetAt, now);
    buckets[sectionFor(name)].push(timedLine(name, when));
  }
  const lines = [];
  if (rows.length < 3) lines.push('Few public milestones are available right now.');
  if (!rows.length) lines.push('No public milestones were returned.');
  lines.push(resetAt ? `⏳ Next reset ${relativeTag(resetAt)}` : '⏳ Next reset: not listed');
  return {
    title: '🗓️ Weekly Reset',
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    fields: SECTIONS.map((section) => ({
      name: section.name,
      value: boundedLines(buckets[section.key]).join('\n') || 'None',
      inline: true
    })),
    resetAt
  };
}

module.exports = { milestoneRows, renderWeeklyReset, milestoneTime };
