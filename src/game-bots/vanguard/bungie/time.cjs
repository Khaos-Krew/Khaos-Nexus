'use strict';

function formatCt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
  return `${formatted} CT`;
}

function collectDates(milestone) {
  const found = [];
  const push = (value) => {
    const time = Date.parse(value);
    if (Number.isFinite(time)) found.push(time);
  };
  if (!milestone || typeof milestone !== 'object') return found;
  push(milestone.endDate);
  push(milestone.resetDate);
  const activities = milestone.activities;
  const rows = Array.isArray(activities) ? activities : activities && typeof activities === 'object' ? Object.values(activities) : [];
  for (const activity of rows) {
    push(activity?.endDate);
    push(activity?.resetDate);
  }
  return found;
}

function nextResetAt(milestones, now = Date.now()) {
  const times = [];
  const list = Array.isArray(milestones) ? milestones : Object.values(milestones || {});
  for (const milestone of list) times.push(...collectDates(milestone));
  const future = times.filter((time) => time > now).sort((left, right) => left - right);
  return future.length ? future[0] : null;
}

// Destiny's weekly reset is Tuesday at 17:00 UTC.
const WEEKLY_RESET_UTC_DAY = 2;
const WEEKLY_RESET_UTC_HOUR = 17;

function nextWeeklyReset(now = Date.now()) {
  const current = new Date(now);
  const candidate = new Date(Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate(),
    WEEKLY_RESET_UTC_HOUR,
    0,
    0,
    0
  ));
  const day = candidate.getUTCDay();
  let delta = (WEEKLY_RESET_UTC_DAY - day + 7) % 7;
  if (delta === 0 && candidate.getTime() <= now) delta = 7;
  candidate.setUTCDate(candidate.getUTCDate() + delta);
  return candidate.getTime();
}

module.exports = { formatCt, collectDates, nextResetAt, nextWeeklyReset };
