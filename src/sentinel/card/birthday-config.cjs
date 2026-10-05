'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_LEDGER = '__PENDING_LEDGER__';

// Owner lock 2026-10-05. These are the intended production numbers.
// Readers still fail closed until the environment sets them.
const HARD_BIRTHDAY_GIFT_CEILING = 150;
const OWNER_LOCKED_BIRTHDAY_COINS = Object.freeze({
  min: 75,
  max: 125,
  ceiling: HARD_BIRTHDAY_GIFT_CEILING,
  dailyCap: 1500
});

const BIRTHDAY_POLICY = Object.freeze({
  firstGiftDelayMs: 14 * DAY_MS,
  changeLockMs: 60 * DAY_MS,
  postChangeDelayMs: 30 * DAY_MS,
  deliveryHour: 9,
  revealMs: 7 * DAY_MS,
  giftCooldownMs: 300 * DAY_MS,
  tenureMs: 7 * DAY_MS,
  accountAgeMs: 30 * DAY_MS,
  schedulerMs: 60 * 60 * 1000
});

const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,2}$/;
const MONTH_LENGTHS = Object.freeze([0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function birthdayEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env?.BIRTHDAY_ENABLED || '').trim().toLowerCase());
}

function readWhole(value) {
  const text = String(value ?? '').trim();
  if (!text || text === PENDING_LEDGER) return null;
  if (!/^[0-9]+$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return amount;
}

function readBirthdayCoins(env = process.env) {
  const min = readWhole(env?.BIRTHDAY_COINS_MIN);
  const max = readWhole(env?.BIRTHDAY_COINS_MAX);
  const ceiling = readWhole(env?.BIRTHDAY_GIFT_CEILING);
  const dailyCap = readWhole(env?.BIRTHDAY_GIFT_DAILY_CAP);
  if (min == null || max == null) return { ok: false, reason: 'coins-pending' };
  if (ceiling == null) return { ok: false, reason: 'grant-ceiling-unset' };
  if (dailyCap == null) return { ok: false, reason: 'daily-cap-unset' };
  if (ceiling > HARD_BIRTHDAY_GIFT_CEILING) return { ok: false, reason: 'grant-ceiling' };
  if (min > max || max > ceiling || max > HARD_BIRTHDAY_GIFT_CEILING) return { ok: false, reason: 'coins-range' };
  return { ok: true, min, max, ceiling, dailyCap };
}

function validTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!TIME_ZONE_PATTERN.test(timeZone)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function validMonthDay(month, day) {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1 || day > MONTH_LENGTHS[month]) return false;
  return true;
}

function isoOrNull(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function revisionOf(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1 || revision > 100000) return 1;
  return revision;
}

function normalizeGifts(value) {
  const gifts = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return gifts;
  for (const [year, gift] of Object.entries(value)) {
    if (!/^(19|20|21)\d{2}$/.test(year) || !gift || typeof gift !== 'object') continue;
    const status = ['ready', 'revealed', 'expired', 'skipped'].includes(gift.status) ? gift.status : 'ready';
    const row = { status, provider: 'coins' };
    if (status === 'skipped') {
      const skippedAt = isoOrNull(gift.skippedAt);
      if (skippedAt) row.skippedAt = skippedAt;
      if (gift.skipReason === 'account-hold') row.skipReason = 'account-hold';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(gift.alertedFor || ''))) row.alertedFor = String(gift.alertedFor);
    for (const key of ['scheduledAt', 'revealExpiresAt', 'readyAt', 'revealedAt', 'deferredUntil', 'notifiedAt']) {
      const stamp = isoOrNull(gift[key]);
      if (stamp) row[key] = stamp;
    }
    if (gift.notify === 'dm' || gift.notify === 'channel') row.notify = gift.notify;
    gifts[year] = row;
  }
  return gifts;
}

function normalizeBirthday(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cleared = value.cleared === true;
  const month = Number(value.month);
  const day = Number(value.day);
  const timezone = String(value.timezone || '').trim();
  const active = !cleared && validMonthDay(month, day) && validTimeZone(timezone);
  if (!cleared && !active) return null;
  const record = {
    cleared,
    visibility: value.visibility === 'shown' ? 'shown' : 'hidden',
    announce: value.announce === true,
    setAt: isoOrNull(value.setAt),
    changedAt: isoOrNull(value.changedAt),
    revision: revisionOf(value.revision),
    gifts: normalizeGifts(value.gifts)
  };
  if (!cleared) {
    record.month = month;
    record.day = day;
    record.timezone = timezone;
  }
  return record;
}

module.exports = {
  DAY_MS,
  PENDING_LEDGER,
  HARD_BIRTHDAY_GIFT_CEILING,
  OWNER_LOCKED_BIRTHDAY_COINS,
  BIRTHDAY_POLICY,
  birthdayEnabled,
  readWhole,
  readBirthdayCoins,
  validTimeZone,
  validMonthDay,
  normalizeBirthday
};
