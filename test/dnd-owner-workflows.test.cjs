'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSource,
  normalizeQuest,
  activateQuest,
  saveEncounter,
  saveCombatant,
  removeCombatant,
  advanceEncounter,
  initiativeSnapshot
} = require('../shared/dnd-owner-workflows.cjs');
const {
  validateSourceDraft,
  validateQuestDraft,
  validateEncounterDraft,
  validateCombatantDraft,
  sortCombatants
} = require('../renderer/dnd-owner-workflows.js');
const {
  linkedMembers,
  attendanceFor
} = require('../renderer/dnd-owner-attendance-stability.js');
const { applySafeSourceDefault } = require('../renderer/dnd-owner-license-default.js');

test('new and edited source metadata enforces licensing before full text can be enabled', () => {
  const metadata = normalizeSource({ name: 'External Reference' });
  assert.equal(metadata.licenseType, 'metadata_only');
  assert.equal(metadata.isFullTextAllowed, false);
  assert.throws(() => normalizeSource({ name: 'Restricted', licenseType: 'external_link', isFullTextAllowed: true }), (error) => error.code === 'DND_SOURCE_LICENSE_RESTRICTED');
  const srd = validateSourceDraft({ name: 'SRD 5.2', licenseType: 'srd_cc_by', isFullTextAllowed: true });
  assert.equal(srd.isFullTextAllowed, true);
});

test('quest form and storage normalize public and GM fields without placeholder data', () => {
  const draft = validateQuestDraft({ campaignId: 'campaign', title: 'Find the Gate', summary: 'Public', gmNotes: 'Secret', status: 'active', visibleToPlayers: true });
  const quest = normalizeQuest(draft);
  assert.equal(quest.title, 'Find the Gate');
  assert.equal(quest.gmNotes, 'Secret');
  assert.equal(quest.visibleToPlayers, true);
});

test('active campaign quest selection synchronizes lifecycle and rejects terminal quests', () => {
  const state = {
    campaigns: [{ id: 'campaign', activeQuestId: 'old' }],
    quests: [
      { id: 'old', campaignId: 'campaign', status: 'active' },
      { id: 'next', campaignId: 'campaign', status: 'available' },
      { id: 'done', campaignId: 'campaign', status: 'completed' }
    ]
  };
  const result = activateQuest(state, 'campaign', 'next');
  assert.equal(result.campaign.activeQuestId, 'next');
  assert.equal(state.quests.find((item) => item.id === 'old').status, 'available');
  assert.equal(state.quests.find((item) => item.id === 'next').status, 'active');
  assert.throws(() => activateQuest(state, 'campaign', 'done'), (error) => error.code === 'DND_QUEST_TERMINAL');
  activateQuest(state, 'campaign', '');
  assert.equal(state.campaigns[0].activeQuestId, '');
  assert.equal(state.quests.find((item) => item.id === 'next').status, 'available');
});

test('activating an encounter pauses the previously active encounter in the same campaign', () => {
  const state = { encounters: [
    { id: 'old', campaignId: 'campaign', name: 'Old', status: 'active', round: 3, currentTurnIndex: 1 }
  ] };
  const next = saveEncounter(state, { id: 'new', campaignId: 'campaign', name: 'New', status: 'active' });
  assert.equal(next.status, 'active');
  assert.equal(state.encounters.find((item) => item.id === 'old').status, 'paused');
});

