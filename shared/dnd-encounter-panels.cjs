'use strict';

const crypto = require('node:crypto');
const {
  clean,
  clone,
  id,
  nowIso,
  parseDiceExpression,
  stableHash,
  sortInitiative
} = require('./dnd-discord.cjs');

const HEALTH_MODES = Object.freeze(['exact', 'percentage', 'bloodied', 'hidden']);
const ROLL_TYPES = Object.freeze(['attack', 'damage', 'saving_throw', 'ability_check', 'skill_check', 'healing', 'custom']);
const ROLL_PRIVACY = Object.freeze(['public', 'dm_only', 'blind']);
const PANEL_STATUSES = Object.freeze(['draft', 'active', 'paused', 'completed', 'stale']);
const MANAGER_ROLES = new Set(['admin', 'dm', 'assistant_dm']);
const MAX_ACTIONS = 25;
const MAX_VISIBLE_PARTY = 12;

function fail(message, code = 'DND_ENCOUNTER_PANEL_INVALID', field = '') {
  const error = new Error(message);
  error.code = code;
  if (field) error.field = field;
  return error;
}
function numeric(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function integer(value, fallback = 0) { return Math.trunc(numeric(value, fallback)); }
function uniqueStrings(value, allowed = null) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const result = [...new Set(source.map((item) => clean(item, 80)).filter(Boolean))];
  return allowed ? result.filter((item) => allowed.includes(item)) : result;
}
function token(prefix, input = '') {
  return `${prefix}_${crypto.createHash('sha256').update(String(input || crypto.randomUUID())).digest('base64url').slice(0, 12)}`;
}
function ensureEncounterPanelCollections(state) {
  if (!Array.isArray(state.encounterPanels)) state.encounterPanels = [];
  if (!Array.isArray(state.encounterTurnActions)) state.encounterTurnActions = [];
  return state;
}

