'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ensureNpcToolCollections,
  normalizeNpc,
  saveNpc,
  duplicateNpc,
  setNpcStatus,
  saveRelationship,
  removeRelationship,
  playerSafeNpc,
  generateNpcDraft,
  insertNpcIntoEncounter,
  syncNpcCombatant,
  parseNpcImportBuffer,
  exportNpcDocument
} = require('../shared/dnd-npc-tool.cjs');
const {
  validateNpcDraft,
  validateRelationshipDraft,
  parseNamedBonuses,
  parseActions
} = require('../renderer/dnd-npc-tool.js');

test('NPC collections are additive and legacy basic NPC records normalize safely', () => {
  const state = { campaigns: [{ id: 'c1' }], npcs: [{ id: 'legacy', campaignId: 'c1', type: 'npc', name: 'Old Guard', publicSummary: 'A guard.', gmNotes: 'Secret.', revealed: true }] };
  ensureNpcToolCollections(state);
  assert.equal(state.campaigns[0].id, 'c1');
  assert.deepEqual(state.npcRelationships, []);
  const upgraded = normalizeNpc(state.npcs[0], state.npcs[0]);
  assert.equal(upgraded.id, 'legacy');
  assert.equal(upgraded.name, 'Old Guard');
  assert.equal(upgraded.mode, 'narrative');
  assert.deepEqual(upgraded.aliases, []);
  assert.equal(upgraded.combat.armorClass, 10);
});

test('rich NPC normalization preserves narrative and bounded combat fields', () => {
  const npc = normalizeNpc({
    campaignId: 'c1', name: 'Lady Ash', aliases: ['Ash', 'Ash'], pronouns: 'she/her', ancestry: 'elf',
    occupation: 'spymaster', disposition: 'wary', personalityTraits: ['patient'], motivations: ['protect the city'],
    secrets: 'Works for the crown.', publicSummary: 'A careful diplomat.', gmNotes: 'Knows the traitor.',
    status: 'allied', mode: 'combat', revealed: true, tags: ['politics'],
    combat: {
      level: 8, challengeRating: '5', armorClass: 17, hp: 52, maxHp: 60, speed: '30 ft.',
      abilities: { strength: 10, dexterity: 18, constitution: 14, intelligence: 16, wisdom: 13, charisma: 17 },
      savingThrows: [{ name: 'Dexterity', bonus: 7 }], skills: [{ name: 'Deception', bonus: 6 }],
      attacks: [{ name: 'Rapier', attackBonus: 7, damageExpression: '1d8+4', damageType: 'piercing' }]
    }
  });
  assert.deepEqual(npc.aliases, ['Ash']);
  assert.equal(npc.combat.abilities.dexterity.modifier, 4);
  assert.equal(npc.combat.attacks[0].damageExpression, '1d8+4');
  assert.equal(npc.status, 'allied');
  assert.equal(npc.revealed, true);
});

test('local NPC generation is deterministic for a fixed seed and remains an unsaved review draft', () => {
  const input = { campaignId: 'c1', mode: 'combat', ancestry: 'dwarf', occupation: 'blacksmith', level: 4, seed: 'forge-seed', theme: 'mountain' };
  const first = generateNpcDraft(input);
  const second = generateNpcDraft(input);
  assert.equal(first.name, second.name);
  assert.equal(first.disposition, second.disposition);
  assert.deepEqual(first.combat.abilities, second.combat.abilities);
  assert.deepEqual(first.combat.attacks, second.combat.attacks);
  assert.equal(first.metadata.generation.provider, 'local-deterministic');
  assert.equal(first.metadata.generation.seed, 'forge-seed');
  assert.equal(first.metadata.generation.reviewed, false);
  assert.equal(first.revealed, false);
});

