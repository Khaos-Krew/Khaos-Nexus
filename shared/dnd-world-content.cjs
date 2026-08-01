'use strict';

const crypto = require('node:crypto');
const {
  clean,
  clone,
  id,
  nowIso,
  parseDiceExpression,
  rollDice
} = require('./dnd-discord.cjs');

const WORLD_TYPES = Object.freeze(['npc', 'location', 'faction']);
const CONTENT_ORIGINS = Object.freeze(['srd', 'user_authored', 'user_supplied_private', 'metadata_only', 'external_link', 'partner_api']);
const FULL_TEXT_ORIGINS = new Set(['srd', 'user_authored', 'user_supplied_private', 'partner_api']);
const HOMEBREW_STATUSES = Object.freeze(['draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'retired']);
const HOMEBREW_TRANSITIONS = Object.freeze({
  draft: ['submitted', 'retired'],
  submitted: ['under_review', 'changes_requested', 'approved', 'rejected'],
  under_review: ['changes_requested', 'approved', 'rejected'],
  changes_requested: ['draft', 'submitted', 'retired'],
  approved: ['retired'],
  rejected: ['draft', 'retired'],
  retired: []
});
const EXTRA_COLLECTIONS = Object.freeze(['npcs', 'locations', 'factions', 'contentEntries', 'homebrew']);

function ensureWorldCollections(state) {
  for (const key of EXTRA_COLLECTIONS) if (!Array.isArray(state[key])) state[key] = [];
  if (!Array.isArray(state.loot)) state.loot = [];
  if (!Array.isArray(state.rolls)) state.rolls = [];
  return state;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeWorldRecord(type, input = {}) {
  if (!WORLD_TYPES.includes(type)) throw Object.assign(new Error('World record type is invalid.'), { code: 'DND_WORLD_TYPE_INVALID' });
  const campaignId = clean(input.campaignId, 100);
  const name = clean(input.name, 180);
  if (!campaignId) throw Object.assign(new Error('World record campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!name) throw Object.assign(new Error('World record name is required.'), { code: 'DND_WORLD_NAME_REQUIRED' });
  return {
    id: clean(input.id, 100) || id(type),
    campaignId,
    type,
    name,
    publicSummary: clean(input.publicSummary, 5000),
    gmNotes: clean(input.gmNotes, 12000),
    revealed: Boolean(input.revealed),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeLoot(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  const name = clean(input.name, 180);
  const quantity = numeric(input.quantity, 1);
  if (!campaignId) throw Object.assign(new Error('Loot campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!name) throw Object.assign(new Error('Loot name is required.'), { code: 'DND_LOOT_NAME_REQUIRED' });
  if (!(quantity > 0)) throw Object.assign(new Error('Loot quantity must be greater than zero.'), { code: 'DND_LOOT_QUANTITY_INVALID' });
  return {
    id: clean(input.id, 100) || id('loot'),
    campaignId,
    name,
    quantity,
    shared: input.shared !== false,
    gmOnly: Boolean(input.gmOnly),
    assignedCharacterId: clean(input.assignedCharacterId, 100),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    active: input.active !== false,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function contentHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeContentEntry(state, input = {}) {
  ensureWorldCollections(state);
  const sourceId = clean(input.sourceId, 100);
  const source = state.sources.find((item) => item.id === sourceId) || null;
  const name = clean(input.name, 180);
  const contentOrigin = CONTENT_ORIGINS.includes(input.contentOrigin) ? input.contentOrigin : 'metadata_only';
  const fullText = String(input.fullText || '').trim().slice(0, 50000);
  if (!name) throw Object.assign(new Error('Content entry name is required.'), { code: 'DND_CONTENT_NAME_REQUIRED' });
  if (fullText && !FULL_TEXT_ORIGINS.has(contentOrigin)) {
    throw Object.assign(new Error('This content origin permits metadata or links only.'), { code: 'DND_CONTENT_FULL_TEXT_RESTRICTED' });
  }
  if (fullText && (!source || !source.isFullTextAllowed)) {
    throw Object.assign(new Error('The selected source does not permit full-text storage.'), { code: 'DND_SOURCE_FULL_TEXT_RESTRICTED' });
  }
  const value = {
    id: clean(input.id, 100) || id('content'),
    campaignId: clean(input.campaignId, 100),
    sourceId,
    contentType: clean(input.contentType || 'reference', 80),
    name,
    summary: clean(input.summary, 8000),
    fullText,
    contentOrigin,
    externalReferenceUrl: clean(input.externalReferenceUrl, 800),
    active: input.active !== false,
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  value.contentHash = contentHash({
    sourceId: value.sourceId,
    contentType: value.contentType,
    name: value.name,
    summary: value.summary,
    fullText: value.fullText,
    contentOrigin: value.contentOrigin,
    externalReferenceUrl: value.externalReferenceUrl
  });
  return value;
}

function normalizeHomebrewBase(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  const name = clean(input.name, 180);
  if (!campaignId) throw Object.assign(new Error('Homebrew campaign is required.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  if (!name) throw Object.assign(new Error('Homebrew name is required.'), { code: 'DND_HOMEBREW_NAME_REQUIRED' });
  return {
    campaignId,
    entryId: clean(input.entryId, 100),
    authorUserId: clean(input.authorUserId, 100),
    contentType: clean(input.contentType || 'other', 80),
    name,
    body: input.body && typeof input.body === 'object' ? clone(input.body) : { description: clean(input.description, 20000) },
    reviewNotes: clean(input.reviewNotes, 8000)
  };
}

function bodyChanged(existing, input) {
  const body = input.body && typeof input.body === 'object' ? input.body : { description: clean(input.description, 20000) };
  return existing.name !== clean(input.name || existing.name, 180) ||
    existing.contentType !== clean(input.contentType || existing.contentType, 80) ||
    JSON.stringify(existing.body || {}) !== JSON.stringify(body);
}

function saveHomebrew(state, input = {}, actorId = '') {
  ensureWorldCollections(state);
  const existing = input.id ? state.homebrew.find((item) => item.id === input.id) || null : null;
  const base = normalizeHomebrewBase({ ...existing, ...input });
  const requestedStatus = HOMEBREW_STATUSES.includes(input.status) ? input.status : (existing?.status || 'draft');

  if (existing?.status === 'approved' && bodyChanged(existing, input)) {
    const revision = {
      ...base,
      id: id('homebrew'),
      entryId: existing.entryId || existing.id,
      status: 'draft',
      revision: Number(existing.revision || 1) + 1,
      submittedSnapshot: null,
      approvedBy: '',
      approvedAt: '',
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.homebrew.push(revision);
    return { record: clone(revision), createdRevision: true, previousId: existing.id };
  }

  if (existing && requestedStatus !== existing.status && !HOMEBREW_TRANSITIONS[existing.status]?.includes(requestedStatus)) {
    throw Object.assign(new Error(`Homebrew cannot move from ${existing.status} to ${requestedStatus}.`), { code: 'DND_HOMEBREW_TRANSITION_INVALID' });
  }
  if (!existing && requestedStatus !== 'draft') {
    throw Object.assign(new Error('New homebrew must begin as a draft.'), { code: 'DND_HOMEBREW_TRANSITION_INVALID' });
  }

  const record = {
    ...existing,
    ...base,
    id: existing?.id || id('homebrew'),
    entryId: existing?.entryId || base.entryId,
    status: requestedStatus,
    revision: Number(existing?.revision || 1),
    submittedSnapshot: existing?.submittedSnapshot || null,
    approvedBy: existing?.approvedBy || '',
    approvedAt: existing?.approvedAt || '',
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  if (requestedStatus === 'submitted' && existing?.status !== 'submitted') record.submittedSnapshot = clone(record.body);
  if (requestedStatus === 'approved' && existing?.status !== 'approved') {
    record.submittedSnapshot ||= clone(record.body);
    record.approvedBy = clean(actorId, 100);
    record.approvedAt = nowIso();
  }
  const index = state.homebrew.findIndex((item) => item.id === record.id);
  if (index >= 0) state.homebrew[index] = record;
  else state.homebrew.push(record);
  return { record: clone(record), createdRevision: false, previousId: '' };
}

function createDesktopRoll(state, input = {}, actorId = '', randomInt) {
  ensureWorldCollections(state);
  const campaignId = clean(input.campaignId, 100);
  if (!campaignId) throw Object.assign(new Error('Select a campaign before rolling dice.'), { code: 'DND_CAMPAIGN_REQUIRED' });
  const privacy = input.privacy === 'dm_only' ? 'dm_only' : 'public';
  if (input.privacy === 'blind') {
    throw Object.assign(new Error('Blind rolls require a verified Discord DM destination and cannot be executed from the local desktop roller.'), { code: 'MISSING_DM_ROLL_DESTINATION' });
  }
  const parsed = parseDiceExpression(input.expression);
  const result = rollDice(parsed, randomInt);
  const record = {
    id: id('roll'),
    campaignId,
    sessionId: clean(input.sessionId, 100),
    characterId: clean(input.characterId, 100),
    userId: clean(actorId, 100),
    discordUserId: '',
    appId: 'local-desktop',
    guildId: '',
    channelId: '',
    interactionId: '',
    expression: result.original,
    normalizedExpression: result.normalized,
    rolls: result.rolls,
    keptIndexes: result.keptIndexes,
    modifier: result.modifier,
    total: result.total,
    privacy,
    deliveredToDm: false,
    parserVersion: '1',
    metadata: { source: 'desktop' },
    createdAt: nowIso()
  };
  state.rolls.push(record);
  return clone(record);
}

module.exports = {
  WORLD_TYPES,
  CONTENT_ORIGINS,
  FULL_TEXT_ORIGINS,
  HOMEBREW_STATUSES,
  HOMEBREW_TRANSITIONS,
  EXTRA_COLLECTIONS,
  ensureWorldCollections,
  normalizeWorldRecord,
  normalizeLoot,
  normalizeContentEntry,
  saveHomebrew,
  createDesktopRoll,
  contentHash
};