function normalizeEncounterPanel(input = {}, existing = {}) {
  const campaignId = clean(input.campaignId || existing.campaignId, 100);
  const encounterId = clean(input.encounterId || existing.encounterId, 100);
  const bindingId = clean(input.bindingId ?? existing.bindingId, 100);
  if (!campaignId || !encounterId) throw fail('Encounter panel campaign and encounter are required.', 'DND_ENCOUNTER_PANEL_PARENT_REQUIRED');
  const value = {
    id: clean(input.id || existing.id, 100) || id('encounter_panel'),
    panelToken: clean(input.panelToken || existing.panelToken, 24) || token('ep', `${campaignId}:${encounterId}:${bindingId}`),
    campaignId,
    encounterId,
    bindingId,
    appId: clean(input.appId ?? existing.appId, 100),
    guildId: clean(input.guildId ?? existing.guildId, 30),
    messageId: clean(input.messageId ?? existing.messageId, 30),
    contentHash: clean(input.contentHash ?? existing.contentHash, 128),
    featuredCombatantId: clean(input.featuredCombatantId ?? existing.featuredCombatantId, 100),
    healthMode: HEALTH_MODES.includes(input.healthMode) ? input.healthMode : (HEALTH_MODES.includes(existing.healthMode) ? existing.healthMode : 'percentage'),
    partyFields: uniqueStrings(input.partyFields ?? existing.partyFields ?? ['hp', 'armor_class', 'conditions'], ['hp', 'armor_class', 'conditions', 'exhaustion', 'inspiration', 'initiative']),
    maxVisibleParty: Math.max(1, Math.min(MAX_VISIBLE_PARTY, integer(input.maxVisibleParty ?? existing.maxVisibleParty, 8))),
    mentionCurrentTurn: Boolean(input.mentionCurrentTurn ?? existing.mentionCurrentTurn),
    autoRefresh: input.autoRefresh !== false && existing.autoRefresh !== false,
    status: PANEL_STATUSES.includes(input.status) ? input.status : (PANEL_STATUSES.includes(existing.status) ? existing.status : 'draft'),
    actionRevision: Math.max(1, integer(input.actionRevision ?? existing.actionRevision, 1)),
    lastRefreshedAt: clean(input.lastRefreshedAt ?? existing.lastRefreshedAt, 80),
    lastError: clean(input.lastError ?? existing.lastError, 1000),
    staleReason: clean(input.staleReason ?? existing.staleReason, 500),
    requestedAt: clean(input.requestedAt ?? existing.requestedAt, 80),
    createdAt: existing.createdAt || input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (value.status === 'active' && !bindingId) throw fail('An active encounter panel requires a Discord binding.', 'DND_ENCOUNTER_PANEL_BINDING_REQUIRED', 'bindingId');
  return value;
}

function normalizeTurnAction(input = {}, existing = {}) {
  const campaignId = clean(input.campaignId || existing.campaignId, 100);
  const encounterId = clean(input.encounterId || existing.encounterId, 100);
  const label = clean(input.label || existing.label, 80);
  const expression = clean(input.expression || existing.expression, 80);
  if (!campaignId || !encounterId) throw fail('Turn action campaign and encounter are required.', 'DND_TURN_ACTION_PARENT_REQUIRED');
  if (!label) throw fail('Turn action button label is required.', 'DND_TURN_ACTION_LABEL_REQUIRED', 'label');
  if (!expression) throw fail('Turn action dice expression is required.', 'DND_TURN_ACTION_EXPRESSION_REQUIRED', 'expression');
  const parsed = parseDiceExpression(expression);
  const privacy = ROLL_PRIVACY.includes(input.privacy) ? input.privacy : (ROLL_PRIVACY.includes(existing.privacy) ? existing.privacy : 'public');
  return {
    id: clean(input.id || existing.id, 100) || id('turn_action'),
    actionToken: clean(input.actionToken || existing.actionToken, 24) || token('ea', `${campaignId}:${encounterId}:${label}:${parsed.normalized}`),
    campaignId,
    encounterId,
    characterId: clean(input.characterId ?? existing.characterId, 100),
    combatantId: clean(input.combatantId ?? existing.combatantId, 100),
    label,
    expression: parsed.normalized,
    rollType: ROLL_TYPES.includes(input.rollType) ? input.rollType : (ROLL_TYPES.includes(existing.rollType) ? existing.rollType : 'custom'),
    privacy,
    prompt: clean(input.prompt ?? existing.prompt, 500),
    sortOrder: integer(input.sortOrder ?? existing.sortOrder, 0),
    active: input.active !== false,
    revision: Math.max(1, integer(input.revision ?? existing.revision, 1)),
    createdAt: existing.createdAt || input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function savePanel(state, input = {}) {
  ensureEncounterPanelCollections(state);
  const existing = input.id ? state.encounterPanels.find((item) => item.id === input.id) || null :
    state.encounterPanels.find((item) => item.encounterId === input.encounterId && item.bindingId === input.bindingId) || null;
  const panel = normalizeEncounterPanel(input, existing || {});
  const duplicate = state.encounterPanels.find((item) => item.id !== panel.id && item.encounterId === panel.encounterId && item.bindingId === panel.bindingId && ['active', 'paused', 'draft', 'stale'].includes(item.status));
  if (duplicate) panel.id = duplicate.id, panel.panelToken = duplicate.panelToken, panel.createdAt = duplicate.createdAt;
  const index = state.encounterPanels.findIndex((item) => item.id === panel.id);
  if (index >= 0) state.encounterPanels[index] = panel; else state.encounterPanels.push(panel);
  return clone(panel);
}
function saveTurnAction(state, input = {}) {
  ensureEncounterPanelCollections(state);
  const existing = input.id ? state.encounterTurnActions.find((item) => item.id === input.id) || null : null;
  const action = normalizeTurnAction(input, existing || {});
  const count = state.encounterTurnActions.filter((item) => item.encounterId === action.encounterId && item.id !== action.id && item.active !== false).length;
  if (action.active && count >= MAX_ACTIONS) throw fail(`An encounter can have at most ${MAX_ACTIONS} active turn actions.`, 'DND_TURN_ACTION_LIMIT');
  const index = state.encounterTurnActions.findIndex((item) => item.id === action.id);
  if (index >= 0) state.encounterTurnActions[index] = action; else state.encounterTurnActions.push(action);
  for (const panel of state.encounterPanels.filter((item) => item.encounterId === action.encounterId)) {
    panel.actionRevision = Math.max(1, integer(panel.actionRevision, 1)) + 1;
    panel.requestedAt = nowIso();
    panel.updatedAt = nowIso();
  }
  return clone(action);
}
function removeTurnAction(state, actionId) {
  ensureEncounterPanelCollections(state);
  const action = state.encounterTurnActions.find((item) => item.id === actionId);
  if (!action) throw fail('Turn action was not found.', 'DND_TURN_ACTION_NOT_FOUND');
  action.active = false;
  action.revision = Math.max(1, integer(action.revision, 1)) + 1;
  action.updatedAt = nowIso();
  for (const panel of state.encounterPanels.filter((item) => item.encounterId === action.encounterId)) {
    panel.actionRevision = Math.max(1, integer(panel.actionRevision, 1)) + 1;
    panel.requestedAt = nowIso();
    panel.updatedAt = nowIso();
  }
  return clone(action);
}

function healthPercent(hp, maxHp) {
  const maximum = numeric(maxHp, 0);
  if (!(maximum > 0)) return null;
  return Math.max(0, Math.min(100, Math.round(numeric(hp, 0) / maximum * 100)));
}
function healthBar(hp, maxHp, segments = 12) {
  const percentage = healthPercent(hp, maxHp);
  if (percentage === null) return 'Unknown';
  const filled = Math.max(0, Math.min(segments, Math.round(percentage / 100 * segments)));
  return `${'█'.repeat(filled)}${'░'.repeat(segments - filled)} ${percentage}%`;
}
function bossHealthText(combatant, mode) {
  if (!combatant || mode === 'hidden') return 'Health hidden by the DM';
  const percentage = healthPercent(combatant.hp, combatant.maxHp);
  if (mode === 'bloodied') {
    if (percentage === null) return 'Condition unknown';
    if (percentage <= 0) return 'Defeated';
    if (percentage <= 50) return 'Bloodied';
    return 'Standing strong';
  }
  if (mode === 'exact') return combatant.hp === null || combatant.hp === undefined ? 'HP unknown' : `${combatant.hp}/${combatant.maxHp ?? '?'} HP · ${healthBar(combatant.hp, combatant.maxHp)}`;
  return healthBar(combatant.hp, combatant.maxHp);
}

function managerFor(state, campaignId, discordUserId) {
  const member = (state.members || []).find((item) => item.campaignId === campaignId && item.discordUserId === discordUserId && item.active !== false);
  return Boolean(member && MANAGER_ROLES.has(member.role));
}
function currentEncounterState(state, encounterId) {
  const encounter = (state.encounters || []).find((item) => item.id === encounterId) || null;
  const order = sortInitiative((state.combatants || []).filter((item) => item.encounterId === encounterId && item.active !== false));
  const index = order.length ? Math.min(Math.max(0, integer(encounter?.currentTurnIndex, 0)), order.length - 1) : 0;
  return { encounter, order, currentCombatant: order[index] || null, currentIndex: index };
}
function actionsForTurn(state, panel, currentCombatant) {
  ensureEncounterPanelCollections(state);
  if (!currentCombatant) return [];
  return state.encounterTurnActions
    .filter((item) => item.active !== false && item.encounterId === panel.encounterId)
    .filter((item) => item.combatantId ? item.combatantId === currentCombatant.id : item.characterId ? item.characterId === currentCombatant.characterId : true)
    .sort((a, b) => integer(a.sortOrder) - integer(b.sortOrder) || a.label.localeCompare(b.label));
}
function compactButtonId(panel, action, encounter, currentIndex) {
  return `dnd:er:${panel.panelToken}:${action.actionToken}:${panel.actionRevision}:${encounter.round || 1}:${currentIndex}`;
}
function parseButtonId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 8 || parts[0] !== 'dnd' || parts[1] !== 'er') return null;
  return {
    panelToken: clean(parts[2], 24),
    actionToken: clean(parts[3], 24),
    actionRevision: integer(parts[4]),
    round: integer(parts[5]),
    currentIndex: integer(parts[6]),
    reserved: clean(parts[7], 20)
  };
}
function buttonId(panel, action, encounter, currentIndex) {
  return `${compactButtonId(panel, action, encounter, currentIndex)}:v1`;
}

function partyRows(state, panel, encounterState) {
  const characters = state.characters || [];
  return encounterState.order
    .filter((item) => !item.hidden && item.characterId)
    .slice(0, panel.maxVisibleParty)
    .map((combatant) => {
      const character = characters.find((item) => item.id === combatant.characterId) || {};
      const details = [];
      if (panel.partyFields.includes('hp')) details.push(`HP ${combatant.hp ?? character.hp ?? '—'}/${combatant.maxHp ?? character.maxHp ?? '—'}`);
      if (panel.partyFields.includes('armor_class')) details.push(`AC ${character.armorClass ?? combatant.metadata?.npcSnapshot?.armorClass ?? '—'}`);
      if (panel.partyFields.includes('conditions')) details.push((combatant.conditions || character.conditions || []).length ? `Conditions ${(combatant.conditions || character.conditions).join(', ')}` : 'No conditions');
      if (panel.partyFields.includes('exhaustion')) details.push(`Exhaustion ${character.exhaustion ?? 0}`);
      if (panel.partyFields.includes('inspiration')) details.push(`Inspiration ${character.inspiration ? 'Yes' : 'No'}`);
      if (panel.partyFields.includes('initiative')) details.push(`Initiative ${combatant.initiative ?? 0}`);
      return `**${combatant.nameSnapshot || character.name || 'Character'}** — ${details.join(' · ')}`;
    });
}

function panelPayload(state, panel) {
  ensureEncounterPanelCollections(state);
  const snapshot = currentEncounterState(state, panel.encounterId);
  const encounter = snapshot.encounter;
  if (!encounter) throw fail('Encounter for this panel was not found.', 'DND_ENCOUNTER_NOT_FOUND');
  const boss = snapshot.order.find((item) => item.id === panel.featuredCombatantId && !item.hidden) || null;
  const current = snapshot.currentCombatant && !snapshot.currentCombatant.hidden ? snapshot.currentCombatant : null;
  const actions = current?.discordUserId ? actionsForTurn(state, panel, current) : [];
  const party = partyRows(state, panel, snapshot);
  const orderLines = snapshot.order.filter((item) => !item.hidden).slice(0, 16).map((item, index) => `${index === snapshot.currentIndex ? '▶' : '•'} ${item.nameSnapshot || item.name || 'Combatant'} — ${item.initiative ?? 0}`);
  const fields = [];
  if (boss) fields.push({ name: `Boss · ${boss.nameSnapshot || boss.name || 'Featured combatant'}`, value: `${bossHealthText(boss, panel.healthMode)}${(boss.conditions || []).length ? `\nConditions: ${boss.conditions.join(', ')}` : ''}`.slice(0, 1024), inline: false });
  fields.push({ name: 'Current Turn', value: current ? `${panel.mentionCurrentTurn && current.discordUserId ? `<@${current.discordUserId}> · ` : ''}**${current.nameSnapshot || current.name}**` : 'No visible active combatant', inline: false });
  fields.push({ name: 'Initiative', value: (orderLines.join('\n') || 'No visible combatants.').slice(0, 1024), inline: false });
  fields.push({ name: 'Party', value: (party.join('\n') || 'No linked party combatants.').slice(0, 1024), inline: false });
  const components = [];
  for (let offset = 0; offset < Math.min(actions.length, 20); offset += 5) {
    components.push({
      type: 1,
      components: actions.slice(offset, offset + 5).map((action) => ({
        type: 2,
        style: action.rollType === 'damage' ? 4 : action.rollType === 'healing' ? 3 : 1,
        label: action.label.slice(0, 80),
        custom_id: buttonId(panel, action, encounter, snapshot.currentIndex)
      }))
    });
  }
  const body = {
    content: panel.mentionCurrentTurn && current?.discordUserId ? `<@${current.discordUserId}>` : undefined,
    embeds: [{
      title: encounter.name,
      description: `Round **${encounter.round || 1}** · Encounter **${encounter.status}**`,
      fields,
      footer: { text: 'Khaos Nexus D&D · Live encounter panel' }
    }],
    components
  };
  const hash = stableHash({
    encounter: { id: encounter.id, name: encounter.name, status: encounter.status, round: encounter.round, currentTurnIndex: encounter.currentTurnIndex },
    boss: boss ? { id: boss.id, name: boss.nameSnapshot, hp: boss.hp, maxHp: boss.maxHp, conditions: boss.conditions } : null,
    current: current ? { id: current.id, discordUserId: current.discordUserId, name: current.nameSnapshot } : null,
    order: snapshot.order.filter((item) => !item.hidden).map((item) => ({ id: item.id, name: item.nameSnapshot, initiative: item.initiative, hp: item.hp, maxHp: item.maxHp, conditions: item.conditions })),
    party,
    settings: { healthMode: panel.healthMode, partyFields: panel.partyFields, maxVisibleParty: panel.maxVisibleParty, mentionCurrentTurn: panel.mentionCurrentTurn, actionRevision: panel.actionRevision },
    actions: actions.slice(0, 20).map((item) => ({ id: item.id, token: item.actionToken, label: item.label, type: item.rollType, revision: item.revision }))
  });
  return { body, hash, snapshot, actions, boss, current };
}

function validateButtonExecution(state, input = {}) {
  ensureEncounterPanelCollections(state);
  const parsed = parseButtonId(input.customId);
  if (!parsed) throw fail('Encounter action button is invalid.', 'DND_ENCOUNTER_BUTTON_INVALID');
  const panel = state.encounterPanels.find((item) => item.panelToken === parsed.panelToken && item.status === 'active');
  if (!panel) throw fail('Encounter action panel is no longer active.', 'DND_ENCOUNTER_BUTTON_STALE');
  const action = state.encounterTurnActions.find((item) => item.actionToken === parsed.actionToken && item.encounterId === panel.encounterId && item.active !== false);
  if (!action) throw fail('Encounter action is no longer active.', 'DND_ENCOUNTER_BUTTON_STALE');
  const snapshot = currentEncounterState(state, panel.encounterId);
  if (!snapshot.encounter || snapshot.encounter.status !== 'active') throw fail('Encounter is no longer active.', 'DND_ENCOUNTER_BUTTON_STALE');
  if (parsed.actionRevision !== panel.actionRevision || parsed.round !== integer(snapshot.encounter.round, 1) || parsed.currentIndex !== snapshot.currentIndex) throw fail('This action button belongs to a previous turn or action revision.', 'DND_ENCOUNTER_BUTTON_STALE');
  const current = snapshot.currentCombatant;
  if (!current) throw fail('No active combatant exists for this action.', 'DND_ENCOUNTER_BUTTON_STALE');
  if (action.combatantId && action.combatantId !== current.id || action.characterId && action.characterId !== current.characterId) throw fail('This action is not configured for the current combatant.', 'DND_ENCOUNTER_BUTTON_FORBIDDEN');
  const actorId = clean(input.discordUserId, 30);
  const manager = managerFor(state, panel.campaignId, actorId);
  if (!manager && (!current.discordUserId || current.discordUserId !== actorId)) throw fail('Only the current character or a campaign DM may use this action.', 'DND_ENCOUNTER_BUTTON_FORBIDDEN');
  return { parsed, panel, action, snapshot, current, manager };
}

module.exports = {
  HEALTH_MODES,
  ROLL_TYPES,
  ROLL_PRIVACY,
  PANEL_STATUSES,
  MANAGER_ROLES,
  MAX_ACTIONS,
  MAX_VISIBLE_PARTY,
  ensureEncounterPanelCollections,
  normalizeEncounterPanel,
  normalizeTurnAction,
  savePanel,
  saveTurnAction,
  removeTurnAction,
  healthPercent,
  healthBar,
  bossHealthText,
  managerFor,
  currentEncounterState,
  actionsForTurn,
  compactButtonId,
  buttonId,
  parseButtonId,
  partyRows,
  panelPayload,
  validateButtonExecution
};
