'use strict';

const { appendDisclaimer } = require('../panels.cjs');
const { collectDates, nextWeeklyReset } = require('../bungie/time.cjs');
const { packSections } = require('./layout.cjs');

const SECTIONS = Object.freeze([
  Object.freeze({ key: 'week', name: '🗓️ This Week' }),
  Object.freeze({ key: 'nightfall', name: '⚔️ Nightfall' }),
  Object.freeze({ key: 'raid', name: '🛡️ Raid & Dungeon' }),
  Object.freeze({ key: 'rewards', name: '🎁 Rewards' })
]);

const NIGHTFALL_MODES = new Set([16, 17, 46, 47]);
const RAID_MODES = new Set([4, 82]);

// Names Bungie uses on the milestone itself, without the words "raid" or "dungeon".
const KNOWN_RAIDS = Object.freeze([
  'last wish',
  'garden of salvation',
  'deep stone crypt',
  'vault of glass',
  'vow of the disciple',
  'kings fall',
  'root of nightmares',
  'crotas end',
  'salvations edge',
  'crown of sorrow',
  'leviathan',
  'eater of worlds',
  'spire of stars',
  'scourge of the past',
  'desert perpetual'
]);

const KNOWN_DUNGEONS = Object.freeze([
  'shattered throne',
  'pit of heresy',
  'prophecy',
  'grasp of avarice',
  'duality',
  'spire of the watcher',
  'ghosts of the deep',
  'warlords ruin',
  'vespers host',
  'sundered doctrine',
  'equilibrium'
]);

// Playlists whose names look like rewards ("pinnacle") but are activities.
const KNOWN_PLAYLISTS = Object.freeze([
  'pinnacle ops'
]);

function milestoneRows(payload) {
  const response = payload?.Response || payload || {};
  if (Array.isArray(response)) return response;
  return Object.entries(response).map(([hash, value]) => ({
    ...(value && typeof value === 'object' ? value : {}),
    milestoneHash: value?.milestoneHash || hash
  }));
}

function stringList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.map((item) => String(item || '').trim()).filter(Boolean);
}

function entryMeta(value) {
  if (typeof value === 'string') return { name: value.trim() };
  if (!value || typeof value !== 'object') return { name: '' };
  return {
    name: String(value.name || '').trim(),
    category: value.category,
    friendlyName: value.friendlyName,
    activityModeTypes: value.activityModeTypes,
    activityNames: stringList(value.activityNames),
    modifiers: stringList(value.modifiers || value.modifierNames),
    weeklyChallenges: value.weeklyChallenges === true
  };
}

function normalizeActivityName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

function matchesKnown(name, list) {
  const text = normalizeActivityName(name);
  if (!text) return false;
  return list.some((item) => text === item || text.startsWith(`${item} `));
}

function modeSet(value) {
  const found = new Set();
  for (const mode of Array.isArray(value) ? value : []) {
    const number = Number(mode);
    if (Number.isFinite(number) && number > 0) found.add(number);
  }
  return found;
}

function modifierText(hints) {
  return (Array.isArray(hints.modifiers) ? hints.modifiers : []).join(' ');
}

function classifyText(name, hints) {
  const activities = Array.isArray(hints.activityNames) ? hints.activityNames.join(' ') : '';
  return `${name || ''} ${hints.friendlyName || ''} ${activities} ${modifierText(hints)}`.toLowerCase();
}

function knownRaidOrDungeon(name) {
  return matchesKnown(name, KNOWN_RAIDS) || matchesKnown(name, KNOWN_DUNGEONS);
}

function raidIdentity(name, hints, text) {
  if (knownRaidOrDungeon(name)) return true;
  for (const activity of Array.isArray(hints.activityNames) ? hints.activityNames : []) {
    if (knownRaidOrDungeon(activity)) return true;
  }
  if (text.includes('raid') || text.includes('dungeon')) return true;
  return [...modeSet(hints.activityModeTypes)].some((mode) => RAID_MODES.has(mode));
}

// Featured this week means the public milestone activity has challenge objectives.
// That array is DestinyPublicMilestoneChallengeActivity.challengeObjectiveHashes.
function featuredSignal(hints) {
  return hints.weeklyChallenges === true;
}