test('player-safe NPC projection excludes secrets, GM notes and hidden relationships', () => {
  const npc = normalizeNpc({ campaignId: 'c1', name: 'Mira', revealed: true, publicSummary: 'A guide.', gmNotes: 'Double agent.', secrets: 'Serves the cult.', mode: 'combat', combat: { armorClass: 14, hp: 20, maxHp: 20, attacks: [{ name: 'Bow' }] } });
  const relationships = [
    { id: 'r1', npcId: npc.id, targetType: 'faction', targetId: 'f1', relationshipType: 'member', publicDescription: 'Guild member', gmNotes: 'Secret rank', strength: 2, revealed: true },
    { id: 'r2', npcId: npc.id, targetType: 'npc', targetId: 'n2', relationshipType: 'enemy', publicDescription: 'Unknown', gmNotes: 'Assassin', strength: -4, revealed: false }
  ];
  const safe = playerSafeNpc(npc, relationships);
  assert.equal(safe.publicSummary, 'A guide.');
  assert.equal(safe.gmNotes, undefined);
  assert.equal(safe.secrets, undefined);
  assert.equal(safe.relationships.length, 1);
  assert.equal(safe.relationships[0].gmNotes, undefined);
  assert.equal(playerSafeNpc({ ...npc, revealed: false }, relationships), null);
});

test('relationships reject self-links and merge equivalent duplicates', () => {
  const state = {};
  const npc = saveNpc(state, { campaignId: 'c1', name: 'A' });
  const target = saveNpc(state, { campaignId: 'c1', name: 'B' });
  const first = saveRelationship(state, { campaignId: 'c1', npcId: npc.id, targetType: 'npc', targetId: target.id, relationshipType: 'rival', publicDescription: 'Old rivals' });
  const second = saveRelationship(state, { campaignId: 'c1', npcId: npc.id, targetType: 'npc', targetId: target.id, relationshipType: 'rival', publicDescription: 'Bitter rivals' });
  assert.equal(state.npcRelationships.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(state.npcRelationships[0].publicDescription, 'Bitter rivals');
  assert.throws(() => saveRelationship(state, { campaignId: 'c1', npcId: npc.id, targetType: 'npc', targetId: npc.id, relationshipType: 'ally' }), (error) => error.code === 'DND_NPC_RELATIONSHIP_SELF');
  assert.equal(removeRelationship(state, first.id).id, first.id);
});

test('duplicate, archive and restore preserve the source NPC without ID reuse', () => {
  const state = {};
  const source = saveNpc(state, { campaignId: 'c1', name: 'Captain Vale', revealed: true });
  const copy = duplicateNpc(state, source.id);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.name, 'Captain Vale Copy');
  assert.equal(copy.revealed, false);
  assert.equal(copy.metadata.duplicatedFrom, source.id);
  assert.equal(setNpcStatus(state, copy.id, 'archived').status, 'archived');
  assert.equal(setNpcStatus(state, copy.id, 'alive').status, 'alive');
});

test('NPC import/export strips source identity and records inert provenance', () => {
  const buffer = Buffer.from(JSON.stringify({ format: 'khaos-nexus-npc-v1', npc: { id: 'do-not-overwrite', campaignId: 'other', name: 'Imported Sage', mode: 'narrative', gmNotes: 'Private', customField: { note: 'inert' } } }));
  const imported = parseNpcImportBuffer(buffer, { campaignId: 'c1', sourceFileName: 'sage.json', importedAt: '2026-08-01T00:00:00Z' });
  assert.equal(imported.campaignId, 'c1');
  assert.notEqual(imported.id, 'do-not-overwrite');
  assert.equal(imported.metadata.import.sourceFileName, 'sage.json');
  assert.match(imported.metadata.import.sourceSha256, /^[a-f0-9]{64}$/);
  const document = exportNpcDocument(imported);
  assert.equal(document.format, 'khaos-nexus-npc-v1');
  assert.equal(document.npc.id, undefined);
  assert.equal(document.npc.gmNotes, 'Private');
  assert.throws(() => parseNpcImportBuffer(Buffer.from('{bad'), { campaignId: 'c1' }), (error) => error.code === 'DND_NPC_IMPORT_JSON');
});

