'use strict';

const { birthdayEnabled, readBirthdayCoins, BIRTHDAY_POLICY, validMonthDay, validTimeZone } = require('./birthday-config.cjs');
const { cardEnabled } = require('./card-config.cjs');
const {
  candidateYears,
  changeLocked,
  delaySatisfied,
  deliveryInstant,
  utcDayKey
} = require('./birthday-calendar.cjs');
const { assessBirthdayEligibility, restrictedRolesFor } = require('./birthday-eligibility.cjs');
const { writeBirthdayAudit } = require('./birthday-audit.cjs');
const { grantBirthdayProvider } = require('./birthday-providers.cjs');
const { COPY, NO_MENTIONS, channelCopy, openedCopy } = require('./birthday-copy.cjs');

function featureOn(deps = {}) {
  if (deps.enabled === true) return true;
  if (deps.enabled === false) return false;
  const env = deps.env || process.env;
  return cardEnabled(env) && birthdayEnabled(env);
}

function clockMs(deps) {
  const now = typeof deps.now === 'function' ? deps.now() : Date.now();
  return now instanceof Date ? now.getTime() : Number(now);
}

function policyOf(deps) {
  return deps.policy || BIRTHDAY_POLICY;
}

function auditSecrets(birthday) {
  if (!birthday || birthday.cleared) return [];
  return [birthday.timezone].filter(Boolean);
}

function revealedThisWindow(birthday, nowMs) {
  if (!birthday?.gifts) return null;
  for (const [year, gift] of Object.entries(birthday.gifts)) {
    if (gift?.status !== 'revealed') continue;
    const expiry = Date.parse(gift.revealExpiresAt || '');
    if (Number.isFinite(expiry) && nowMs < expiry) return { year, gift };
  }
  return null;
}

function claimableGift(birthday, nowMs) {
  if (!birthday || birthday.cleared) return null;
  const years = Object.keys(birthday.gifts || {}).sort();
  let deferred = null;
  for (const year of years) {
    const gift = birthday.gifts[year];
    if (!gift || gift.status === 'revealed' || gift.status === 'expired') continue;
    const waiting = gift.deferredUntil && Date.parse(gift.deferredUntil) > nowMs;
    if (waiting) {
      deferred = deferred || { kind: 'deferred', year, gift };
      continue;
    }
    const expiry = Date.parse(gift.revealExpiresAt || '');
    const kept = Boolean(gift.deferredUntil);
    if (kept || (Number.isFinite(expiry) && nowMs < expiry)) return { kind: 'ready', year, gift };
  }
  return deferred;
}

async function setBirthday(deps, userId, input = {}) {
  if (!featureOn(deps)) return { ok: false, code: 'off', text: COPY.off };
  const nowMs = clockMs(deps);
  const policy = policyOf(deps);
  const month = Number(input.month);
  const day = Number(input.day);
  const timezone = String(input.timezone || '').trim();
  if (!validMonthDay(month, day) || !validTimeZone(timezone)) {
    await writeBirthdayAudit(deps.audit, { action: 'birthday-set', userId: String(userId), outcome: 'invalid' });
    return { ok: false, code: 'invalid', text: COPY.invalid };
  }
  const saved = await deps.store.updateBirthday(userId, (current) => {
    if (current && !current.cleared && current.month === month && current.day === day && current.timezone === timezone) {
      return { keep: true, status: 'unchanged' };
    }
    if (current && changeLocked(current, nowMs, policy)) return { reject: true, reason: 'locked' };
    const stamp = new Date(nowMs).toISOString();
    return {
      status: 'saved',
      birthday: {
        cleared: false,
        month,
        day,
        timezone,
        visibility: current?.visibility === 'shown' ? 'shown' : 'hidden',
        announce: current?.announce === true,
        setAt: current?.setAt || stamp,
        changedAt: stamp,
        revision: current ? (current.revision || 1) + 1 : 1,
        gifts: current?.gifts || {}
      }
    };
  });
  if (!saved.ok && saved.reason === 'locked') {
    await writeBirthdayAudit(deps.audit, { action: 'birthday-set', userId: String(userId), outcome: 'locked' }, [timezone]);
    return { ok: false, code: 'locked', text: COPY.locked };
  }
  if (!saved.ok) {
    await writeBirthdayAudit(deps.audit, { action: 'birthday-set', userId: String(userId), outcome: 'invalid' }, [timezone]);
    return { ok: false, code: 'invalid', text: COPY.invalid };
  }
  const changed = (saved.birthday?.revision || 1) > 1 && saved.status !== 'unchanged';
  await writeBirthdayAudit(deps.audit, {
    action: 'birthday-set',
    userId: String(userId),
    outcome: saved.status === 'unchanged' ? 'unchanged' : 'saved'
  }, auditSecrets(saved.birthday));
  return {
    ok: true,
    code: saved.status === 'unchanged' ? 'unchanged' : 'saved',
    text: changed ? COPY.savedChange : COPY.savedFirst
  };
}