// Nightfall uses documented fields: milestone, activity, or modifier names, and
// DestinyActivityDefinition modes 16, 17, 46, and 47.
function nightfallIdentity(hints, text) {
  if (/\bnightfall\b|\bgrandmaster\b|\bordeal\b/.test(text)) return true;
  return [...modeSet(hints.activityModeTypes)].some((mode) => NIGHTFALL_MODES.has(mode));
}

function sectionFor(name, hints = {}) {
  const explicit = String(hints.category || '').toLowerCase();
  if (explicit === 'nightfall' || explicit === 'raid' || explicit === 'rewards' || explicit === 'week') return explicit;
  const text = classifyText(name, hints);
  const raid = raidIdentity(name, hints, text);
  const nightfall = nightfallIdentity(hints, text);
  if (nightfall && !raid) return 'nightfall';
  if (raid) return featuredSignal(hints) ? 'raid' : null;
  if (matchesKnown(name, KNOWN_PLAYLISTS)) return 'week';
  if (nightfall) return 'nightfall';
  if (/engram|reward|pinnacle|powerful|challenge/.test(text)) return 'rewards';
  return 'week';
}

function pushHash(hashes, value) {
  const number = Number(value);
  if (Number.isInteger(number) && number !== 0) hashes.push(number);
}

function liveActivityHashes(row) {
  const hashes = [];
  const activities = Array.isArray(row?.activities) ? row.activities : [];
  for (const activity of activities) {
    pushHash(hashes, activity?.activityHash);
    for (const variant of Array.isArray(activity?.variants) ? activity.variants : []) pushHash(hashes, variant?.activityHash);
  }
  for (const quest of Array.isArray(row?.availableQuests) ? row.availableQuests : []) {
    pushHash(hashes, quest?.activity?.activityHash);
  }
  return [...new Set(hashes)];
}

function definitionActivityHashes(definition) {
  const hashes = [];
  const definedQuests = definition?.quests && typeof definition.quests === 'object' ? Object.values(definition.quests) : [];
  for (const quest of definedQuests) {
    const map = quest?.activities && typeof quest.activities === 'object' ? Object.values(quest.activities) : [];
    for (const activity of map) {
      pushHash(hashes, activity?.conceptualActivityHash);
      const variants = activity?.variants && typeof activity.variants === 'object' ? Object.values(activity.variants) : [];
      for (const variant of variants) pushHash(hashes, variant?.activityHash);
    }
  }
  for (const activity of Array.isArray(definition?.activities) ? definition.activities : []) {
    pushHash(hashes, activity?.conceptualActivityHash);
    for (const hash of activity?.activityHashes || []) pushHash(hashes, hash);
  }
  return [...new Set(hashes)];
}

function activityHashesFor(definition, row) {
  const live = liveActivityHashes(row);
  return live.length ? live : definitionActivityHashes(definition);
}

function modesFromActivity(activity) {
  const modes = [];
  const direct = Number(activity?.activityModeType ?? activity?.directActivityModeType);
  if (Number.isFinite(direct) && direct > 0) modes.push(direct);
  for (const mode of Array.isArray(activity?.activityModeTypes) ? activity.activityModeTypes : []) {
    const value = Number(mode);
    if (Number.isFinite(value) && value > 0) modes.push(value);
  }
  return modes;
}

function visitLiveActivities(row, visit) {
  const activities = Array.isArray(row?.activities) ? row.activities : [];
  for (const activity of activities) {
    visit(activity);
    for (const variant of Array.isArray(activity?.variants) ? activity.variants : []) visit(variant);
  }
  for (const quest of Array.isArray(row?.availableQuests) ? row.availableQuests : []) {
    if (quest?.activity) visit(quest.activity);
  }
}

function hasChallengeObjectives(activity) {
  const hashes = Array.isArray(activity?.challengeObjectiveHashes) ? activity.challengeObjectiveHashes : [];
  return hashes.some((hash) => {
    const number = Number(hash);
    return Number.isInteger(number) && number !== 0;
  });
}

function rowHasWeeklyChallenges(row) {
  let found = false;
  visitLiveActivities(row, (activity) => {
    if (hasChallengeObjectives(activity)) found = true;
  });
  return found;
}

function liveSignals(row) {
  const modifierHashes = [];
  const modes = [];
  visitLiveActivities(row, (activity) => {
    if (!activity || typeof activity !== 'object') return;
    modes.push(...modesFromActivity(activity));
    for (const hash of Array.isArray(activity.modifierHashes) ? activity.modifierHashes : []) pushHash(modifierHashes, hash);
  });
  return { modifierHashes: [...new Set(modifierHashes)], modes };
}

