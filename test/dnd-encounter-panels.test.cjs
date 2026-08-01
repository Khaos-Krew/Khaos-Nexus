'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ensureEncounterPanelCollections,
  normalizeEncounterPanel,
  normalizeTurnAction,
  savePanel,
  saveTurnAction,
  removeTurnAction,
  healthPercent,
  healthBar,
  bossHealthText,
  currentEncounterState,
  actionsForTurn,
  buttonId,
  parseButtonId,
  panelPayload,
  validateButtonExecution
} = require('../shared/dnd-encounter-panels.cjs');
const {
  validatePanelDraft,
  validateActionDraft,
  validateCombatantPatch,
  healthBar: rendererHealthBar
} = require('../renderer/dnd-encounter-panels.js');
const {
  isEncounterRollButton,
  isEncounterMoreButton,
  moreButtonId,
  parseMoreButtonId,
  validateMoreExecution,
  actionRows,
  EncounterPanelController
} = require('../bot/dnd-encounter-panel-policy.cjs');

function baseState() {
  return {
    campaigns: [{ id: 'c1', name: 'Heroes' }],
    members: [
      { id: 'm1', campaignId: 'c1', discordUserId: '11111', role: 'player', active: true },
      { id: 'm2', campaignId: 'c1', discordUserId: '99999', role: 'dm', active: true }
    ],
    bindings: [
      { id: 'b1', campaignId: 'c1', appId: 'app1', guildId: 'g1', resourceId: 'ch1', purpose: 'main', active: true },
      { id: 'b2', campaignId: 'c1', appId: 'app1', guildId: 'g1', resourceId: 'dm1', purpose: 'dm_private', active: true }
    ],
    grants: [{ id: 'gr1', campaignId: 'c1', appId: 'app1', guildId: 'g1', scopes: ['campaign:read', 'encounters:manage', 'rolls:create'], active: true }],
    encounters: [{ id: 'e1', campaignId: 'c1', name: 'Dragon Fight', status: 'active', round: 2, currentTurnIndex: 0 }],
    characters: [
      { id: 'char1', campaignId: 'c1', name: 'Aria', hp: 22, maxHp: 30, armorClass: 17, conditions: [], exhaustion: 1, inspiration: true },
      { id: 'char2', campaignId: 'c1', name: 'Brom', hp: 18, maxHp: 40, armorClass: 19, conditions: ['poisoned'], exhaustion: 0, inspiration: false }
    ],
    combatants: [
      { id: 'pc1', encounterId: 'e1', campaignId: 'c1', characterId: 'char1', discordUserId: '11111', nameSnapshot: 'Aria', initiative: 20, dexterity: 4, hp: 22, maxHp: 30, conditions: [], active: true, hidden: false },
      { id: 'boss1', encounterId: 'e1', campaignId: 'c1', npcId: 'npc1', nameSnapshot: 'Ancient Dragon', initiative: 18, dexterity: 2, hp: 120, maxHp: 200, conditions: ['slowed'], active: true, hidden: false },
      { id: 'pc2', encounterId: 'e1', campaignId: 'c1', characterId: 'char2', discordUserId: '22222', nameSnapshot: 'Brom', initiative: 12, dexterity: 1, hp: 18, maxHp: 40, conditions: ['poisoned'], active: true, hidden: false },
      { id: 'secret', encounterId: 'e1', campaignId: 'c1', nameSnapshot: 'Hidden Assassin', initiative: 25, dexterity: 5, hp: 10, maxHp: 10, conditions: [], active: true, hidden: true }
    ],
    encounterPanels: [],
    encounterTurnActions: [],
    rolls: []
  };
}

function configuredState(actionCount = 2) {
  const state = baseState();
  const panel = savePanel(state, {
    campaignId: 'c1', encounterId: 'e1', bindingId: 'b1', appId: 'app1', guildId: 'g1', featuredCombatantId: 'boss1',
    healthMode: 'percentage', partyFields: ['hp', 'armor_class', 'conditions', 'exhaustion', 'inspiration', 'initiative'],
    maxVisibleParty: 8, mentionCurrentTurn: true, autoRefresh: true, status: 'active'
  });
  for (let index = 0; index < actionCount; index += 1) {
    saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', label: `Action ${index + 1}`, expression: index % 2 ? '2d6+3' : 'd20+5', rollType: index % 2 ? 'damage' : 'attack', privacy: 'public', sortOrder: index });
  }
  return { state, panel: state.encounterPanels.find((item) => item.id === panel.id) };
}

