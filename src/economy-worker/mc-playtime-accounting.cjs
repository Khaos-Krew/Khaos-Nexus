'use strict';

const MC_DAILY_CAP_MS = 8 * 60 * 60 * 1000;
const PRESENCE_TTL_MS = 3 * 60 * 1000;
const MAX_ACCOUNTING_GAP_MS = 10 * 60 * 1000;

function ctDayKey(nowMs, timeZone = 'America/Chicago') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(nowMs));
}

function minecraftServerName(value) {
  const server = String(value || '').trim().toLowerCase();
  if (!/^minecraft(?:-[a-z0-9][a-z0-9_-]{0,32})?$/.test(server)) return '';
  return server;
}

function isMinecraftPresenceKey(key) {
  return minecraftServerName(key) !== '';
}

function otherPresenceOnline(presence, nowMs, ttlMs = PRESENCE_TTL_MS) {
  for (const [key, entry] of Object.entries(presence || {})) {
    if (isMinecraftPresenceKey(key) || entry?.online !== true) continue;
    const at = Date.parse(entry.at);
    if (Number.isFinite(at) && nowMs - at <= ttlMs) return key;
  }
  return '';
}

function planMinecraftContribution({
  mcCountedDay = '',
  mcCountedMs = 0,
  mcLifetimeMs = 0,
  mcOnline = false,
  lastMcOnlineAt = null,
  online = false,
  nowMs,
  accountingGap = 0,
  otherOnline = false,
  otherSource = 'ark',
  maxGapMs = MAX_ACCOUNTING_GAP_MS
} = {}) {
  const day = ctDayKey(nowMs);
  let counted = Number(mcCountedMs || 0);
  if (mcCountedDay !== day) counted = 0;
  let lifetime = Number(mcLifetimeMs || 0);
  const previousMc = Number(lastMcOnlineAt);
  let mcDelta = 0;
  if (online && mcOnline && Number.isFinite(previousMc)) {
    mcDelta = Math.max(0, Math.min(nowMs - previousMc, maxGapMs));
  }
  lifetime += mcDelta;
  const requestedGap = Math.max(0, Number(accountingGap) || 0);
  let gap = requestedGap;
  let overflowDroppedMs = 0;
  let capHit = false;
  let creditSource = 'minecraft';
  if (otherOnline) {
    creditSource = otherSource || 'ark';
  } else {
    const room = Math.max(0, MC_DAILY_CAP_MS - counted);
    if (gap > room) {
      overflowDroppedMs = gap - room;
      gap = room;
      capHit = true;
    }
    counted += gap;
    if (room <= 0) capHit = true;
  }
  return {
    gap,
    overflowDroppedMs,
    capHit,
    creditSource,
    mcCountedDay: day,
    mcCountedMs: counted,
    mcLifetimeMs: lifetime,
    mcOnline: Boolean(online),
    lastMcOnlineAt: nowMs
  };
}

module.exports = {
  MC_DAILY_CAP_MS,
  PRESENCE_TTL_MS,
  MAX_ACCOUNTING_GAP_MS,
  ctDayKey,
  minecraftServerName,
  isMinecraftPresenceKey,
  otherPresenceOnline,
  planMinecraftContribution
};
