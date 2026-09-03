'use strict';

const SERVER_PREFIXES = Object.freeze({
  gen1: 'ARK_GEN1',
  astraeos: 'ARK_MAP2'
});

function normalizeServerId(value) {
  const serverId = String(value || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SERVER_PREFIXES, serverId)) {
    throw new Error(`Unsupported ARK source-of-truth server: ${serverId || '(empty)'}.`);
  }
  return serverId;
}

function prefixForServer(value) {
  return SERVER_PREFIXES[normalizeServerId(value)];
}

function safeDiffEntry(entry = {}) {
  return Object.freeze({
    key: String(entry.key || '').slice(0, 120),
    expected: String(entry.expected ?? '').slice(0, 180),
    actual: String(entry.actual ?? '').slice(0, 180)
  });
}

function summarizeConfigDiff(capture, { maxEntries = 12 } = {}) {
  const serverId = normalizeServerId(capture?.serverId);
  const gus = Array.isArray(capture?.diff?.gameUserSettings) ? capture.diff.gameUserSettings : [];
  const game = Array.isArray(capture?.diff?.game) ? capture.diff.game : [];
  const limit = Number.isInteger(maxEntries) && maxEntries >= 0 ? Math.min(maxEntries, 50) : 12;
  const combined = [
    ...gus.map((entry) => ({ section: 'GameUserSettings.ini', ...safeDiffEntry(entry) })),
    ...game.map((entry) => ({ section: 'Game.ini', ...safeDiffEntry(entry) }))
  ];
  const entries = combined.slice(0, limit).map((entry) => Object.freeze(entry));

  return Object.freeze({
    ok: true,
    readOnly: true,
    serverId,
    inSync: combined.length === 0,
    driftCount: combined.length,
    counts: Object.freeze({
      gameUserSettings: gus.length,
      game: game.length
    }),
    entries: Object.freeze(entries),
    truncated: combined.length > entries.length,
    checkedAt: new Date().toISOString()
  });
}

async function captureConfigDriftStatus({ serverId = 'gen1', capture, maxEntries = 12 } = {}) {
  const normalized = normalizeServerId(serverId);
  const captureFn = typeof capture === 'function'
    ? capture
    : require('./ark-live-config-diff.cjs').captureLiveConfigDiff;
  const result = await captureFn({ prefix: prefixForServer(normalized) });
  if (normalizeServerId(result?.serverId) !== normalized) {
    throw new Error(`ARK config drift capture returned unexpected server ${String(result?.serverId || '(empty)')}.`);
  }
  return summarizeConfigDiff(result, { maxEntries });
}

module.exports = {
  SERVER_PREFIXES,
  normalizeServerId,
  prefixForServer,
  safeDiffEntry,
  summarizeConfigDiff,
  captureConfigDriftStatus
};