test('encounter panel collections are additive and one record is reused per encounter binding', () => {
  const state = { encounters: [{ id: 'e1' }], custom: ['preserved'] };
  ensureEncounterPanelCollections(state);
  assert.deepEqual(state.custom, ['preserved']);
  const first = savePanel(state, { campaignId: 'c1', encounterId: 'e1', bindingId: 'b1', status: 'active' });
  const second = savePanel(state, { campaignId: 'c1', encounterId: 'e1', bindingId: 'b1', status: 'active', healthMode: 'exact' });
  assert.equal(state.encounterPanels.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(state.encounterPanels[0].healthMode, 'exact');
});

test('panel and action validation enforces bindings, strict dice grammar and bounded settings', () => {
  const panel = normalizeEncounterPanel({ campaignId: 'c1', encounterId: 'e1', bindingId: 'b1', status: 'active', healthMode: 'bloodied', maxVisibleParty: 99, partyFields: ['hp', 'bad'] });
  assert.equal(panel.maxVisibleParty, 12);
  assert.deepEqual(panel.partyFields, ['hp']);
  assert.match(panel.panelToken, /^ep_/);
  assert.throws(() => normalizeEncounterPanel({ campaignId: 'c1', encounterId: 'e1', status: 'active' }), (error) => error.code === 'DND_ENCOUNTER_PANEL_BINDING_REQUIRED');
  const action = normalizeTurnAction({ campaignId: 'c1', encounterId: 'e1', label: 'Strike', expression: '1d20 + 5', rollType: 'attack', privacy: 'public' });
  assert.equal(action.expression, '1d20+5');
  assert.match(action.actionToken, /^ea_/);
  assert.throws(() => normalizeTurnAction({ campaignId: 'c1', encounterId: 'e1', label: 'Bad', expression: 'process.exit()' }), /Unsupported|Invalid|Dice/i);
});

test('saving or removing actions advances panel action revision and enforces active limit', () => {
  const { state, panel } = configuredState(0);
  const revision = panel.actionRevision;
  const action = saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', label: 'Attack', expression: 'd20+4' });
  assert.equal(state.encounterPanels[0].actionRevision, revision + 1);
  removeTurnAction(state, action.id);
  assert.equal(state.encounterPanels[0].actionRevision, revision + 2);
  for (let index = 0; index < 25; index += 1) saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', label: `A${index}`, expression: 'd20', sortOrder: index });
  assert.throws(() => saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', label: 'Overflow', expression: 'd20' }), (error) => error.code === 'DND_TURN_ACTION_LIMIT');
});

test('health bars clamp at boundaries and support exact, percentage, bloodied and hidden modes', () => {
  assert.equal(healthPercent(120, 200), 60);
  assert.equal(healthPercent(-5, 100), 0);
  assert.equal(healthPercent(500, 100), 100);
  assert.equal(healthBar(50, 100, 10), '█████░░░░░ 50%');
  assert.match(bossHealthText({ hp: 25, maxHp: 100 }, 'exact'), /25\/100 HP/);
  assert.equal(bossHealthText({ hp: 50, maxHp: 100 }, 'bloodied'), 'Bloodied');
  assert.equal(bossHealthText({ hp: 51, maxHp: 100 }, 'bloodied'), 'Standing strong');
  assert.equal(bossHealthText({ hp: 50, maxHp: 100 }, 'hidden'), 'Health hidden by the DM');
  assert.equal(rendererHealthBar(50, 100), '█████░░░░░ 50%');
});

test('panel payload filters hidden combatants and GM data while showing boss, party and current turn', () => {
  const { state, panel } = configuredState(2);
  const rendered = panelPayload(state, panel);
  const text = JSON.stringify(rendered.body);
  assert.match(text, /Ancient Dragon/);
  assert.match(text, /60%/);
  assert.match(text, /Aria/);
  assert.match(text, /Brom/);
  assert.match(text, /<@11111>/);
  assert.doesNotMatch(text, /Hidden Assassin/);
  assert.equal(rendered.current.id, 'pc1');
  assert.equal(rendered.actions.length, 2);
  assert.equal(rendered.body.components[0].components.length, 2);
});

test('panel hash is stable across timestamps and changes when HP, turn or actions change', () => {
  const { state, panel } = configuredState(1);
  const first = panelPayload(state, panel).hash;
  panel.lastRefreshedAt = '2099-01-01T00:00:00Z'; panel.updatedAt = '2099-01-01T00:00:00Z';
  assert.equal(panelPayload(state, panel).hash, first);
  state.combatants.find((item) => item.id === 'boss1').hp -= 1;
  const hpChanged = panelPayload(state, panel).hash;
  assert.notEqual(hpChanged, first);
  state.encounters[0].currentTurnIndex = 1;
  assert.notEqual(panelPayload(state, panel).hash, hpChanged);
});

test('button IDs contain opaque tokens rather than dice expressions and parse round-trip', () => {
  const { state, panel } = configuredState(1);
  const snapshot = currentEncounterState(state, 'e1');
  const action = state.encounterTurnActions[0];
  const customId = buttonId(panel, action, snapshot.encounter, snapshot.currentIndex);
  assert.ok(customId.length <= 100);
  assert.doesNotMatch(customId, /d20|2d6/);
  assert.deepEqual(parseButtonId(customId), {
    panelToken: panel.panelToken,
    actionToken: action.actionToken,
    actionRevision: panel.actionRevision,
    round: 2,
    currentIndex: 0,
    reserved: 'v1'
  });
});

test('turn buttons authorize only current linked player or campaign managers', () => {
  const { state, panel } = configuredState(1);
  const snapshot = currentEncounterState(state, 'e1');
  const customId = buttonId(panel, state.encounterTurnActions[0], snapshot.encounter, snapshot.currentIndex);
  assert.equal(validateButtonExecution(state, { customId, discordUserId: '11111' }).current.id, 'pc1');
  assert.equal(validateButtonExecution(state, { customId, discordUserId: '99999' }).manager, true);
  assert.throws(() => validateButtonExecution(state, { customId, discordUserId: '33333' }), (error) => error.code === 'DND_ENCOUNTER_BUTTON_FORBIDDEN');
});

test('stale turn, round and action revisions are rejected', () => {
  const { state, panel } = configuredState(1);
  const snapshot = currentEncounterState(state, 'e1');
  const customId = buttonId(panel, state.encounterTurnActions[0], snapshot.encounter, snapshot.currentIndex);
  state.encounters[0].round = 3;
  assert.throws(() => validateButtonExecution(state, { customId, discordUserId: '11111' }), (error) => error.code === 'DND_ENCOUNTER_BUTTON_STALE');
  state.encounters[0].round = 2; state.encounterPanels[0].actionRevision += 1;
  assert.throws(() => validateButtonExecution(state, { customId, discordUserId: '11111' }), (error) => error.code === 'DND_ENCOUNTER_BUTTON_STALE');
});

test('action targeting honors combatant, character and default current-turn actions', () => {
  const { state, panel } = configuredState(0);
  saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', label: 'Default', expression: 'd20' });
  saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', characterId: 'char1', label: 'Aria Skill', expression: 'd20+5' });
  saveTurnAction(state, { campaignId: 'c1', encounterId: 'e1', combatantId: 'pc2', label: 'Brom Skill', expression: 'd20+2' });
  const current = currentEncounterState(state, 'e1').currentCombatant;
  assert.deepEqual(actionsForTurn(state, panel, current).map((item) => item.label), ['Aria Skill', 'Default']);
});

test('More Actions uses a stale-checked ephemeral overflow path after 19 main buttons', () => {
  const { state, panel } = configuredState(25);
  const snapshot = currentEncounterState(state, 'e1');
  const customId = moreButtonId(panel, snapshot.encounter, snapshot.currentIndex);
  assert.equal(parseMoreButtonId(customId).actionRevision, panel.actionRevision);
  const interaction = { customId, user: { id: '11111' }, guildId: 'g1', channelId: 'ch1' };
  const runtime = { getBootstrap: () => ({ config: { discordApp: { id: 'app1' }, dnd: state } }) };
  const result = validateMoreExecution(state, interaction, runtime);
  assert.equal(result.actions.length, 6);
  const rows = actionRows(result.actions, panel, snapshot.encounter, snapshot.currentIndex);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].components.length, 5);
  assert.equal(rows[1].components.length, 1);
  state.encounters[0].currentTurnIndex = 1;
  assert.throws(() => validateMoreExecution(state, interaction, runtime), (error) => error.code === 'DND_ENCOUNTER_BUTTON_STALE');
});