async function clearBirthday(deps, userId) {
  if (!featureOn(deps)) return { ok: false, code: 'off', text: COPY.off };
  const nowMs = clockMs(deps);
  const policy = policyOf(deps);
  const saved = await deps.store.updateBirthday(userId, (current) => {
    if (!current || current.cleared) return { reject: true, reason: 'none' };
    if (changeLocked(current, nowMs, policy)) return { reject: true, reason: 'locked' };
    return {
      status: 'cleared',
      birthday: {
        ...current,
        cleared: true,
        visibility: 'hidden',
        announce: false,
        changedAt: new Date(nowMs).toISOString(),
        revision: (current.revision || 1) + 1
      }
    };
  });
  if (!saved.ok && saved.reason === 'locked') {
    await writeBirthdayAudit(deps.audit, { action: 'birthday-clear', userId: String(userId), outcome: 'locked' });
    return { ok: false, code: 'locked', text: COPY.locked };
  }
  if (!saved.ok) return { ok: false, code: 'none', text: COPY.noneSaved };
  await writeBirthdayAudit(deps.audit, { action: 'birthday-clear', userId: String(userId), outcome: 'cleared' });
  return { ok: true, code: 'cleared', text: COPY.cleared };
}

async function setBirthdayPrivacy(deps, userId, input = {}) {
  if (!featureOn(deps)) return { ok: false, code: 'off', text: COPY.off };
  const hasVisibility = input.visibility === 'hidden' || input.visibility === 'shown';
  const hasAnnounce = typeof input.announce === 'boolean';
  if (!hasVisibility && !hasAnnounce) return { ok: false, code: 'choose', text: COPY.choosePrivacy };
  const saved = await deps.store.updateBirthday(userId, (current) => {
    if (!current || current.cleared) return { reject: true, reason: 'none' };
    return {
      status: 'privacy',
      birthday: {
        ...current,
        visibility: hasVisibility ? input.visibility : (current.visibility === 'shown' ? 'shown' : 'hidden'),
        announce: hasAnnounce ? input.announce === true : current.announce === true
      }
    };
  });
  if (!saved.ok) return { ok: false, code: 'none', text: COPY.noneSaved };
  const birthday = saved.birthday;
  await writeBirthdayAudit(deps.audit, {
    action: 'birthday-privacy',
    userId: String(userId),
    outcome: 'saved',
    visibility: birthday.visibility,
    announce: birthday.announce === true
  }, auditSecrets(birthday));
  const text = birthday.visibility === 'shown' || birthday.announce === true ? COPY.shown : COPY.private;
  return { ok: true, code: 'privacy', text, visibility: birthday.visibility, announce: birthday.announce === true };
}

function displayNameOf(member) {
  return member?.displayName || member?.nickname || member?.user?.globalName || member?.user?.username || 'A member';
}

async function notifyGift(deps, userId, birthday, member) {
  const secrets = auditSecrets(birthday);
  const dm = { content: COPY.waiting, allowedMentions: NO_MENTIONS, reveal: true };
  try {
    if (typeof deps.deliverPrivate !== 'function') throw new Error('dm-unavailable');
    await deps.deliverPrivate(userId, dm);
    return { notify: 'dm', notifiedAt: new Date(clockMs(deps)).toISOString() };
  } catch {
    if (birthday.visibility !== 'shown' && birthday.announce !== true) return null;
    if (typeof deps.deliverChannel !== 'function') return null;
    try {
      const content = channelCopy(displayNameOf(member), secrets);
      await deps.deliverChannel({ content, allowedMentions: NO_MENTIONS });
      return { notify: 'channel', notifiedAt: new Date(clockMs(deps)).toISOString() };
    } catch {
      return null;
    }
  }
}

