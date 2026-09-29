'use strict';

const crypto = require('node:crypto');
const { cardRestrictedRoleIds } = require('./card-config.cjs');
const { structuralReason } = require('./tag-validate.cjs');
const { QUERY_MAX, QUERY_MIN, parseLookupText, parseWhere, slotLabel } = require('./lookup-key.cjs');

const LOOKUP_MISS_TEXT = 'No findable member with that tag.';
const LOOKUP_OFF_TEXT = 'Tag lookup is turned off.';
const LOOKUP_STARTING_TEXT = 'Lookup is starting up, try again shortly.';
const LOOKUP_PAD_MS = 150;
const MEMBER_CAP = 5;
const STAFF_CAP = 25;
const TENURE_MS = 7 * 24 * 60 * 60 * 1000;

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function orderDigest(secret, requesterId, normalizedQuery, day, userId, slot) {
  return crypto.createHmac('sha256', secret)
    .update(`${requesterId}|${normalizedQuery}|${day}|${userId}|${slot}`)
    .digest('hex');
}

function orderClaimants(items, { secret, requesterId, normalizedQuery, now }) {
  const copy = items.slice();
  if (secret) {
    const day = utcDay(now);
    copy.sort((left, right) => {
      const a = orderDigest(secret, requesterId, normalizedQuery, day, left.meta.userId, left.meta.slot);
      const b = orderDigest(secret, requesterId, normalizedQuery, day, right.meta.userId, right.meta.slot);
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    return copy;
  }
  copy.sort((left, right) => {
    const a = `${left.meta.userId}|${left.meta.slot}`;
    const b = `${right.meta.userId}|${right.meta.slot}`;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return copy;
}

function pace(started, padMs) {
  const pad = Number.isFinite(padMs) ? padMs : LOOKUP_PAD_MS;
  const wait = pad - (Date.now() - started);
  if (wait <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, wait));
}

function memberRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.has === 'function' && typeof cache.keys === 'function' && !Array.isArray(cache)) {
    return [...cache.keys()].map((id) => String(id));
  }
  if (cache instanceof Map) return [...cache.keys()].map((id) => String(id));
  if (Array.isArray(cache)) {
    return cache.map((role) => (typeof role === 'string' ? role : String(role?.id || ''))).filter(Boolean);
  }
  return [];
}

function isTimedOut(member, now) {
  const until = member?.communicationDisabledUntil;
  if (until instanceof Date && until.getTime() > now) return true;
  const stamp = Number(member?.communicationDisabledUntilTimestamp);
  return Number.isFinite(stamp) && stamp > now;
}

function hasTenure(member, now, tenureMs = TENURE_MS) {
  const joined = member?.joinedAt;
  const at = joined instanceof Date ? joined.getTime() : Date.parse(joined);
  if (!Number.isFinite(at)) return false;
  return now - at >= tenureMs;
}

function requesterAllowed(member, now, restricted) {
  if (!member) return false;
  if (!hasTenure(member, now)) return false;
  if (isTimedOut(member, now)) return false;
  const roles = memberRoleIds(member);
  if (roles.some((id) => restricted.includes(id))) return false;
  return true;
}

function displayNameOf(member) {
  return member?.displayName || member?.nickname || member?.user?.globalName || member?.user?.username || 'Player';
}

async function writeAudit(audit, row) {
  if (!audit || typeof audit.append !== 'function') return;
  await audit.append(row);
}

async function performLookup({
  query = '',
  where = null,
  actorId,
  guildId,
  member = null,
  store,
  index,
  limits,
  audit = null,
  config = {},
  env = process.env,
  now = Date.now(),
  fetchMember = async () => null,
  staff = false,
  staffReason = '',
  findEnabled = false,
  lookupPadMs = LOOKUP_PAD_MS,
  restrictedRoleIds = null
} = {}) {
  const started = Date.now();
  const finish = async (result) => {
    await pace(started, lookupPadMs);
    return result;
  };
  if (findEnabled !== true) return finish({ kind: 'disabled', text: LOOKUP_OFF_TEXT });
  if (!index?.ready) return finish({ kind: 'starting', text: LOOKUP_STARTING_TEXT });

  const clock = Number(now);
  const actor = String(actorId || '');
  const guild = String(guildId || '');
  const slotFilter = parseWhere(where);
  const game = slotFilter?.slot || null;

  const limit = limits.take(actor, guild, clock);
  if (!limit.ok) {
    await writeAudit(audit, {
      action: staff ? 'admin-find' : 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded: null,
      reason: staff ? String(staffReason || '') : limit.reason,
      outcome: limit.reason,
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({
      kind: 'miss',
      text: staff ? 'Lookup is temporarily limited.' : LOOKUP_MISS_TEXT,
      alert: limit.alert === true,
      reason: limit.reason
    });
  }

  if (!staff && !requesterAllowed(member, clock, restrictedRoleIds || cardRestrictedRoleIds(config, env))) {
    limits.noteMiss(actor, clock);
    await writeAudit(audit, {
      action: 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded: null,
      reason: 'ineligible',
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({ kind: 'miss', text: LOOKUP_MISS_TEXT, reason: 'ineligible' });
  }

  const screened = structuralReason(query);
  if (!screened.ok || !slotFilter) {
    limits.noteMiss(actor, clock);
    await writeAudit(audit, {
      action: staff ? 'admin-find' : 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded: null,
      reason: staff ? String(staffReason || '') : 'reject',
      outcome: 'reject',
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({ kind: 'miss', text: LOOKUP_MISS_TEXT, reason: 'reject' });
  }

  const parsed = parseLookupText(screened.value);
  const folded = parsed.hasSuffix ? parsed.full : parsed.base;
  if (folded.length < QUERY_MIN || folded.length > QUERY_MAX || parsed.full.length > QUERY_MAX) {
    if (staff) {
      await writeAudit(audit, {
        action: 'admin-find',
        actorId: actor,
        guildId: guild,
        game,
        folded: null,
        reason: String(staffReason || ''),
        outcome: 'reject',
        hit: false,
        hitCount: 0,
        resultIds: []
      });
      return finish({ kind: 'staff-short', text: 'Enter a tag between 3 and 40 characters.' });
    }
    limits.noteMiss(actor, clock);
    await writeAudit(audit, {
      action: 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded: null,
      reason: 'reject',
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({ kind: 'miss', text: LOOKUP_MISS_TEXT, reason: 'reject' });
  }

  const found = staff
    ? index.findPrefix({ prefix: folded, hasSuffix: parsed.hasSuffix, slot: slotFilter.slot })
    : index.findExact({ full: parsed.full, base: parsed.base, hasSuffix: parsed.hasSuffix, slot: slotFilter.slot });

  const visible = [];
  for (const meta of found) {
    const record = store.getUser(meta.userId);
    if (!staff && (record.findable !== true || record.hidden === true)) continue;
    visible.push({ meta, record });
  }

  const orderSecret = String(env?.CARD_FIND_ORDER_SECRET || '').trim();
  const claimantCount = new Set(visible.map((item) => item.meta.userId)).size;
  if (!staff && !orderSecret && claimantCount > MEMBER_CAP) {
    limits.noteMiss(actor, clock);
    await writeAudit(audit, {
      action: 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded,
      reason: 'miss',
      outcome: 'miss',
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({ kind: 'miss', text: LOOKUP_MISS_TEXT, reason: 'miss' });
  }
  const ordered = orderClaimants(visible, {
    secret: orderSecret,
    requesterId: actor,
    normalizedQuery: folded,
    now: clock
  }).slice(0, staff ? STAFF_CAP : MEMBER_CAP);
  const rows = [];
  for (const item of ordered) {
    let guildMember = null;
    try { guildMember = await fetchMember(item.meta.userId); } catch { guildMember = null; }
    if (!guildMember || guildMember.user?.bot === true || guildMember.bot === true) continue;
    const fresh = store.getUser(item.meta.userId);
    rows.push({
      userId: item.meta.userId,
      displayName: displayNameOf(guildMember),
      slotLabel: slotLabel(item.meta.slot, fresh),
      tag: item.meta.tag,
      hidden: fresh.hidden === true,
      findable: fresh.findable === true
    });
  }

  const distinctMembers = new Set(rows.map((row) => row.userId)).size;
  if (!rows.length) {
    limits.noteMiss(actor, clock);
    await writeAudit(audit, {
      action: staff ? 'admin-find' : 'lookup',
      actorId: actor,
      guildId: guild,
      game,
      folded,
      reason: staff ? String(staffReason || '') : 'miss',
      outcome: 'miss',
      hit: false,
      hitCount: 0,
      resultIds: []
    });
    return finish({
      kind: 'miss',
      text: staff ? 'No member with that tag.' : LOOKUP_MISS_TEXT,
      reason: 'miss'
    });
  }

  limits.noteHit(actor);
  await writeAudit(audit, {
    action: staff ? 'admin-find' : 'lookup',
    actorId: actor,
    guildId: guild,
    game,
    folded,
    reason: staff ? String(staffReason || '') : 'hit',
    outcome: 'hit',
    hit: true,
    hitCount: rows.length,
    resultIds: rows.map((row) => row.userId)
  });
  return finish({
    kind: 'hit',
    rows,
    duplicate: distinctMembers > 1,
    reason: 'hit'
  });
}

module.exports = {
  LOOKUP_MISS_TEXT,
  LOOKUP_OFF_TEXT,
  LOOKUP_STARTING_TEXT,
  LOOKUP_PAD_MS,
  MEMBER_CAP,
  STAFF_CAP,
  TENURE_MS,
  orderClaimants,
  pace,
  hasTenure,
  requesterAllowed,
  performLookup
};