test('bot button classifiers isolate encounter roll and overflow controls', () => {
  assert.equal(isEncounterRollButton({ isButton: () => true, customId: 'dnd:er:a:b:1:1:0:v1' }), true);
  assert.equal(isEncounterMoreButton({ isButton: () => true, customId: 'dnd:em:a:1:1:0:v1' }), true);
  assert.equal(isEncounterRollButton({ isButton: () => true, customId: 'dnd:roll:c1' }), false);
});

test('controller creates one message, edits the same message, and records stale failures without duplicate churn', async () => {
  const { state, panel } = configuredState(1);
  let sent = 0; let edited = 0; let fetched = null;
  const message = { id: 'msg1', edit: async () => { edited += 1; } };
  const channel = {
    isTextBased: () => true,
    messages: { fetch: async (id) => { fetched = id; if (id === 'missing') throw new Error('missing'); return message; } },
    send: async () => { sent += 1; return message; }
  };
  const mutations = [];
  const runtime = {
    client: { isReady: () => true, channels: { fetch: async () => channel } },
    getBootstrap: () => ({ config: { discordApp: { id: 'app1' }, dnd: state } }),
    send: (type, payload) => mutations.push({ type, payload }),
    log: () => {}
  };
  const controller = new EncounterPanelController(runtime);
  await controller.refreshOne(panel, state);
  assert.equal(sent, 1);
  assert.equal(mutations.at(-1).payload.operation, 'encounter-panel.upsert');
  panel.messageId = 'msg1'; panel.contentHash = panelPayload(state, panel).hash;
  await controller.refreshOne(panel, state);
  assert.equal(fetched, 'msg1');
  assert.equal(sent, 1);
  assert.equal(edited, 0);
  state.combatants.find((item) => item.id === 'boss1').hp = 100;
  await controller.refreshOne(panel, state);
  assert.equal(edited, 1);
});

