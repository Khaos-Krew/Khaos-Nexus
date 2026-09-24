'use strict';

// Diablo IV has no official public event API. World boss and helltide times
// come from the diablo4.life community tracker when that JSON is usable.
// Legion stays on the local cadence. Helltide report history is not requested:
// that public reports array was stale (2024) on 2026-09-24 and would show old
// spawns as current.

const DIABLO4_LIFE_TRACKERS_URL = 'https://diablo4.life/api/trackers/list';
const TRACKER_USER_AGENT = 'KhaosNexus-Sanctuary/1.0';
const TRACKER_TIMEOUT_MS = 5000;
const TRACKER_CACHE_TTL_MS = 5 * 60 * 1000;
const TRACKER_BODY_MAX = 32768;

const HOUR_MS = 60 * 60 * 1000;
const HELLTIDE_WINDOW_MS = 55 * 60 * 1000;
const WORLD_BOSS_PERIOD_MS = 210 * 60 * 1000;
const WORLD_BOSS_WINDOW_MS = 15 * 60 * 1000;
const LEGION_PERIOD_MS = 25 * 60 * 1000;
const LEGION_WINDOW_MS = 4 * 60 * 1000;

// Two public schedule pages agreed on this spawn during the 2026-09-23 check.
// Legion minute marks on those same pages disagreed, so legion stays unpinned
// unless SANCTUARY_LEGION_ANCHOR is set.
const WORLD_BOSS_COMMUNITY_ANCHOR = '2026-09-23T23:30:00.000Z';
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function createTrackerCache() {
  return { entry: null, pending: null };
}

const moduleTrackerCache = createTrackerCache();

