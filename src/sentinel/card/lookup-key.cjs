'use strict';

const { catalog, gameById, platformById, platformCatalog, lookupSkeleton } = require('./tag-validate.cjs');

const SUFFIX_SLOTS = new Set([
  'game:diablo4',
  'game:destiny2',
  'game:battlenet',
  'game:xbox',
  'game:minecraft_bedrock',
  'platform:battlenet',
  'platform:riot',
  'platform:xbox'
]);

const QUERY_MIN = 3;
const QUERY_MAX = 40;

function isSuffixSlot(slot) {
  return SUFFIX_SLOTS.has(String(slot || ''));
}

function stripMatch(value) {
  return String(value || '').replace(/[\s_.\-]+/g, '');
}

function parseLookupText(text) {
  const skeleton = lookupSkeleton(text);
  const hash = skeleton.indexOf('#');
  if (hash >= 0) {
    const name = stripMatch(skeleton.slice(0, hash));
    const suffix = stripMatch(skeleton.slice(hash + 1));
    return { full: `${name}#${suffix}`, base: name, hasSuffix: true };
  }
  const full = stripMatch(skeleton);
  return { full, base: full, hasSuffix: false };
}

function lookupKey(slot, text) {
  const parsed = parseLookupText(text);
  if (!isSuffixSlot(slot)) {
    return { full: stripMatch(lookupSkeleton(text)), base: null, hasSuffix: false };
  }
  if (!parsed.hasSuffix) return { full: parsed.full, base: parsed.full, hasSuffix: false };
  return { full: parsed.full, base: parsed.base, hasSuffix: true };
}

function slotOf(kind, id) {
  return `${kind}:${id}`;
}

function parseWhere(value, games = catalog(), platforms = platformCatalog()) {
  const text = String(value || '').trim();
  if (!text) return { slot: null, kind: null, id: null };
  const match = /^(game|platform):([a-z0-9_]{1,32})$/.exec(text);
  if (!match) return null;
  if (match[1] === 'game' && !gameById(match[2], games)) return null;
  if (match[1] === 'platform' && !platformById(match[2], platforms)) return null;
  return { slot: slotOf(match[1], match[2]), kind: match[1], id: match[2] };
}

function suggestWhere(query, games = catalog(), platforms = platformCatalog()) {
  const gameChoices = games.map((entry) => ({ name: entry.label, value: slotOf('game', entry.id) }));
  const platformChoices = platforms.map((entry) => {
    const collide = games.some((game) => String(game.label || '').toLowerCase() === String(entry.label || '').toLowerCase());
    return { name: collide ? `${entry.label} account` : entry.label, value: slotOf('platform', entry.id) };
  });
  const needle = String(query || '').trim().toLowerCase();
  return [...gameChoices, ...platformChoices]
    .filter((choice) => {
      if (!needle) return true;
      return choice.name.toLowerCase().includes(needle) || choice.value.includes(needle);
    })
    .slice(0, 25);
}

function slotLabel(slot, record, games = catalog(), platforms = platformCatalog()) {
  const text = String(slot || '');
  const split = text.indexOf(':');
  const kind = split >= 0 ? text.slice(0, split) : '';
  const id = split >= 0 ? text.slice(split + 1) : text;
  if (kind === 'platform') return platformById(id, platforms)?.label || id;
  if (id === 'other') {
    const name = String(record?.tags?.other?.game || '').trim();
    return name || 'Other';
  }
  return gameById(id, games)?.label || id;
}

module.exports = {
  SUFFIX_SLOTS,
  QUERY_MIN,
  QUERY_MAX,
  isSuffixSlot,
  stripMatch,
  parseLookupText,
  lookupKey,
  parseWhere,
  suggestWhere,
  slotLabel
};
