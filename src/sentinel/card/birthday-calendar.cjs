'use strict';

const { validMonthDay, validTimeZone, BIRTHDAY_POLICY } = require('./birthday-config.cjs');

const COMMON_TIMEZONES = Object.freeze([
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland'
]);

function zonedParts(utcMs, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const bag = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second)
  };
}

function zonedLocalToUtc(year, month, day, hour, minute, timeZone) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let pass = 0; pass < 4; pass += 1) {
    const parts = zonedParts(utc, timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = want - asUtc;
    if (delta === 0) return utc;
    utc += delta;
  }
  return utc;
}

function celebrationDay(year, month, day) {
  const max = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Math.min(day, max);
}

function deliveryInstant(birthday, year, hour = BIRTHDAY_POLICY.deliveryHour) {
  if (!birthday || birthday.cleared || !validMonthDay(birthday.month, birthday.day) || !validTimeZone(birthday.timezone)) return null;
  const day = celebrationDay(year, birthday.month, birthday.day);
  return zonedLocalToUtc(year, birthday.month, day, hour, 0, birthday.timezone);
}

function localYear(nowMs, timeZone) {
  return zonedParts(nowMs, timeZone).year;
}

function candidateYears(nowMs, timeZone) {
  const year = localYear(nowMs, timeZone);
  return [year - 1, year];
}

function delayAnchor(birthday) {
  const revision = birthday?.revision || 1;
  const raw = revision <= 1 ? birthday?.setAt : (birthday?.changedAt || birthday?.setAt);
  const anchor = Date.parse(raw || '');
  return Number.isFinite(anchor) ? anchor : null;
}

function delaySatisfied(birthday, scheduledAt, policy = BIRTHDAY_POLICY) {
  const anchor = delayAnchor(birthday);
  if (anchor == null || !Number.isFinite(scheduledAt)) return false;
  const wait = (birthday?.revision || 1) <= 1 ? policy.firstGiftDelayMs : policy.postChangeDelayMs;
  return scheduledAt >= anchor + wait;
}

function changeLocked(birthday, nowMs, policy = BIRTHDAY_POLICY) {
  if (!birthday) return false;
  const anchor = Date.parse(birthday.changedAt || birthday.setAt || '');
  if (!Number.isFinite(anchor)) return true;
  return nowMs < anchor + policy.changeLockMs;
}

function suggestTimezones(query) {
  const needle = String(query || '').trim().toLowerCase();
  const matches = COMMON_TIMEZONES
    .filter((zone) => !needle || zone.toLowerCase().includes(needle))
    .slice(0, 25)
    .map((zone) => ({ name: zone, value: zone }));
  const typed = String(query || '').trim();
  if (typed && validTimeZone(typed) && !matches.some((item) => item.value === typed)) {
    matches.unshift({ name: typed, value: typed });
  }
  return matches.slice(0, 25);
}

const BIRTHDAY_CAP_TIME_ZONE = 'America/Chicago';

function capDayKey(nowMs, timeZone = BIRTHDAY_CAP_TIME_ZONE) {
  const parts = zonedParts(nowMs, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function startOfCapDay(nowMs, timeZone = BIRTHDAY_CAP_TIME_ZONE) {
  const parts = zonedParts(nowMs, timeZone);
  return zonedLocalToUtc(parts.year, parts.month, parts.day, 0, 0, timeZone);
}

function nextCapMidnight(nowMs, timeZone = BIRTHDAY_CAP_TIME_ZONE) {
  const parts = zonedParts(nowMs, timeZone);
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return zonedLocalToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
}

module.exports = {
  COMMON_TIMEZONES,
  zonedParts,
  zonedLocalToUtc,
  celebrationDay,
  deliveryInstant,
  localYear,
  candidateYears,
  delaySatisfied,
  changeLocked,
  suggestTimezones,
  BIRTHDAY_CAP_TIME_ZONE,
  capDayKey,
  startOfCapDay,
  nextCapMidnight
};
