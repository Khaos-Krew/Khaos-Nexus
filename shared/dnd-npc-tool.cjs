'use strict';

const crypto = require('node:crypto');
const { clean, clone, id, nowIso } = require('./dnd-discord.cjs');
const { saveCombatant } = require('./dnd-owner-workflows.cjs');

const NPC_STATUSES = Object.freeze(['alive', 'missing', 'captured', 'allied', 'hostile', 'deceased', 'archived']);
const NPC_MODES = Object.freeze(['narrative', 'combat']);
const NPC_RELATIONSHIP_TYPES = Object.freeze(['ally', 'enemy', 'family', 'friend', 'rival', 'employer', 'employee', 'member', 'leader', 'contact', 'owes', 'fears', 'serves', 'knows', 'custom']);
const NPC_RELATIONSHIP_TARGETS = Object.freeze(['npc', 'character', 'faction', 'location', 'quest']);
const NPC_IMPORT_MAX_BYTES = 1024 * 1024;
const NPC_IMPORT_MAX_DEPTH = 14;
const NPC_IMPORT_MAX_NODES = 8000;
const ABILITY_NAMES = Object.freeze(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);

function fail(message, code = 'DND_NPC_INVALID', field = '') {
  const error = new Error(message);
  error.code = code;
  if (field) error.field = field;
  return error;
}
function numeric(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function integer(value, fallback = 0) { return Math.trunc(numeric(value, fallback)); }
function uniqueStrings(value, max = 120) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => clean(item, max)).filter(Boolean))];
}
function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {}; }
function listOfObjects(value) { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map(clone) : []; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, numeric(value, minimum))); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function ensureNpcToolCollections(state) {
  if (!Array.isArray(state.npcs)) state.npcs = [];
  if (!Array.isArray(state.npcRelationships)) state.npcRelationships = [];
  if (!Array.isArray(state.npcTemplates)) state.npcTemplates = [];
  return state;
}

function normalizeAbilities(input = {}) {
  const output = {};
  for (const name of ABILITY_NAMES) {
    const aliases = [name, name.slice(0, 3)];
    let raw;
    for (const alias of aliases) if (Object.prototype.hasOwnProperty.call(input, alias)) { raw = input[alias]; break; }
    const score = raw && typeof raw === 'object' ? numeric(raw.score, 10) : numeric(raw, 10);
    const normalizedScore = Math.max(1, Math.min(30, integer(score, 10)));
    output[name] = { score: normalizedScore, modifier: Math.floor((normalizedScore - 10) / 2) };
  }
  return output;
}

function normalizeNamedBonusList(value, label) {
  return listOfObjects(value).slice(0, 100).map((item) => {
    const name = clean(item.name, 120);
    if (!name) throw fail(`${label} name is required.`, 'DND_NPC_LIST_ITEM_INVALID');
    return { name, bonus: integer(item.bonus), note: clean(item.note, 500) };
  });
}

function normalizeNpcAction(item = {}, type = 'action') {
  const name = clean(item.name, 160);
  if (!name) throw fail('NPC action name is required.', 'DND_NPC_ACTION_NAME_REQUIRED');
  return {
    id: clean(item.id, 100) || id('npc_action'),
    type: clean(type, 40),
    name,
    description: clean(item.description, 4000),
    attackBonus: item.attackBonus === '' || item.attackBonus === undefined ? null : integer(item.attackBonus),
    damageExpression: clean(item.damageExpression, 80),
    damageType: clean(item.damageType, 80),
    saveAbility: clean(item.saveAbility, 40),
    saveDc: item.saveDc === '' || item.saveDc === undefined ? null : Math.max(0, integer(item.saveDc)),
    recharge: clean(item.recharge, 80),
    uses: item.uses === '' || item.uses === undefined ? null : Math.max(0, integer(item.uses)),
    active: item.active !== false
  };
}
function normalizeActionList(value, type) { return listOfObjects(value).slice(0, 100).map((item) => normalizeNpcAction(item, type)); }

