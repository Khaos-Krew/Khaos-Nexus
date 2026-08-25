'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { JsonStore, clone } = require('../core/json-store.cjs');
const { CORE_SOURCE_ID, DndContentRegistry } = require('./dnd-content-registry.cjs');

const COLLECTION_ACTIONS = new Set(['quests', 'npcs', 'locations', 'factions', 'loot']);

function clean(value, max = 1000) { return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function id(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
function nowIso(now) { return new Date(typeof now === 'function' ? now() : new Date()).toISOString(); }

class DndDomainService {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.randomInt = options.randomInt || crypto.randomInt;
    this.content = options.content || new DndContentRegistry();
    this.store = options.store || new JsonStore(options.filePath || path.join(process.env.NEXUS_DATA_DIR || 'data', 'dnd-domain.json'), {
      schemaVersion: 1, campaigns: {}, characters: {}, sessions: {}, encounters: {}, rolls: {}, collections: { quests: {}, npcs: {}, locations: {}, factions: {}, loot: {} }, audit: []
    });
  }

  state() { return this.store.read(); }
  actor(context = {}) { const value = String(context.actorId || '').trim(); if (!value) throw new Error('D&D actions require a linked actor identity.'); return value; }
  campaign(campaignId) { const item = this.state().campaigns?.[String(campaignId || '')]; if (!item) throw new Error('Campaign does not exist.'); return item; }
  membership(campaign, actorId) { return campaign.members?.[String(actorId || '')] || null; }
  requireMember(campaign, actorId) { const member = this.membership(campaign, actorId); if (!member) throw new Error('Campaign membership is required.'); return member; }
  requireDm(campaign, actorId) { const member = this.requireMember(campaign, actorId); if (!['owner', 'dm'].includes(member.role)) throw new Error('Campaign DM authority is required.'); return member; }

  audit(state, action, actorId, targetId, campaignId = '') {
    state.audit ||= [];
    state.audit.push({ action, actorId: String(actorId), targetId: String(targetId), campaignId: String(campaignId), at: nowIso(this.now) });
    if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
  }

  campaigns(payload, context) {
    const actorId = this.actor(context);
    const op = clean(payload.op || 'list', 30);
    if (op === 'list') return Object.values(this.state().campaigns || {}).filter((item) => this.membership(item, actorId)).map(clone);
    if (op === 'get') { const campaign = this.campaign(payload.campaignId); this.requireMember(campaign, actorId); return clone(campaign); }
    if (op === 'create') {
      const name = clean(payload.name, 120); if (!name) throw new Error('Campaign name is required.');
      return this.store.update((state) => {
        const campaignId = id('CAMPAIGN'); const at = nowIso(this.now);
        state.campaigns[campaignId] = { id: campaignId, name, description: clean(payload.description, 1200), ownerId: actorId, members: { [actorId]: { userId: actorId, role: 'owner', joinedAt: at } }, enabledSourceIds: [CORE_SOURCE_ID], safety: { lines: [], veils: [], pauseWord: '' }, createdAt: at, updatedAt: at };
        this.audit(state, 'campaign-created', actorId, campaignId, campaignId); return clone(state.campaigns[campaignId]);
      });
    }
    if (op === 'add-member') {
      const campaign = this.campaign(payload.campaignId); this.requireDm(campaign, actorId);
      const userId = String(payload.userId || '').trim(); if (!userId) throw new Error('Member identity is required.');
      const role = ['dm', 'player', 'spectator'].includes(payload.role) ? payload.role : 'player';
      return this.store.update((state) => { const item = state.campaigns[campaign.id]; item.members[userId] = { userId, role, joinedAt: nowIso(this.now) }; item.updatedAt = nowIso(this.now); this.audit(state, 'member-added', actorId, userId, item.id); return clone(item); });
    }
    throw new Error(`Unsupported campaign operation: ${op}`);
  }

  characters(payload, context) {
    const actorId = this.actor(context); const campaign = this.campaign(payload.campaignId); const member = this.requireMember(campaign, actorId); const op = clean(payload.op || 'list', 30);
    if (op === 'list') return Object.values(this.state().characters || {}).filter((item) => item.campaignId === campaign.id && (['owner', 'dm'].includes(member.role) || item.ownerId === actorId)).map(clone);
    if (op === 'create') {
      if (!['owner', 'dm', 'player'].includes(member.role)) throw new Error('Player campaign access is required.');
      const name = clean(payload.name, 120); if (!name) throw new Error('Character name is required.');
      const sourceIds = new Set(campaign.enabledSourceIds || []);
      for (const contentId of [payload.speciesId, payload.classId, payload.backgroundId].filter(Boolean)) { const entry = this.content.get(contentId); if (!entry || !sourceIds.has(entry.sourceId)) throw new Error(`Character content is unavailable: ${contentId}`); }
      return this.store.update((state) => { const characterId = id('CHAR'); const at = nowIso(this.now); state.characters[characterId] = { id: characterId, campaignId: campaign.id, ownerId: actorId, name, level: 1, speciesId: clean(payload.speciesId, 120), classId: clean(payload.classId, 120), backgroundId: clean(payload.backgroundId, 120), inventory: [], notes: '', createdAt: at, updatedAt: at }; this.audit(state, 'character-created', actorId, characterId, campaign.id); return clone(state.characters[characterId]); });
    }
    throw new Error(`Unsupported character operation: ${op}`);
  }

  sessions(payload, context) {
    const actorId = this.actor(context); const campaign = this.campaign(payload.campaignId); const op = clean(payload.op || 'list', 30); this.requireMember(campaign, actorId);
    if (op === 'list') return Object.values(this.state().sessions || {}).filter((item) => item.campaignId === campaign.id).map(clone);
    if (op === 'create') { this.requireDm(campaign, actorId); return this.store.update((state) => { const sessionId = id('SESSION'); const at = nowIso(this.now); state.sessions[sessionId] = { id: sessionId, campaignId: campaign.id, title: clean(payload.title, 160) || 'Campaign Session', scheduledAt: payload.scheduledAt ? new Date(payload.scheduledAt).toISOString() : '', status: 'planned', recap: '', createdAt: at, updatedAt: at }; this.audit(state, 'session-created', actorId, sessionId, campaign.id); return clone(state.sessions[sessionId]); }); }
    throw new Error(`Unsupported session operation: ${op}`);
  }

  dice(payload, context) {
    const actorId = this.actor(context); const campaign = this.campaign(payload.campaignId); this.requireMember(campaign, actorId);
    const count = Math.max(1, Math.min(20, Math.trunc(Number(payload.count || 1)))); const sides = Math.max(2, Math.min(1000, Math.trunc(Number(payload.sides || 20)))); const modifier = Math.max(-1000, Math.min(1000, Math.trunc(Number(payload.modifier || 0))));
    const values = Array.from({ length: count }, () => this.randomInt(1, sides + 1)); const total = values.reduce((sum, value) => sum + value, 0) + modifier; const visibility = ['public', 'dm', 'private'].includes(payload.visibility) ? payload.visibility : 'public';
    return this.store.update((state) => { const rollId = id('ROLL'); const roll = { id: rollId, campaignId: campaign.id, actorId, expression: `${count}d${sides}${modifier ? modifier > 0 ? `+${modifier}` : modifier : ''}`, values, modifier, total, visibility, reason: clean(payload.reason, 240), createdAt: nowIso(this.now) }; state.rolls[rollId] = roll; this.audit(state, 'roll-recorded', actorId, rollId, campaign.id); return clone(roll); });
  }

  encounters(payload, context) {
    const actorId = this.actor(context); const campaign = this.campaign(payload.campaignId); this.requireDm(campaign, actorId); const op = clean(payload.op || 'list', 30);
    if (op === 'list') return Object.values(this.state().encounters || {}).filter((item) => item.campaignId === campaign.id).map(clone);
    if (op === 'create') return this.store.update((state) => { const encounterId = id('ENCOUNTER'); const at = nowIso(this.now); state.encounters[encounterId] = { id: encounterId, campaignId: campaign.id, name: clean(payload.name, 160) || 'Encounter', status: 'prepared', combatants: [], initiativeIndex: -1, round: 0, createdAt: at, updatedAt: at }; this.audit(state, 'encounter-created', actorId, encounterId, campaign.id); return clone(state.encounters[encounterId]); });
    throw new Error(`Unsupported encounter operation: ${op}`);
  }

  initiative(payload, context) {
    const actorId = this.actor(context); const encounter = this.state().encounters?.[String(payload.encounterId || '')]; if (!encounter) throw new Error('Encounter does not exist.'); const campaign = this.campaign(encounter.campaignId); this.requireMember(campaign, actorId);
    return clone({ encounterId: encounter.id, status: encounter.status, round: encounter.round, initiativeIndex: encounter.initiativeIndex, combatants: encounter.combatants });
  }

  collection(actionId, payload, context) {
    const actorId = this.actor(context); const campaign = this.campaign(payload.campaignId); const member = this.requireMember(campaign, actorId); const op = clean(payload.op || 'list', 30); const collection = this.state().collections?.[actionId] || {};
    if (op === 'list') return Object.values(collection).filter((item) => item.campaignId === campaign.id && (!item.dmOnly || ['owner', 'dm'].includes(member.role))).map(clone);
    this.requireDm(campaign, actorId);
    if (op === 'create') return this.store.update((state) => { const itemId = id(actionId.toUpperCase()); const at = nowIso(this.now); state.collections[actionId][itemId] = { id: itemId, campaignId: campaign.id, name: clean(payload.name, 160), notes: clean(payload.notes, 4000), dmOnly: payload.dmOnly === true, createdAt: at, updatedAt: at }; this.audit(state, `${actionId}-created`, actorId, itemId, campaign.id); return clone(state.collections[actionId][itemId]); });
    throw new Error(`Unsupported ${actionId} operation: ${op}`);
  }

  async invoke(moduleId, actionId, payload = {}, context = {}) {
    if (moduleId !== 'dnd') throw new Error('D&D service only accepts the dnd module.');
    if (actionId === 'campaigns') return this.campaigns(payload, context);
    if (actionId === 'characters') return this.characters(payload, context);
    if (actionId === 'sessions') return this.sessions(payload, context);
    if (actionId === 'dice') return this.dice(payload, context);
    if (actionId === 'encounters') return this.encounters(payload, context);
    if (actionId === 'initiative') return this.initiative(payload, context);
    if (actionId === 'sources') return this.content.manifest();
    if (actionId === 'codex') return this.content.list(payload);
    if (COLLECTION_ACTIONS.has(actionId)) return this.collection(actionId, payload, context);
    if (actionId === 'homebrew') return this.content.list({ sourceIds: ['khaos-shattered-realms@1'], type: payload.type });
    throw new Error(`Unsupported D&D action: ${actionId}`);
  }
}

module.exports = { COLLECTION_ACTIONS, DndDomainService, clean, nowIso };