test('renderer validation covers panel, action and explicit combatant state changes', () => {
  const panel = validatePanelDraft({ campaignId: 'c1', encounterId: 'e1', bindingId: 'b1', healthMode: 'exact', partyFields: ['hp', 'conditions'], maxVisibleParty: 20, autoRefresh: true });
  assert.equal(panel.maxVisibleParty, 12);
  const action = validateActionDraft({ campaignId: 'c1', encounterId: 'e1', label: 'Attack', expression: 'd20+5', rollType: 'attack', privacy: 'public' });
  assert.equal(action.label, 'Attack');
  assert.throws(() => validateActionDraft({ campaignId: 'c1', encounterId: 'e1', label: 'Bad', expression: 'hello' }), /dice expression/);
  assert.deepEqual(validateCombatantPatch({ encounterId: 'e1', combatantId: 'pc1', hp: 10, maxHp: 20, conditions: 'poisoned, poisoned' }).conditions, ['poisoned']);
  assert.throws(() => validateCombatantPatch({ encounterId: 'e1', combatantId: 'pc1', hp: 30, maxHp: 20 }), /HP/);
});

test('production wiring preserves one bot authority, Owner controls, privacy and no automatic damage', () => {
  const mainEntry = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const botEntry = fs.readFileSync(require.resolve('../bot/entry.cjs'), 'utf8');
  const extension = fs.readFileSync(require.resolve('../main/dnd-encounter-panels-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer/dnd-encounter-panels.js'), 'utf8');
  const botPolicy = fs.readFileSync(require.resolve('../bot/dnd-encounter-panel-policy.cjs'), 'utf8');
  assert.ok(mainEntry.indexOf('dnd-world-content-extension') < mainEntry.indexOf('dnd-encounter-panels-extension'));
  assert.ok(mainEntry.indexOf('dnd-encounter-panels-extension') < mainEntry.indexOf('dnd-access-policy-extension'));
  assert.match(botEntry, /dnd-encounter-panel-policy/);
  assert.match(botEntry, /encounterPanelController\?\.onConfigUpdate/);
  for (const channel of ['dnd:encounter-panels-get','dnd:encounter-panel-save','dnd:encounter-panel-request','dnd:encounter-action-save','dnd:encounter-combatant-patch','dnd:encounter-panel-advance']) assert.ok(extension.includes(channel));
  assert.match(extension, /assertOwner/);
  assert.match(renderer, /Encounter Panel/);
  assert.match(renderer, /Add Roll/);
  assert.match(renderer, /Next Turn/);
  assert.match(renderer, /automatic/i);
  assert.match(botPolicy, /More Actions/);
  assert.match(botPolicy, /MISSING_DM_ROLL_DESTINATION/);
  assert.match(botPolicy, /automaticStateMutation: false/);
  assert.doesNotMatch(botPolicy, /combatant\.hp\s*[-+]=|applyDamage|autoApply/);
});