function normalizeCombat(input = {}, existing = {}) {
  const maxHp = Math.max(0, integer(input.maxHp ?? existing.maxHp, 0));
  const hp = Math.max(0, Math.min(maxHp || Number.MAX_SAFE_INTEGER, integer(input.hp ?? existing.hp, maxHp)));
  return {
    level: Math.max(0, Math.min(30, integer(input.level ?? existing.level, 0))),
    challengeRating: clean(input.challengeRating ?? existing.challengeRating, 30),
    armorClass: Math.max(0, Math.min(99, integer(input.armorClass ?? existing.armorClass, 10))),
    hp,
    maxHp,
    speed: clean(input.speed ?? existing.speed, 200),
    abilities: normalizeAbilities(input.abilities || existing.abilities || {}),
    savingThrows: normalizeNamedBonusList(input.savingThrows ?? existing.savingThrows, 'Saving throw'),
    skills: normalizeNamedBonusList(input.skills ?? existing.skills, 'Skill'),
    senses: uniqueStrings(input.senses ?? existing.senses, 160),
    languages: uniqueStrings(input.languages ?? existing.languages, 120),
    resistances: uniqueStrings(input.resistances ?? existing.resistances, 120),
    immunities: uniqueStrings(input.immunities ?? existing.immunities, 120),
    vulnerabilities: uniqueStrings(input.vulnerabilities ?? existing.vulnerabilities, 120),
    conditions: uniqueStrings(input.conditions ?? existing.conditions, 80),
    attacks: normalizeActionList(input.attacks ?? existing.attacks, 'attack'),
    actions: normalizeActionList(input.actions ?? existing.actions, 'action'),
    bonusActions: normalizeActionList(input.bonusActions ?? existing.bonusActions, 'bonus_action'),
    reactions: normalizeActionList(input.reactions ?? existing.reactions, 'reaction'),
    legendaryActions: normalizeActionList(input.legendaryActions ?? existing.legendaryActions, 'legendary_action'),
    lairActions: normalizeActionList(input.lairActions ?? existing.lairActions, 'lair_action'),
    spellcasting: clean(input.spellcasting ?? existing.spellcasting, 12000),
    initiativeModifier: integer(input.initiativeModifier ?? existing.initiativeModifier, 0),
    sourceId: clean(input.sourceId ?? existing.sourceId, 100)
  };
}