test('combatant saves deduplicate a campaign character within one encounter', () => {
  const state = { combatants: [] };
  const first = saveCombatant(state, { encounterId: 'encounter', campaignId: 'campaign', characterId: 'character', nameSnapshot: 'Aria', initiative: 12 });
  const second = saveCombatant(state, { encounterId: 'encounter', campaignId: 'campaign', characterId: 'character', nameSnapshot: 'Aria', initiative: 18 });
  assert.equal(state.combatants.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(state.combatants[0].initiative, 18);
});

test('initiative remains deterministic and advances the round only after the final combatant', () => {
  const state = {
    encounters: [{ id: 'encounter', campaignId: 'campaign', name: 'Fight', status: 'active', round: 1, currentTurnIndex: 0 }],
    combatants: [
      { id: 'b', encounterId: 'encounter', campaignId: 'campaign', nameSnapshot: 'B', initiative: 15, dexterity: 12, active: true },
      { id: 'a', encounterId: 'encounter', campaignId: 'campaign', nameSnapshot: 'A', initiative: 15, dexterity: 14, active: true }
    ]
  };
  const before = initiativeSnapshot(state, 'encounter');
  assert.deepEqual(before.order.map((item) => item.id), ['a', 'b']);
  let next = advanceEncounter(state, 'encounter');
  assert.equal(next.currentCombatant.id, 'b');
  assert.equal(next.encounter.round, 1);
  next = advanceEncounter(state, 'encounter');
  assert.equal(next.currentCombatant.id, 'a');
  assert.equal(next.encounter.round, 2);
});

test('removing a combatant preserves history while excluding it from active order', () => {
  const state = { combatants: [{ id: 'one', encounterId: 'e', campaignId: 'c', nameSnapshot: 'One', active: true }] };
  const removed = removeCombatant(state, 'one');
  assert.equal(removed.active, false);
  assert.ok(removed.removedAt);
  assert.equal(state.combatants.length, 1);
});

test('renderer encounter and combatant validation matches persisted lifecycle constraints', () => {
  const encounter = validateEncounterDraft({ campaignId: 'campaign', name: 'Ambush', status: 'ready', round: 1 });
  assert.equal(encounter.status, 'ready');
  const combatant = validateCombatantDraft({ campaignId: 'campaign', encounterId: 'encounter', initiative: 11, dexterity: 13, hp: 8, maxHp: 10 }, { id: 'character', name: 'Vex' });
  assert.equal(combatant.characterId, 'character');
  assert.equal(combatant.nameSnapshot, 'Vex');
  assert.deepEqual(sortCombatants([{ id: 'b', initiative: 10, dexterity: 10 }, { id: 'a', initiative: 10, dexterity: 10 }]).map((item) => item.id), ['a', 'b']);
});

test('attendance editor includes only linked identities and resolves existing records by stable identity', () => {
  const members = [
    { id: 'one', userId: 'user-1', displayName: 'One', active: true },
    { id: 'two', discordUserId: '123456789012345678', displayName: 'Two', active: true },
    { id: 'three', displayName: 'Unlinked', active: true }
  ];
  assert.deepEqual(linkedMembers(members).map((item) => item.id), ['one', 'two']);
  const record = attendanceFor([{ sessionId: 's', discordUserId: '123456789012345678', status: 'late' }], 's', members[1]);
  assert.equal(record.status, 'late');
});

test('new source modal is forced to metadata-only with full text disabled', () => {
  const form = {
    elements: {
      id: { value: '' },
      licenseType: { value: 'srd_cc_by' },
      isFullTextAllowed: { checked: true }
    }
  };
  const modal = { querySelector: (selector) => selector === '#dndOwnerSourceForm' ? form : null };
  assert.equal(applySafeSourceDefault(modal), true);
  assert.equal(form.elements.licenseType.value, 'metadata_only');
  assert.equal(form.elements.isFullTextAllowed.checked, false);
});

test('production startup loads usability repair before core workflows and licensing guard', () => {
  const entry = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const repair = entry.indexOf("require('./dnd-usability-repair-extension.cjs').install()");
  const workflows = entry.indexOf("require('./dnd-owner-workflows-extension.cjs').install()");
  const licensing = entry.indexOf("require('./dnd-owner-license-default-extension.cjs').install()");
  assert.ok(repair >= 0 && repair < workflows && workflows < licensing);
});

test('core workflow extension centrally enforces active quest and attendance consistency with audited Owner handlers', () => {
  const source = fs.readFileSync(require.resolve('../main/dnd-owner-workflows-extension.cjs'), 'utf8');
  assert.match(source, /upsertDndCampaign\(input\)/);
  assert.match(source, /activateQuest\(state, value\.id, value\.activeQuestId\)/);
  assert.match(source, /upsertDndAttendance\(input\)/);
  assert.match(source, /item\.sessionId === input\.sessionId/);
  for (const channel of ['dnd:source-save', 'dnd:quest-save', 'dnd:encounter-save', 'dnd:combatant-save', 'dnd:combatant-remove', 'dnd:encounter-advance']) assert.match(source, new RegExp(channel));
  assert.match(source, /appendDndAudit/);
});
