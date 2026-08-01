'use strict';

const {
  clean,
  clone,
  id,
  nowIso,
  normalizeSnowflake,
  sortInitiative,
  advanceInitiative
} = require('./dnd-discord.cjs');

const SOURCE_LICENSES = Object.freeze([
  'srd_cc_by', 'user_authored', 'user_supplied_private', 'metadata_only',
  'external_link', 'partner_api', 'unknown_restricted'
]);
const FULL_TEXT_LICENSES = new Set(['srd_cc_by', 'user_authored', 'user_supplied_private', 'partner_api']);
const QUEST_STATUSES = Object.freeze(['draft', 'available', 'active', 'completed', 'failed', 'abandoned', 'archived']);
const ENCOUNTER_STATUSES = Object.freeze(['draft', 'ready', 'active', 'paused', 'completed', 'archived']);

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function uniqueStrings(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => clean(item, 80)).filter(Boolean))];
}

function normalizeSource(input = {}) {
  const licenseType = SOURCE_LICENSES.includes(input.licenseType) ? input.licenseType : 'metadata_only';
  const isFullTextAllowed = Boolean(input.isFullTextAllowed);
  if (isFullTextAllowed && !FULL_TEXT_LICENSES.has(licenseType)) {
    const error = new Error('Full text is not permitted for this source license type. Use metadata or an external link instead.');
    error.code = 'DND_SOURCE_LICENSE_RESTRICTED';
    throw error;
  }
  const name = clean(input.name, 160);
  if (!name) throw Object.assign(new Error('Source name is required.'), { code: 'DND_SOURCE_NAME_REQUIRED' });
  return {
    id: clean(input.id, 100) || id('source'),
    name,
    ruleset: clean(input.ruleset || '5e_2024', 80),
    sourceVersion: clean(input.sourceVersion, 80),
    licenseType,
    licenseReference: clean(input.licenseReference, 500),
    attributionText: clean(input.attributionText, 1000),
    externalReferenceUrl: clean(input.externalReferenceUrl, 800),
    isFullTextAllowed,
    active: input.active !== false,
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeQuest(input = {}) {
  const title = clean(input.title || input.name, 180);
  if (!clean(input.campaignId, 100)) throw Object.assign(new Error('Quest campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!title) throw Object.assign(new Error('Quest title is required.'), { code: 'DND_QUEST_TITLE_REQUIRED' });
  return {
    id: clean(input.id, 100) || id('quest'),
    campaignId: clean(input.campaignId, 100),
    title,
    summary: clean(input.summary, 4000),
    gmNotes: clean(input.gmNotes, 8000),
    status: QUEST_STATUSES.includes(input.status) ? input.status : 'draft',
    visibleToPlayers: Boolean(input.visibleToPlayers),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeEncounter(input = {}) {
  const name = clean(input.name, 180);
  if (!clean(input.campaignId, 100)) throw Object.assign(new Error('Encounter campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!name) throw Object.assign(new Error('Encounter name is required.'), { code: 'DND_ENCOUNTER_NAME_REQUIRED' });
  return {
    id: clean(input.id, 100) || id('encounter'),
    campaignId: clean(input.campaignId, 100),
    sessionId: clean(input.sessionId, 100),
    name,
    status: ENCOUNTER_STATUSES.includes(input.status) ? input.status : 'draft',
    round: Math.max(1, finiteInteger(input.round, 1)),
    currentTurnIndex: Math.max(0, finiteInteger(input.currentTurnIndex, 0)),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeCombatant(input = {}) {
  const nameSnapshot = clean(input.nameSnapshot || input.name, 160);
  if (!clean(input.encounterId, 100)) throw Object.assign(new Error('Combatant encounter is required.'), { code: 'DND_ENCOUNTER_REQUIRED' });
  if (!clean(input.campaignId, 100)) throw Object.assign(new Error('Combatant campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!nameSnapshot) throw Object.assign(new Error('Combatant name is required.'), { code: 'DND_COMBATANT_NAME_REQUIRED' });
  const discordUserId = clean(input.discordUserId, 25);
  if (discordUserId) normalizeSnowflake(discordUserId, 'Discord user ID');
  const hp = input.hp === '' || input.hp === null || input.hp === undefined ? null : finiteInteger(input.hp);
  const maxHp = input.maxHp === '' || input.maxHp === null || input.maxHp === undefined ? null : finiteInteger(input.maxHp);
  if (hp !== null && hp < 0 || maxHp !== null && maxHp < 0) throw Object.assign(new Error('Combatant HP cannot be negative.'), { code: 'DND_COMBATANT_HP_INVALID' });
  if (hp !== null && maxHp !== null && hp > maxHp) throw Object.assign(new Error('Combatant HP cannot exceed maximum HP.'), { code: 'DND_COMBATANT_HP_INVALID' });
  return {
    id: clean(input.id, 100) || id('combatant'),
    encounterId: clean(input.encounterId, 100),
    campaignId: clean(input.campaignId, 100),
    characterId: clean(input.characterId, 100),
    npcId: clean(input.npcId, 100),
    discordUserId,
    nameSnapshot,
    initiative: finiteInteger(input.initiative),
    dexterity: finiteInteger(input.dexterity),
    hp,
    maxHp,
    conditions: uniqueStrings(input.conditions),
    hidden: Boolean(input.hidden),
    active: input.active !== false,
    joinedAt: input.joinedAt || nowIso(),
    removedAt: input.active === false ? (input.removedAt || nowIso()) : '',
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    updatedAt: nowIso()
  };
}

function upsertById(list, value) {
  const index = list.findIndex((item) => item.id === value.id);
  if (index >= 0) list[index] = value;
  else list.push(value);
  return value;
}

function saveEncounter(state, input) {
  const value = normalizeEncounter(input);
  if (value.status === 'active') {
    for (const encounter of state.encounters.filter((item) => item.campaignId === value.campaignId && item.id !== value.id && item.status === 'active')) {
      encounter.status = 'paused';
      encounter.updatedAt = nowIso();
    }
  }
  upsertById(state.encounters, value);
  return clone(value);
}

function saveCombatant(state, input) {
  const value = normalizeCombatant(input);
  if (!value.id && value.characterId) {
    const existing = state.combatants.find((item) => item.encounterId === value.encounterId && item.characterId === value.characterId && item.active !== false);
    if (existing) value.id = existing.id;
  }
  const duplicate = value.characterId && state.combatants.find((item) => item.id !== value.id && item.encounterId === value.encounterId && item.characterId === value.characterId && item.active !== false);
  if (duplicate) value.id = duplicate.id;
  upsertById(state.combatants, value);
  return clone(value);
}

function removeCombatant(state, combatantId) {
  const combatant = state.combatants.find((item) => item.id === combatantId);
  if (!combatant) throw Object.assign(new Error('Combatant not found.'), { code: 'DND_COMBATANT_NOT_FOUND' });
  combatant.active = false;
  combatant.removedAt = nowIso();
  combatant.updatedAt = nowIso();
  return clone(combatant);
}

function advanceEncounter(state, encounterId) {
  const encounter = state.encounters.find((item) => item.id === encounterId);
  if (!encounter) throw Object.assign(new Error('Encounter not found.'), { code: 'DND_ENCOUNTER_NOT_FOUND' });
  if (encounter.status !== 'active') throw Object.assign(new Error('Only an active encounter can advance initiative.'), { code: 'DND_ENCOUNTER_NOT_ACTIVE' });
  const combatants = state.combatants.filter((item) => item.encounterId === encounter.id && item.active !== false);
  const next = advanceInitiative(encounter, combatants);
  encounter.currentTurnIndex = next.currentTurnIndex;
  encounter.round = next.round;
  encounter.updatedAt = nowIso();
  return { encounter: clone(encounter), order: clone(next.order), currentCombatant: clone(next.currentCombatant) };
}

function initiativeSnapshot(state, encounterId) {
  const encounter = state.encounters.find((item) => item.id === encounterId) || null;
  const order = sortInitiative(state.combatants.filter((item) => item.encounterId === encounterId && item.active !== false));
  const currentIndex = order.length ? Math.min(Math.max(0, Number(encounter?.currentTurnIndex || 0)), order.length - 1) : 0;
  return { encounter: encounter ? clone(encounter) : null, order: clone(order), currentCombatant: order[currentIndex] ? clone(order[currentIndex]) : null };
}

module.exports = {
  SOURCE_LICENSES,
  FULL_TEXT_LICENSES,
  QUEST_STATUSES,
  ENCOUNTER_STATUSES,
  normalizeSource,
  normalizeQuest,
  normalizeEncounter,
  normalizeCombatant,
  saveEncounter,
  saveCombatant,
  removeCombatant,
  advanceEncounter,
  initiativeSnapshot,
  uniqueStrings
};