async function runBirthdayPass(deps = {}) {
  if (!featureOn(deps)) return { ok: false, reason: 'flag-off', ready: 0, expired: 0 };
  const coins = readBirthdayCoins(deps.env || process.env);
  if (!coins.ok) return { ok: false, reason: coins.reason, ready: 0, expired: 0 };
  const nowMs = clockMs(deps);
  const policy = policyOf(deps);
  const restrictedRoleIds = restrictedRolesFor(deps);
  const ids = typeof deps.store.userIds === 'function' ? deps.store.userIds() : [];
  let ready = 0;
  let expired = 0;
  for (const userId of ids) {
    const before = deps.store.getUser(userId)?.birthday;
    if (!before || before.cleared) continue;
    let member = null;
    if (typeof deps.loadMember === 'function') {
      try { member = await deps.loadMember(userId); } catch { member = null; }
    }
    const eligible = assessBirthdayEligibility(member, nowMs, { policy, restrictedRoleIds });
    const saved = await deps.store.updateBirthday(userId, (current) => {
      if (!current || current.cleared) return { keep: true };
      const gifts = { ...(current.gifts || {}) };
      let changed = false;
      for (const [year, gift] of Object.entries(gifts)) {
        if (!gift || gift.status !== 'ready' || gift.deferredUntil) continue;
        const expiry = Date.parse(gift.revealExpiresAt || '');
        if (Number.isFinite(expiry) && nowMs >= expiry) {
          gifts[year] = { ...gift, status: 'expired' };
          changed = true;
          expired += 1;
        }
      }
      if (eligible.ok) {
        for (const year of candidateYears(nowMs, current.timezone)) {
          if (gifts[year]) continue;
          const scheduledAt = deliveryInstant(current, year, policy.deliveryHour);
          if (scheduledAt == null || nowMs < scheduledAt) continue;
          if (nowMs >= scheduledAt + policy.revealMs) continue;
          if (!delaySatisfied(current, scheduledAt, policy)) continue;
          gifts[year] = {
            status: 'ready',
            provider: 'coins',
            scheduledAt: new Date(scheduledAt).toISOString(),
            revealExpiresAt: new Date(scheduledAt + policy.revealMs).toISOString(),
            readyAt: new Date(nowMs).toISOString()
          };
          changed = true;
          ready += 1;
        }
      }
      if (!changed) return { keep: true };
      return { birthday: { ...current, gifts } };
    });
    const birthday = saved.birthday;
    if (!birthday) continue;
    for (const [year, gift] of Object.entries(birthday.gifts || {})) {
      if (gift.status !== 'ready' || gift.notifiedAt || !eligible.ok) continue;
      const notice = await notifyGift(deps, userId, birthday, member);
      if (!notice) continue;
      await deps.store.updateBirthday(userId, (current) => {
        if (!current?.gifts?.[year] || current.gifts[year].notifiedAt) return { keep: true };
        return {
          birthday: {
            ...current,
            gifts: { ...current.gifts, [year]: { ...current.gifts[year], ...notice } }
          }
        };
      });
      await writeBirthdayAudit(deps.audit, {
        action: 'birthday-ready',
        userId: String(userId),
        outcome: notice.notify,
        giftYear: Number(year),
        provider: 'coins'
      }, auditSecrets(birthday));
    }
  }
  return { ok: true, ready, expired };
}

async function describeBirthdayGift(deps, userId) {
  if (!featureOn(deps)) return { ok: false, code: 'off', text: COPY.off, reveal: false };
  const nowMs = clockMs(deps);
  const birthday = deps.store.getUser(userId)?.birthday;
  const open = claimableGift(birthday, nowMs);
  if (!open && revealedThisWindow(birthday, nowMs)) return { ok: true, code: 'already', text: COPY.already, reveal: false };
  if (!open) return { ok: false, code: 'none', text: COPY.none, reveal: false };
  if (open.kind === 'deferred') return { ok: true, code: 'deferred', text: COPY.tomorrow, reveal: false };
  return { ok: true, code: 'waiting', text: COPY.waiting, reveal: true, giftYear: Number(open.year) };
}