function genericNightfallName(name) {
  return /^(the\s+)?(nightfall|grandmaster)(\s+strike)?$/i.test(String(name || '').trim());
}

function lookupDefinition(query, table, hash) {
  if (!query || typeof query.definition !== 'function') return null;
  try {
    return query.definition(table, hash) || null;
  } catch {
    return null;
  }
}

function describeMilestone(query, row) {
  const hash = row?.milestoneHash;
  const definition = lookupDefinition(query, 'DestinyMilestoneDefinition', hash);
  const fromDefinition = String(definition?.displayProperties?.name || '').trim();
  let fromQuery = '';
  if (!fromDefinition && query && typeof query.nameFor === 'function') {
    try {
      fromQuery = String(query.nameFor('DestinyMilestoneDefinition', hash) || '').trim();
    } catch {
      fromQuery = '';
    }
  }
  const live = liveSignals(row);
  const activityModeTypes = [...live.modes];
  const activityNames = [];
  for (const activityHash of activityHashesFor(definition, row)) {
    const activity = lookupDefinition(query, 'DestinyActivityDefinition', activityHash);
    activityModeTypes.push(...modesFromActivity(activity));
    const label = String(activity?.displayProperties?.name || '').trim();
    if (label) activityNames.push(label);
  }
  const modifiers = [];
  for (const modifierHash of live.modifierHashes) {
    const modifier = lookupDefinition(query, 'DestinyActivityModifierDefinition', modifierHash);
    const label = String(modifier?.displayProperties?.name || '').trim();
    if (label) modifiers.push(label);
  }
  const milestoneName = fromDefinition || fromQuery;
  const strike = activityNames.find((label) => label && label.toLowerCase() !== milestoneName.toLowerCase());
  const name = (!milestoneName || genericNightfallName(milestoneName)) && strike ? strike : milestoneName;
  return {
    name,
    friendlyName: String(definition?.friendlyName || ''),
    activityModeTypes,
    activityNames,
    modifiers,
    weeklyChallenges: rowHasWeeklyChallenges(row)
  };
}

function relativeTag(value) {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return `<t:${Math.floor(time / 1000)}:R>`;
}

function milestoneTime(row, resetAt, now) {
  const direct = Date.parse(row?.endDate || row?.resetDate || '');
  if (Number.isFinite(direct)) return direct;
  const availability = Date.parse(row?.availability?.endDate || row?.availabilityEndDate || '');
  if (Number.isFinite(availability)) return availability;
  const dates = collectDates(row);
  if (dates.length) {
    const future = dates.filter((time) => !now || time >= now).sort((left, right) => left - right);
    if (future.length) return future[0];
    return [...dates].sort((left, right) => right - left)[0];
  }
  return Number.isFinite(resetAt) && resetAt ? resetAt : null;
}

function renderWeeklyReset({ milestones, names = new Map(), now = Date.now() } = {}) {
  const rows = milestoneRows(milestones);
  const resetAt = nextWeeklyReset(now);
  const buckets = { week: [], nightfall: [], raid: [], rewards: [] };
  for (const row of rows) {
    const hash = String(row.milestoneHash || '');
    const meta = entryMeta(names.get(hash) || names.get(Number(hash)) || '');
    if (!meta.name) continue;
    const section = sectionFor(meta.name, {
      ...meta,
      weeklyChallenges: meta.weeklyChallenges || rowHasWeeklyChallenges(row)
    });
    if (!section || !buckets[section]) continue;
    buckets[section].push(meta.name);
  }
  const lines = [`⏳ Next reset ${relativeTag(resetAt)}`];
  if (!rows.length) lines.push('No public milestones were returned.');
  else if (rows.length < 3) lines.push('Few public milestones are available right now.');
  const packed = packSections({
    title: '🗓️ Weekly Reset',
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    sections: SECTIONS.map((section) => ({ name: section.name, lines: buckets[section.key] }))
  });
  return { ...packed, resetAt };
}

module.exports = {
  milestoneRows,
  renderWeeklyReset,
  milestoneTime,
  sectionFor,
  describeMilestone,
  activityHashesFor
};