test('encounter insertion retains NPC linkage and explicit sync does not overwrite live HP by default', () => {
  const state = { encounters: [{ id: 'e1', campaignId: 'c1', name: 'Ambush', status: 'active' }], combatants: [] };
  const npc = saveNpc(state, { campaignId: 'c1', name: 'Ogre', mode: 'combat', combat: { armorClass: 12, hp: 30, maxHp: 30, abilities: { dexterity: 8 }, attacks: [{ name: 'Club', damageExpression: '2d8+4' }] } });
  const inserted = insertNpcIntoEncounter(state, { campaignId: 'c1', encounterId: 'e1', npcId: npc.id, initiative: 7 });
  assert.equal(inserted.combatant.npcId, npc.id);
  assert.equal(inserted.combatant.hp, 30);
  assert.equal(inserted.combatant.metadata.npcSnapshot.armorClass, 12);
  state.combatants[0].hp = 11;
  saveNpc(state, { ...npc, combat: { ...npc.combat, hp: 40, maxHp: 40, armorClass: 14 } });
  const safeSync = syncNpcCombatant(state, { npcId: npc.id, combatantId: inserted.combatant.id, syncHp: false });
  assert.equal(safeSync.hp, 11);
  assert.equal(safeSync.maxHp, 30);
  assert.equal(safeSync.metadata.npcSnapshot.armorClass, 14);
  const hpSync = syncNpcCombatant(state, { npcId: npc.id, combatantId: inserted.combatant.id, syncHp: true });
  assert.equal(hpSync.hp, 40);
  assert.equal(hpSync.maxHp, 40);
});

test('narrative-only NPC cannot enter an encounter without combat statistics', () => {
  const state = { encounters: [{ id: 'e1', campaignId: 'c1', status: 'active' }], combatants: [] };
  const npc = saveNpc(state, { campaignId: 'c1', name: 'Storyteller', mode: 'narrative' });
  assert.throws(() => insertNpcIntoEncounter(state, { campaignId: 'c1', encounterId: 'e1', npcId: npc.id }), (error) => error.code === 'DND_NPC_COMBAT_REQUIRED');
});

test('renderer validates structured form lines and relationships', () => {
  assert.deepEqual(parseNamedBonuses('Stealth | 5 | in shadows\nPerception | 3'), [{ name: 'Stealth', bonus: 5, note: 'in shadows' }, { name: 'Perception', bonus: 3, note: '' }]);
  assert.deepEqual(parseActions('Claw | 6 | 1d8+3 | slashing | Melee attack', 'attacks')[0], { name: 'Claw', attackBonus: 6, damageExpression: '1d8+3', damageType: 'slashing', description: 'Melee attack', active: true });
  const draft = validateNpcDraft({ campaignId: 'c1', name: 'Wolf', mode: 'combat', status: 'hostile', maxHp: 11, hp: 11, armorClass: 13, dexterity: 15, attacks: 'Bite | 4 | 2d4+2 | piercing | Bite attack' });
  assert.equal(draft.combat.abilities.dexterity, 15);
  assert.equal(draft.combat.attacks[0].name, 'Bite');
  assert.throws(() => validateNpcDraft({ campaignId: 'c1', name: 'Bad', mode: 'combat', maxHp: 5, hp: 10 }), /HP/);
  const relation = validateRelationshipDraft({ campaignId: 'c1', npcId: 'n1', targetType: 'faction', targetId: 'f1', relationshipType: 'member', strength: 9 });
  assert.equal(relation.strength, 5);
});

test('production wiring includes Owner IPC, protected portraits, generator, imports, relationships and encounter controls', () => {
  const entry = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const extension = fs.readFileSync(require.resolve('../main/dnd-npc-tool-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer/dnd-npc-tool.js'), 'utf8');
  assert.ok(entry.indexOf('dnd-world-content-extension') < entry.indexOf('dnd-npc-tool-extension'));
  assert.ok(entry.indexOf('dnd-npc-tool-extension') < entry.indexOf('dnd-access-policy-extension'));
  for (const channel of ['dnd:npcs-get','dnd:npc-save','dnd:npc-generate','dnd:npc-duplicate','dnd:npc-relationship-save','dnd:npc-portrait-pick','dnd:npc-import-pick','dnd:npc-export','dnd:npc-encounter-add','dnd:npc-combatant-sync']) assert.ok(extension.includes(channel));
  assert.match(extension, /assertOwner/);
  assert.match(extension, /isSymbolicLink/);
  assert.match(extension, /safeInside/);
  assert.match(extension, /nativeImage\.createFromBuffer/);
  assert.match(renderer, /NPC Tool/);
  assert.match(renderer, /Generate NPC Draft/);
  assert.match(renderer, /Add Relationship/);
  assert.match(renderer, /Add to Encounter/);
  assert.match(renderer, /syncHp/);
});