async function alertStaff(deps, userId, giftYear) {
  if (typeof deps.alertStaff !== 'function') return false;
  await deps.alertStaff({
    content: COPY.staff,
    allowedMentions: NO_MENTIONS,
    userId: String(userId),
    giftYear
  });
  return true;
}

async function claimBirthdayGift(deps, userId) {
  if (!featureOn(deps)) return { ok: false, code: 'off', text: COPY.off };
  const nowMs = clockMs(deps);
  const policy = policyOf(deps);
  const coins = readBirthdayCoins(deps.env || process.env);
  if (!coins.ok) return { ok: false, code: 'not-ready', text: COPY.notReady, reason: coins.reason };
  let member = null;
  if (typeof deps.loadMember === 'function') {
    try { member = await deps.loadMember(userId); } catch { member = null; }
  }
  const eligible = assessBirthdayEligibility(member, nowMs, { policy, restrictedRoleIds: restrictedRolesFor(deps) });
  if (!eligible.ok) return { ok: false, code: 'unavailable', text: COPY.unavailable, reason: eligible.reason };
  const birthday = deps.store.getUser(userId)?.birthday;
  const open = claimableGift(birthday, nowMs);
  if (!open && revealedThisWindow(birthday, nowMs)) return { ok: true, code: 'already', text: COPY.already };
  if (!open) return { ok: false, code: 'none', text: COPY.none };
  if (open.kind === 'deferred') return { ok: true, code: 'deferred', text: COPY.tomorrow };
  if (open.gift.status === 'revealed') return { ok: true, code: 'already', text: COPY.already };
  const giftYear = Number(open.year);
  let granted;
  try {
    granted = await grantBirthdayProvider('coins', deps.economy, {
    discordUserId: String(userId),
    giftYear,
    idempotencyKey: `birthday-gift:${userId}:${giftYear}`,
      env: deps.env || process.env
    });
  } catch {
    return { ok: false, code: 'not-ready', text: COPY.notReady, reason: 'grant-failed' };
  }
  if (granted?.deferred === true) {
    const retryAt = granted.retryAt || new Date(nowMs + policy.schedulerMs).toISOString();
    const day = utcDayKey(nowMs);
    const shouldAlert = open.gift.alertedFor !== day;
    await deps.store.updateBirthday(userId, (current) => {
      const gift = current?.gifts?.[String(giftYear)];
      if (!gift || gift.status === 'revealed') return { keep: true };
      return {
        birthday: {
          ...current,
          gifts: {
            ...current.gifts,
            [String(giftYear)]: { ...gift, deferredUntil: retryAt, alertedFor: shouldAlert ? day : gift.alertedFor }
          }
        }
      };
    });
    if (shouldAlert) {
      try { await alertStaff(deps, userId, giftYear); } catch { /* the present stays deferred */ }
    }
    await writeBirthdayAudit(deps.audit, {
      action: 'birthday-defer',
      userId: String(userId),
      outcome: 'deferred',
      giftYear,
      provider: 'coins'
    }, auditSecrets(birthday));
    return { ok: true, code: 'deferred', text: COPY.tomorrow };
  }
  if (!granted || granted.ok === false) {
    return { ok: false, code: 'not-ready', text: COPY.notReady, reason: granted?.skipped || granted?.reason || 'grant-failed' };
  }
  await deps.store.updateBirthday(userId, (current) => {
    const gift = current?.gifts?.[String(giftYear)];
    if (!gift) return { keep: true };
    return {
      birthday: {
        ...current,
        gifts: {
          ...current.gifts,
          [String(giftYear)]: {
            ...gift,
            status: 'revealed',
            revealedAt: new Date(nowMs).toISOString(),
            provider: 'coins'
          }
        }
      }
    };
  });
  await writeBirthdayAudit(deps.audit, {
    action: 'birthday-reveal',
    userId: String(userId),
    outcome: granted.duplicate === true ? 'duplicate' : 'revealed',
    giftYear,
    provider: 'coins'
  }, auditSecrets(birthday));
  if (granted.duplicate === true) return { ok: true, code: 'already', text: COPY.already, duplicate: true };
  return { ok: true, code: 'revealed', text: openedCopy(granted.amount), amount: granted.amount || null };
}

module.exports = {
  featureOn,
  claimableGift,
  setBirthday,
  clearBirthday,
  setBirthdayPrivacy,
  runBirthdayPass,
  describeBirthdayGift,
  claimBirthdayGift
};
