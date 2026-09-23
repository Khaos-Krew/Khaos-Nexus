'use strict';

// Diablo IV has no official public event API. Community JSON feeds checked
// during implementation were unreachable, redirected, or stale, so these
// timers are computed from published cadence rules. They do not fetch.

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

function communityEventSchedule(now = Date.now(), env = {}) {
  return {
    now,
    helltide: helltideWindow(now),
    worldBoss: worldBossWindow(now, env),
    legion: legionWindow(now, env)
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
  const legionLine = legion.pinned
    ? (legion.active
      ? `Pinned phase is live until ${discordTime(legion.end, 'R')}.`
      : `Pinned phase next starts ${discordTime(legion.start, 'R')}.`)
    : 'About every 25 minutes for about 4 minutes. Public trackers do not share one phase, so this bot does not count one down.';
  const phaseLine = boss.phase === 'env'
    ? 'World boss phase: SANCTUARY_WORLD_BOSS_ANCHOR.'
    : 'World boss phase: community seed 2026-09-23 23:30 UTC, then every 210 minutes.';

  return {
    embeds: [{
      title: 'Sanctuary event timers',
      description: [
        'Approximate community schedule. Confirm the in-game map marker before you travel. This is not a Blizzard feed.',
        '',
        `**Helltide** — ${helltideLine}`,
        'Starts at the top of each hour and runs about 55 minutes.',
        '',
        `**World boss** — ${bossLine}`,
        'About every 3.5 hours. The boss name is not predicted.',
        phaseLine,
        '',
        `**Legion** — ${legionLine}`,
        '',
        'Post a group with `/sanctuary lfg`.'
      ].join('\n').slice(0, 4000),
      footer: { text: 'Sanctuary Nexus • approximate community schedule' }
    }],
    allowedMentions: { parse: [] }
  };
}

module.exports = {
  WORLD_BOSS_COMMUNITY_ANCHOR,
  WORLD_BOSS_PERIOD_MS,
  HELLTIDE_WINDOW_MS,
  communityEventSchedule,
  eventTimerMessage,
  helltideWindow,
  worldBossWindow,
  legionWindow
};