function parseInstant(value) {
  const text = String(value || '').trim();
  if (!UTC_INSTANT.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function projectCycle(now, anchor, period, windowMs) {
  const index = Math.floor((now - anchor) / period);
  let start = anchor + index * period;
  if (now >= start + windowMs) start += period;
  const end = start + windowMs;
  return { start, end, active: now >= start && now < end };
}

function helltideWindow(now) {
  const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const start = now >= hour + HELLTIDE_WINDOW_MS ? hour + HOUR_MS : hour;
  const end = start + HELLTIDE_WINDOW_MS;
  return { start, end, active: now >= start && now < end };
}

function worldBossWindow(now, env = {}) {
  const override = parseInstant(env.SANCTUARY_WORLD_BOSS_ANCHOR);
  const anchor = override ?? Date.parse(WORLD_BOSS_COMMUNITY_ANCHOR);
  return {
    ...projectCycle(now, anchor, WORLD_BOSS_PERIOD_MS, WORLD_BOSS_WINDOW_MS),
    phase: override == null ? 'built-in' : 'env'
  };
}

function legionWindow(now, env = {}) {
  const anchor = parseInstant(env.SANCTUARY_LEGION_ANCHOR);
  if (anchor == null) return { pinned: false };
  return { pinned: true, ...projectCycle(now, anchor, LEGION_PERIOD_MS, LEGION_WINDOW_MS) };
}

function discordTime(ms, style) {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function discordStamp(ms) {
  return `${discordTime(ms, 'R')} (${discordTime(ms, 'F')})`;
}

function communityEventSchedule(now = Date.now(), env = {}) {
  return {
    now,
    helltide: helltideWindow(now),
    worldBoss: worldBossWindow(now, env),
    legion: legionWindow(now, env)
  };
}

function publicLabel(value, max = 80) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/@/g, '@\u200b')
    .replace(/[\\`*_~|<>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function finiteEpochMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const ms = Math.trunc(value);
  if (ms < 1_000_000_000_000 || ms > 9_999_999_999_999) return null;
  return ms;
}

function reportedEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const name = publicLabel(value.name);
  const location = publicLabel(value.location);
  const time = finiteEpochMs(value.time);
  if (!name && !location && time == null) return null;
  return { name, location, time };
}

function sameSpawn(left, right) {
  if (!left || !right) return false;
  if (left.time != null && right.time != null) return left.time === right.time && left.name === right.name;
  return left.name === right.name && left.location === right.location && left.time === right.time;
}

function helltideApproxLine(helltide) {
  const when = helltide.active
    ? `live until ${discordTime(helltide.end, 't')} (${discordTime(helltide.end, 'R')}). Next starts ${discordTime(helltide.start + HOUR_MS, 'R')}.`
    : `next starts ${discordTime(helltide.start, 'R')} (${discordTime(helltide.start, 't')}).`;
  return `Approximate: ${when} Starts at the top of each hour and runs about 55 minutes.`;
}

function worldBossApproxLine(boss) {
  const when = boss.active
    ? `live until ${discordTime(boss.end, 'R')}. Next spawn ${discordTime(boss.start + WORLD_BOSS_PERIOD_MS, 'R')}.`
    : `next spawn ${discordTime(boss.start, 'R')} (${discordTime(boss.start, 't')}). The window is about 15 minutes.`;
  const phase = boss.phase === 'env'
    ? 'World boss phase: SANCTUARY_WORLD_BOSS_ANCHOR.'
    : 'World boss phase: community seed 2026-09-23 23:30 UTC, then every 210 minutes.';
  return `Approximate: ${when} ${phase} The boss name is not predicted.`;
}

function legionLine(legion) {
  if (legion.pinned) {
    return legion.active
      ? 'Approximate pinned phase is live until ' + `${discordTime(legion.end, 'R')}. Legion is not wired to the live feed yet.`
      : 'Approximate pinned phase next starts ' + `${discordTime(legion.start, 'R')}. Legion is not wired to the live feed yet.`;
  }
  return 'Approximate only, about every 25 minutes for about 4 minutes. Legion is not wired to the live feed yet. Public trackers do not share one phase, so this bot does not count one down.';
}

function eventTimeClause(event, now, upcomingVerb) {
  if (event.time == null) return '';
  const verb = event.time >= now ? upcomingVerb : 'reported';
  return ` ${verb} ${discordStamp(event.time)}`;
}

function eventPlace(event, fallback) {
  const name = event.name || fallback;
  return event.location ? `${name} at ${event.location}` : name;
}

function trackerFooter(fetchedAt, ok) {
  const stamp = new Date(fetchedAt).toISOString();
  const state = ok ? 'community data from diablo4.life' : 'community data from diablo4.life unavailable';
  return `Sanctuary Nexus • ${state} • not Blizzard-official • fetched ${stamp}`.slice(0, 2048);
}

function embedMessage(lines, footer) {
  return {
    embeds: [{
      title: 'Sanctuary event timers',
      description: lines.join('\n').slice(0, 4000),
      footer: { text: footer }
    }],
    allowedMentions: { parse: [] }
  };
}

function eventTimerMessage(schedule) {
  const helltide = schedule.helltide;
  const boss = schedule.worldBoss;
  const legion = schedule.legion;
  const helltideLine = helltide.active
    ? `Live until ${discordTime(helltide.end, 't')} (${discordTime(helltide.end, 'R')}). Next starts ${discordTime(helltide.start + HOUR_MS, 'R')}.`
    : `Next starts ${discordTime(helltide.start, 'R')} (${discordTime(helltide.start, 't')}).`;
  const bossLine = boss.active
    ? `Live until ${discordTime(boss.end, 'R')}. Next spawn ${discordTime(boss.start + WORLD_BOSS_PERIOD_MS, 'R')}.`
    : `Next spawn ${discordTime(boss.start, 'R')} (${discordTime(boss.start, 't')}). The window is about 15 minutes.`;
  const pinnedLegion = legion.pinned
    ? (legion.active
      ? `Pinned phase is live until ${discordTime(legion.end, 'R')}.`
      : `Pinned phase next starts ${discordTime(legion.start, 'R')}.`)
    : 'About every 25 minutes for about 4 minutes. Public trackers do not share one phase, so this bot does not count one down.';
  const phaseLine = boss.phase === 'env'
    ? 'World boss phase: SANCTUARY_WORLD_BOSS_ANCHOR.'
    : 'World boss phase: community seed 2026-09-23 23:30 UTC, then every 210 minutes.';

  return embedMessage([
    'Approximate community schedule. Confirm the in-game map marker before you travel. This is not a Blizzard feed.',
    '',
    `**Helltide** — ${helltideLine}`,
    'Starts at the top of each hour and runs about 55 minutes.',
    '',
    `**World boss** — ${bossLine}`,
    'About every 3.5 hours. The boss name is not predicted.',
    phaseLine,
    '',
    `**Legion** — ${pinnedLegion}`,
    '',
    'Post a group with `/sanctuary lfg`.'
  ], 'Sanctuary Nexus • approximate community schedule');
}

function liveTimerMessage(schedule, payload, fetchedAt, now) {
  const boss = reportedEvent(payload?.worldBoss);
  const next = reportedEvent(payload?.nextWorldBoss);
  const helltide = reportedEvent(payload?.helltide);
  const lines = [
    'Live community trackers from diablo4.life. This is not a Blizzard feed. Confirm the in-game map marker before you travel.',
    ''
  ];

  if (boss) {
    lines.push(`**World boss** — ${eventPlace(boss, 'Reported world boss')}${eventTimeClause(boss, now, 'spawns')}.`);
  }
  if (next && !sameSpawn(boss, next)) {
    lines.push(`**Next world boss** — ${eventPlace(next, 'Reported world boss')}${eventTimeClause(next, now, 'spawns')}.`);
  }
  if (!boss && !next) {
    lines.push('**World boss** — No community world boss report right now.');
    lines.push(worldBossApproxLine(schedule.worldBoss));
  }
  lines.push('');

  if (helltide) {
    lines.push(`**Helltide** — ${eventPlace(helltide, 'Helltide')}${eventTimeClause(helltide, now, 'ends')}.`);
  } else {
    lines.push('**Helltide** — No community Helltide report right now.');
    lines.push(helltideApproxLine(schedule.helltide));
  }
  lines.push('');
  lines.push(`**Legion** — ${legionLine(schedule.legion)}`);
  lines.push('');
  lines.push('Post a group with `/sanctuary lfg`.');
  return embedMessage(lines, trackerFooter(fetchedAt, true));
}

function unavailableTimerMessage(schedule, fetchedAt) {
  const base = eventTimerMessage(schedule);
  return embedMessage([
    'Community tracker did not answer. The schedule below is approximate, not a live report.',
    '',
    base.embeds[0].description
  ], trackerFooter(fetchedAt, false));
}

async function readTrackerPayload(response) {
  if (response && typeof response.text === 'function') {
    const text = await response.text();
    if (typeof text !== 'string' || text.length === 0 || text.length > TRACKER_BODY_MAX) return null;
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  }
  if (response && typeof response.json === 'function') {
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    return payload;
  }
  return null;
}

async function requestCommunityTrackers({ fetchImpl, now, timeoutMs }) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : global.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, error: 'network', fetchedAt: now };
  let response;
  try {
    response = await fetchFn(DIABLO4_LIFE_TRACKERS_URL, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': TRACKER_USER_AGENT
      },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return { ok: false, error: 'network', fetchedAt: now };
  }
  const status = Number(response?.status) || 0;
  if (!response || response.ok !== true) return { ok: false, error: 'status', status, fetchedAt: now };
  try {
    const payload = await readTrackerPayload(response);
    if (!payload) return { ok: false, error: 'body', fetchedAt: now };
    return { ok: true, source: 'network', payload, fetchedAt: now };
  } catch {
    return { ok: false, error: 'body', fetchedAt: now };
  }
}

async function fetchCommunityTrackers({
  fetchImpl,
  now = Date.now(),
  cache = moduleTrackerCache,
  timeoutMs = TRACKER_TIMEOUT_MS
} = {}) {
  const store = cache && typeof cache === 'object' ? cache : moduleTrackerCache;
  if (store.entry && Number.isFinite(store.entry.fetchedAt) && now - store.entry.fetchedAt < TRACKER_CACHE_TTL_MS) {
    return { ok: true, source: 'cache', payload: store.entry.payload, fetchedAt: store.entry.fetchedAt };
  }
  if (store.pending) return store.pending;
  const boundedTimeout = Number.isFinite(timeoutMs) ? Math.min(15000, Math.max(1, Math.trunc(timeoutMs))) : TRACKER_TIMEOUT_MS;
  const run = requestCommunityTrackers({ fetchImpl, now, timeoutMs: boundedTimeout }).then((result) => {
    if (result.ok) store.entry = { payload: result.payload, fetchedAt: result.fetchedAt };
    return result;
  }).finally(() => {
    if (store.pending === run) store.pending = null;
  });
  store.pending = run;
  return run;
}

async function buildSanctuaryTimerMessage({
  now = Date.now(),
  env = {},
  fetchImpl,
  cache,
  timeoutMs
} = {}) {
  const schedule = communityEventSchedule(now, env);
  let result;
  try {
    result = await fetchCommunityTrackers({ fetchImpl, now, cache, timeoutMs });
  } catch {
    result = { ok: false, error: 'network', fetchedAt: now };
  }
  if (!result?.ok) return unavailableTimerMessage(schedule, result?.fetchedAt || now);
  return liveTimerMessage(schedule, result.payload, result.fetchedAt || now, now);
}

module.exports = {
  DIABLO4_LIFE_TRACKERS_URL,
  TRACKER_USER_AGENT,
  TRACKER_TIMEOUT_MS,
  TRACKER_CACHE_TTL_MS,
  WORLD_BOSS_COMMUNITY_ANCHOR,
  WORLD_BOSS_PERIOD_MS,
  HELLTIDE_WINDOW_MS,
  communityEventSchedule,
  eventTimerMessage,
  buildSanctuaryTimerMessage,
  fetchCommunityTrackers,
  createTrackerCache,
  helltideWindow,
  worldBossWindow,
  legionWindow
};