function normalizeNpc(input = {}, existing = {}) {
  const campaignId = clean(input.campaignId || existing.campaignId, 100);
  const name = clean(input.name || existing.name, 180);
  if (!campaignId) throw fail('NPC campaign is required.', 'DND_CAMPAIGN_REQUIRED', 'campaignId');
  if (!name) throw fail('NPC name is required.', 'DND_NPC_NAME_REQUIRED', 'name');
  const mode = NPC_MODES.includes(input.mode) ? input.mode : (NPC_MODES.includes(existing.mode) ? existing.mode : 'narrative');
  const status = NPC_STATUSES.includes(input.status) ? input.status : (NPC_STATUSES.includes(existing.status) ? existing.status : 'alive');
  const portrait = objectOrEmpty(input.portrait || existing.portrait);
  const value = {
    id: clean(input.id || existing.id, 100) || id('npc'),
    campaignId,
    type: 'npc',
    name,
    aliases: uniqueStrings(input.aliases ?? existing.aliases, 120),
    pronouns: clean(input.pronouns ?? existing.pronouns, 80),
    ancestry: clean(input.ancestry ?? existing.ancestry, 120),
    age: clean(input.age ?? existing.age, 80),
    appearance: clean(input.appearance ?? existing.appearance, 4000),
    occupation: clean(input.occupation ?? existing.occupation, 160),
    role: clean(input.role ?? existing.role, 160),
    disposition: clean(input.disposition ?? existing.disposition, 120),
    personalityTraits: uniqueStrings(input.personalityTraits ?? existing.personalityTraits, 400),
    ideals: uniqueStrings(input.ideals ?? existing.ideals, 400),
    bonds: uniqueStrings(input.bonds ?? existing.bonds, 400),
    flaws: uniqueStrings(input.flaws ?? existing.flaws, 400),
    voiceNotes: clean(input.voiceNotes ?? existing.voiceNotes, 3000),
    motivations: uniqueStrings(input.motivations ?? existing.motivations, 500),
    goals: uniqueStrings(input.goals ?? existing.goals, 500),
    secrets: clean(input.secrets ?? existing.secrets, 8000),
    publicSummary: clean(input.publicSummary ?? existing.publicSummary, 5000),
    gmNotes: clean(input.gmNotes ?? existing.gmNotes, 12000),
    attitude: clean(input.attitude ?? existing.attitude, 120),
    factionIds: uniqueStrings(input.factionIds ?? existing.factionIds, 100),
    locationIds: uniqueStrings(input.locationIds ?? existing.locationIds, 100),
    questIds: uniqueStrings(input.questIds ?? existing.questIds, 100),
    encounterIds: uniqueStrings(input.encounterIds ?? existing.encounterIds, 100),
    status,
    mode,
    revealed: Boolean(input.revealed ?? existing.revealed),
    tags: uniqueStrings(input.tags ?? existing.tags, 80),
    portrait: {
      relativePath: clean(portrait.relativePath, 500),
      fileName: clean(portrait.fileName, 180),
      mimeType: clean(portrait.mimeType, 100),
      bytes: Math.max(0, integer(portrait.bytes)),
      sha256: clean(portrait.sha256, 64).toLowerCase(),
      width: Math.max(0, integer(portrait.width)),
      height: Math.max(0, integer(portrait.height))
    },
    combat: normalizeCombat(input.combat || {}, existing.combat || {}),
    metadata: { ...objectOrEmpty(existing.metadata), ...objectOrEmpty(input.metadata) },
    createdAt: existing.createdAt || input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (mode === 'narrative' && !input.combat && !existing.combat) value.combat = normalizeCombat({}, {});
  return value;
}

function saveNpc(state, input = {}) {
  ensureNpcToolCollections(state);
  const existing = input.id ? state.npcs.find((item) => item.id === input.id) || null : null;
  const npc = normalizeNpc(input, existing || {});
  const index = state.npcs.findIndex((item) => item.id === npc.id);
  if (index >= 0) state.npcs[index] = npc; else state.npcs.push(npc);
  return clone(npc);
}
function duplicateNpc(state, npcId, name = '') {
  ensureNpcToolCollections(state);
  const existing = state.npcs.find((item) => item.id === npcId);
  if (!existing) throw fail('NPC was not found.', 'DND_NPC_NOT_FOUND');
  const copy = clone(existing);
  delete copy.id; delete copy.createdAt; delete copy.updatedAt;
  copy.name = clean(name || `${existing.name} Copy`, 180);
  copy.status = existing.status === 'archived' ? 'alive' : existing.status;
  copy.revealed = false;
  copy.metadata = { ...objectOrEmpty(copy.metadata), duplicatedFrom: existing.id };
  return saveNpc(state, copy);
}
function setNpcStatus(state, npcId, status) {
  ensureNpcToolCollections(state);
  if (!NPC_STATUSES.includes(status)) throw fail('NPC status is invalid.', 'DND_NPC_STATUS_INVALID');
  const npc = state.npcs.find((item) => item.id === npcId);
  if (!npc) throw fail('NPC was not found.', 'DND_NPC_NOT_FOUND');
  npc.status = status; npc.updatedAt = nowIso();
  return clone(npc);
}

function normalizeRelationship(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  const npcId = clean(input.npcId, 100);
  const targetType = NPC_RELATIONSHIP_TARGETS.includes(input.targetType) ? input.targetType : 'npc';
  const targetId = clean(input.targetId, 100);
  const relationshipType = NPC_RELATIONSHIP_TYPES.includes(input.relationshipType) ? input.relationshipType : 'custom';
  if (!campaignId || !npcId || !targetId) throw fail('Relationship campaign, NPC, and target are required.', 'DND_NPC_RELATIONSHIP_PARENT_REQUIRED');
  if (targetType === 'npc' && targetId === npcId) throw fail('An NPC cannot have a relationship to itself.', 'DND_NPC_RELATIONSHIP_SELF');
  return {
    id: clean(input.id, 100) || id('npc_relationship'), campaignId, npcId, targetType, targetId,
    relationshipType, customType: clean(input.customType, 120),
    publicDescription: clean(input.publicDescription, 2000), gmNotes: clean(input.gmNotes, 5000),
    strength: Math.max(-5, Math.min(5, integer(input.strength, 0))), revealed: Boolean(input.revealed),
    createdAt: input.createdAt || nowIso(), updatedAt: nowIso()
  };
}
function saveRelationship(state, input = {}) {
  ensureNpcToolCollections(state);
  const existing = input.id ? state.npcRelationships.find((item) => item.id === input.id) || null : null;
  const value = normalizeRelationship({ ...existing, ...input });
  const duplicate = state.npcRelationships.find((item) => item.id !== value.id && item.npcId === value.npcId && item.targetType === value.targetType && item.targetId === value.targetId && item.relationshipType === value.relationshipType && item.customType === value.customType);
  if (duplicate) value.id = duplicate.id, value.createdAt = duplicate.createdAt;
  const index = state.npcRelationships.findIndex((item) => item.id === value.id);
  if (index >= 0) state.npcRelationships[index] = value; else state.npcRelationships.push(value);
  return clone(value);
}
function removeRelationship(state, relationshipId) {
  ensureNpcToolCollections(state);
  const index = state.npcRelationships.findIndex((item) => item.id === relationshipId);
  if (index < 0) throw fail('NPC relationship was not found.', 'DND_NPC_RELATIONSHIP_NOT_FOUND');
  return clone(state.npcRelationships.splice(index, 1)[0]);
}

function playerSafeNpc(npc, relationships = []) {
  if (!npc || !npc.revealed || npc.status === 'archived') return null;
  return {
    id: npc.id, campaignId: npc.campaignId, name: npc.name, aliases: clone(npc.aliases || []), pronouns: npc.pronouns,
    ancestry: npc.ancestry, age: npc.age, appearance: npc.appearance, occupation: npc.occupation, role: npc.role,
    disposition: npc.disposition, personalityTraits: clone(npc.personalityTraits || []), publicSummary: npc.publicSummary,
    attitude: npc.attitude, factionIds: clone(npc.factionIds || []), locationIds: clone(npc.locationIds || []),
    status: npc.status, mode: npc.mode, tags: clone(npc.tags || []), portrait: clone(npc.portrait || {}),
    combat: npc.mode === 'combat' ? {
      armorClass: npc.combat?.armorClass, hp: npc.combat?.hp, maxHp: npc.combat?.maxHp, speed: npc.combat?.speed,
      conditions: clone(npc.combat?.conditions || []), senses: clone(npc.combat?.senses || []), languages: clone(npc.combat?.languages || []),
      actions: clone(npc.combat?.actions || []), attacks: clone(npc.combat?.attacks || [])
    } : null,
    relationships: relationships.filter((item) => item.npcId === npc.id && item.revealed).map((item) => ({ id: item.id, targetType: item.targetType, targetId: item.targetId, relationshipType: item.relationshipType, customType: item.customType, publicDescription: item.publicDescription, strength: item.strength }))
  };
}

function seededRandom(seedValue) {
  let seed = crypto.createHash('sha256').update(String(seedValue || 'khaos-nexus-npc')).digest().readUInt32LE(0) || 1;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function choose(random, list) { return list[Math.floor(random() * list.length) % list.length]; }
const NAME_STARTS = Object.freeze(['Ar', 'Bel', 'Cor', 'Dae', 'Ela', 'Fen', 'Gor', 'Hal', 'Iri', 'Jar', 'Kael', 'Lor', 'Mira', 'Nor', 'Or', 'Pyr', 'Quin', 'Rav', 'Syl', 'Tor', 'Una', 'Val', 'Wren', 'Xan', 'Yor', 'Zel']);
const NAME_ENDS = Object.freeze(['a', 'an', 'ar', 'en', 'eth', 'ia', 'ian', 'is', 'on', 'or', 'ra', 'ren', 'ric', 'ryn', 'us']);
const OCCUPATIONS = Object.freeze(['blacksmith', 'apothecary', 'guard captain', 'merchant', 'scholar', 'innkeeper', 'hunter', 'priest', 'smuggler', 'artisan', 'soldier', 'messenger']);
const TRAITS = Object.freeze(['patient and observant', 'boisterous and loyal', 'coldly practical', 'curious and restless', 'formal and guarded', 'kind but anxious', 'quietly ambitious', 'reckless and charming', 'stern yet fair', 'witty and evasive']);
const MOTIVATIONS = Object.freeze(['protect a loved one', 'repay an old debt', 'gain political influence', 'discover forbidden knowledge', 'restore a ruined home', 'escape a dangerous patron', 'prove their innocence', 'secure a lasting legacy']);
const SECRETS = Object.freeze(['works for a rival faction', 'knows the location of a hidden passage', 'is using a false identity', 'witnessed a recent betrayal', 'possesses a dangerous relic', 'owes allegiance to an ancient power']);
const DISPOSITIONS = Object.freeze(['friendly', 'helpful', 'neutral', 'wary', 'suspicious', 'hostile']);

function generateNpcDraft(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  if (!campaignId) throw fail('NPC campaign is required.', 'DND_CAMPAIGN_REQUIRED');
  const seed = clean(input.seed || crypto.randomUUID(), 160);
  const random = seededRandom(`${seed}:${input.ancestry || ''}:${input.occupation || ''}:${input.mode || ''}`);
  const level = Math.max(0, Math.min(30, integer(input.level, 3)));
  const mode = input.mode === 'combat' ? 'combat' : 'narrative';
  const ancestry = clean(input.ancestry || choose(random, ['human', 'elf', 'dwarf', 'halfling', 'dragonborn', 'tiefling', 'gnome']), 120);
  const occupation = clean(input.occupation || choose(random, OCCUPATIONS), 160);
  const name = clean(input.name || `${choose(random, NAME_STARTS)}${choose(random, NAME_ENDS)}`, 180);
  const disposition = clean(input.disposition || choose(random, DISPOSITIONS), 120);
  const abilityScores = {};
  for (const ability of ABILITY_NAMES) abilityScores[ability] = 8 + Math.floor(random() * 11);
  const maxHp = mode === 'combat' ? Math.max(1, 6 + level * (4 + Math.floor(random() * 5))) : 0;
  const generated = normalizeNpc({
    campaignId, name, mode, ancestry, occupation, role: clean(input.role || occupation, 160), disposition,
    personalityTraits: [choose(random, TRAITS)], motivations: [choose(random, MOTIVATIONS)], goals: [choose(random, MOTIVATIONS)],
    secrets: choose(random, SECRETS), attitude: disposition, status: disposition === 'hostile' ? 'hostile' : 'alive',
    revealed: false, publicSummary: `${name} is a ${ancestry} ${occupation}.`,
    gmNotes: `Generated locally from seed ${seed}. Review every field before saving.`,
    tags: uniqueStrings([input.theme, 'generated'].filter(Boolean)),
    combat: mode === 'combat' ? {
      level, challengeRating: clean(input.challengeRating || '', 30), armorClass: 10 + Math.floor(random() * 7), hp: maxHp, maxHp,
      speed: '30 ft.', abilities: abilityScores, initiativeModifier: Math.floor((abilityScores.dexterity - 10) / 2),
      attacks: [{ name: 'Basic Attack', description: 'A simple weapon or natural attack. Review before use.', attackBonus: Math.max(2, level + 2), damageExpression: `${Math.max(1, Math.ceil(level / 4))}d6+${Math.max(0, Math.floor((abilityScores.strength - 10) / 2))}`, active: true }]
    } : {}
  });
  generated.metadata = { ...generated.metadata, generation: { provider: 'local-deterministic', seed, generatedAt: nowIso(), reviewed: false } };
  return generated;
}

function insertNpcIntoEncounter(state, input = {}) {
  ensureNpcToolCollections(state);
  const npc = state.npcs.find((item) => item.id === input.npcId && item.campaignId === input.campaignId);
  if (!npc) throw fail('NPC was not found in this campaign.', 'DND_NPC_NOT_FOUND');
  if (npc.mode !== 'combat') throw fail('Narrative-only NPCs need combat statistics before entering an encounter.', 'DND_NPC_COMBAT_REQUIRED');
  const encounter = (state.encounters || []).find((item) => item.id === input.encounterId && item.campaignId === input.campaignId);
  if (!encounter) throw fail('Encounter was not found in this campaign.', 'DND_ENCOUNTER_NOT_FOUND');
  const combat = npc.combat || {};
  const result = saveCombatant(state, {
    id: clean(input.combatantId, 100), encounterId: encounter.id, campaignId: npc.campaignId, npcId: npc.id,
    nameSnapshot: npc.name, initiative: integer(input.initiative, combat.initiativeModifier), dexterity: combat.abilities?.dexterity?.modifier || 0,
    hp: combat.hp, maxHp: combat.maxHp, conditions: combat.conditions || [], hidden: Boolean(input.hidden), active: true,
    metadata: { npcSnapshot: { sourceUpdatedAt: npc.updatedAt, armorClass: combat.armorClass, attacks: clone(combat.attacks || []), actions: clone(combat.actions || []) } }
  });
  if (!npc.encounterIds.includes(encounter.id)) npc.encounterIds.push(encounter.id);
  npc.updatedAt = nowIso();
  return { npc: clone(npc), combatant: result };
}

function syncNpcCombatant(state, input = {}) {
  ensureNpcToolCollections(state);
  const npc = state.npcs.find((item) => item.id === input.npcId);
  const combatant = (state.combatants || []).find((item) => item.id === input.combatantId && item.npcId === input.npcId);
  if (!npc || !combatant) throw fail('Linked NPC combatant was not found.', 'DND_NPC_COMBATANT_NOT_FOUND');
  const combat = npc.combat || {};
  combatant.nameSnapshot = npc.name;
  combatant.dexterity = combat.abilities?.dexterity?.modifier || 0;
  combatant.conditions = clone(combat.conditions || []);
  if (input.syncHp) {
    combatant.hp = combat.hp;
    combatant.maxHp = combat.maxHp;
  }
  combatant.metadata = { ...objectOrEmpty(combatant.metadata), npcSnapshot: { sourceUpdatedAt: npc.updatedAt, armorClass: combat.armorClass, attacks: clone(combat.attacks || []), actions: clone(combat.actions || []) } };
  combatant.updatedAt = nowIso();
  return clone(combatant);
}

function inspectShape(value, depth = 0, counter = { nodes: 0 }) {
  counter.nodes += 1;
  if (counter.nodes > NPC_IMPORT_MAX_NODES) throw fail('NPC import contains too many values.', 'DND_NPC_IMPORT_COMPLEX');
  if (depth > NPC_IMPORT_MAX_DEPTH) throw fail('NPC import is nested too deeply.', 'DND_NPC_IMPORT_COMPLEX');
  if (value && typeof value === 'object') for (const child of Array.isArray(value) ? value : Object.values(value)) inspectShape(child, depth + 1, counter);
  return counter.nodes;
}
function parseNpcImportBuffer(buffer, context = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > NPC_IMPORT_MAX_BYTES) throw fail('NPC import file is invalid or too large.', 'DND_NPC_IMPORT_SIZE');
  let parsed;
  try { parsed = JSON.parse(buffer.toString('utf8')); } catch { throw fail('NPC import must contain valid JSON.', 'DND_NPC_IMPORT_JSON'); }
  inspectShape(parsed);
  const raw = parsed?.format === 'khaos-nexus-npc-v1' ? parsed.npc : (parsed?.npc || parsed);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('NPC import must contain one NPC object.', 'DND_NPC_IMPORT_INVALID');
  const value = normalizeNpc({ ...raw, id: '', campaignId: context.campaignId || raw.campaignId });
  value.metadata = { ...value.metadata, import: { format: clean(parsed?.format || 'generic-json-v1', 80), sourceFileName: clean(context.sourceFileName, 180), sourceSha256: sha256(buffer), importedAt: clean(context.importedAt || nowIso(), 80) } };
  return value;
}
function exportNpcDocument(npc) {
  const copy = clone(npc);
  delete copy.id; delete copy.createdAt; delete copy.updatedAt;
  return { format: 'khaos-nexus-npc-v1', formatVersion: 1, exportedAt: nowIso(), npc: copy };
}

module.exports = {
  NPC_STATUSES, NPC_MODES, NPC_RELATIONSHIP_TYPES, NPC_RELATIONSHIP_TARGETS,
  NPC_IMPORT_MAX_BYTES, ABILITY_NAMES,
  ensureNpcToolCollections, normalizeAbilities, normalizeNpcAction, normalizeCombat, normalizeNpc,
  saveNpc, duplicateNpc, setNpcStatus, normalizeRelationship, saveRelationship, removeRelationship,
  playerSafeNpc, seededRandom, generateNpcDraft, insertNpcIntoEncounter, syncNpcCombatant,
  parseNpcImportBuffer, exportNpcDocument, uniqueStrings, sha256
};
