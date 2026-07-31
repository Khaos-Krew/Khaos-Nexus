'use strict';

const crypto = require('node:crypto');

const SETUP_MODES = Object.freeze([
  'none', 'existing-channel', 'existing-thread', 'existing-forum-post', 'create-thread', 'create-forum-post'
]);
const RESOURCE_TYPES = Object.freeze(['channel', 'thread', 'forum_post']);
const PURPOSES = Object.freeze(['main', 'dm_private', 'dice_log', 'character_chat', 'session_notes', 'loot', 'announcements', 'voice']);
const DND_SCOPES = Object.freeze([
  'campaign:read', 'characters:read', 'characters:update', 'rolls:create', 'encounters:manage',
  'sessions:manage', 'quests:read', 'panels:manage'
]);
const CAMPAIGN_ROLES = Object.freeze(['admin', 'dm', 'assistant_dm', 'player', 'viewer']);
const ATTENDANCE_STATUSES = Object.freeze(['attending', 'maybe', 'unavailable', 'late']);
const ROLL_PRIVACY = Object.freeze(['public', 'dm_only', 'blind']);
const CHARACTER_STATUSES = Object.freeze(['active', 'backup', 'deceased', 'retired', 'inactive']);
const SNOWFLAKE = /^\d{5,25}$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function clean(value, max = 200) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw Object.assign(new Error(`${label} is invalid.`), { code: 'INVALID_ARGUMENT' });
  return value;
}
function normalizeSnowflake(value, label = 'Discord ID', { optional = false } = {}) {
  const result = clean(value, 25);
  if (!result && optional) return '';
  if (!SNOWFLAKE.test(result)) throw Object.assign(new Error(`${label} must be a valid Discord snowflake.`), { code: 'INVALID_DISCORD_SNOWFLAKE' });
  return result;
}
function uniqueStrings(values, allowed = null) {
  const list = [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 80)).filter(Boolean))];
  return allowed ? list.filter((value) => allowed.includes(value)) : list;
}

function defaultDndState() {
  return {
    schemaVersion: 1,
    campaigns: [], members: [], sources: [], campaignSources: [], characters: [], rolls: [],
    encounters: [], combatants: [], quests: [], loot: [], sessions: [], attendance: [],
    bindings: [], grants: [], channelContexts: [], panels: [], registeredApps: [], audit: []
  };
}

function normalizeDndState(input = {}) {
  const base = defaultDndState();
  const result = { ...base, ...(input && typeof input === 'object' ? input : {}) };
  result.schemaVersion = 1;
  for (const key of Object.keys(base)) {
    if (Array.isArray(base[key])) result[key] = Array.isArray(result[key]) ? result[key] : [];
  }
  return result;
}

function normalizeCampaign(input = {}) {
  const timestamp = nowIso();
  return {
    id: clean(input.id, 100) || id('campaign'),
    name: clean(input.name, 120),
    description: clean(input.description, 2000),
    status: ['planning', 'active', 'paused', 'completed', 'archived'].includes(input.status) ? input.status : 'planning',
    ruleset: clean(input.ruleset || '5e_2024', 80),
    ownerUserId: clean(input.ownerUserId, 100),
    currentLocation: clean(input.currentLocation, 200),
    activeQuestId: clean(input.activeQuestId, 100),
    createdAt: input.createdAt || timestamp,
    updatedAt: timestamp
  };
}

function normalizeMember(input = {}) {
  return {
    id: clean(input.id, 100) || id('member'),
    campaignId: clean(input.campaignId, 100),
    userId: clean(input.userId, 100),
    discordUserId: input.discordUserId ? normalizeSnowflake(input.discordUserId, 'Discord user ID') : '',
    displayName: clean(input.displayName, 120),
    role: assertEnum(input.role || 'player', CAMPAIGN_ROLES, 'Campaign role'),
    capabilities: uniqueStrings(input.capabilities),
    active: input.active !== false,
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeRegisteredApp(input = {}) {
  return {
    id: clean(input.id, 100) || id('discord_app'),
    applicationId: input.applicationId ? normalizeSnowflake(input.applicationId, 'Discord application ID') : '',
    botUserId: input.botUserId ? normalizeSnowflake(input.botUserId, 'Discord bot user ID') : '',
    name: clean(input.name || 'Registered Discord App', 120),
    enabled: input.enabled !== false,
    modules: uniqueStrings(input.modules || ['dnd-workspace']),
    guildIds: uniqueStrings(input.guildIds).map((value) => normalizeSnowflake(value, 'Guild ID')),
    legacyNexusBot: Boolean(input.legacyNexusBot),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeBinding(input = {}) {
  const resourceType = assertEnum(input.resourceType || 'channel', RESOURCE_TYPES, 'Discord resource type');
  const purpose = assertEnum(input.purpose || 'main', PURPOSES, 'Binding purpose');
  return {
    id: clean(input.id, 100) || id('binding'),
    campaignId: clean(input.campaignId, 100),
    appId: clean(input.appId, 100),
    guildId: normalizeSnowflake(input.guildId, 'Guild ID'),
    resourceType,
    resourceId: normalizeSnowflake(input.resourceId, resourceType === 'channel' ? 'Channel ID' : 'Thread or forum post ID'),
    parentChannelId: input.parentChannelId ? normalizeSnowflake(input.parentChannelId, 'Parent channel ID') : '',
    displayName: clean(input.displayName, 120),
    purpose,
    primary: Boolean(input.primary),
    active: input.active !== false,
    createdBy: clean(input.createdBy, 100),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso(),
    verifiedAt: input.verifiedAt || '',
    lastError: clean(input.lastError, 500)
  };
}

function normalizeGrant(input = {}) {
  return {
    id: clean(input.id, 100) || id('grant'),
    campaignId: clean(input.campaignId, 100),
    appId: clean(input.appId, 100),
    guildId: normalizeSnowflake(input.guildId, 'Guild ID'),
    scopes: uniqueStrings(input.scopes, DND_SCOPES),
    active: input.active !== false,
    createdBy: clean(input.createdBy, 100),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeChannelContext(input = {}) {
  return {
    id: clean(input.id, 100) || id('context'),
    appId: clean(input.appId, 100),
    guildId: normalizeSnowflake(input.guildId, 'Guild ID'),
    channelId: normalizeSnowflake(input.channelId, 'Shared channel ID'),
    campaignId: clean(input.campaignId, 100),
    selectedBy: clean(input.selectedBy, 100),
    active: input.active !== false,
    updatedAt: nowIso()
  };
}

function normalizePanel(input = {}) {
  return {
    id: clean(input.id, 100) || id('panel'),
    bindingId: clean(input.bindingId, 100),
    messageId: input.messageId ? normalizeSnowflake(input.messageId, 'Panel message ID') : '',
    contentHash: clean(input.contentHash, 128),
    lastRefreshedAt: input.lastRefreshedAt || '',
    lastError: clean(input.lastError, 500),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeSession(input = {}) {
  const allowed = ['planned', 'active', 'completed', 'cancelled'];
  return {
    id: clean(input.id, 100) || id('session'),
    campaignId: clean(input.campaignId, 100),
    title: clean(input.title || 'Campaign session', 160),
    status: allowed.includes(input.status) ? input.status : 'planned',
    startsAt: input.startsAt || '',
    endsAt: input.endsAt || '',
    timezone: clean(input.timezone || 'UTC', 80),
    recapDraft: clean(input.recapDraft, 12000),
    recapApprovedAt: input.recapApprovedAt || '',
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function normalizeAttendance(input = {}) {
  return {
    id: clean(input.id, 100) || id('attendance'),
    sessionId: clean(input.sessionId, 100),
    campaignId: clean(input.campaignId, 100),
    userId: clean(input.userId, 100),
    discordUserId: input.discordUserId ? normalizeSnowflake(input.discordUserId, 'Discord user ID') : '',
    status: assertEnum(input.status || 'maybe', ATTENDANCE_STATUSES, 'Attendance status'),
    note: clean(input.note, 500),
    updatedAt: nowIso()
  };
}

function normalizeCharacter(input = {}) {
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  return {
    id: clean(input.id, 100) || id('character'),
    campaignId: clean(input.campaignId, 100),
    ownerUserId: clean(input.ownerUserId, 100),
    discordUserId: input.discordUserId ? normalizeSnowflake(input.discordUserId, 'Discord user ID') : '',
    name: clean(input.name, 120),
    portraitUrl: clean(input.portraitUrl, 800),
    level: Math.max(0, Math.min(30, number(input.level, 1))),
    className: clean(input.className, 120),
    hp: number(input.hp),
    maxHp: number(input.maxHp),
    armorClass: number(input.armorClass),
    conditions: uniqueStrings(input.conditions),
    inspiration: Boolean(input.inspiration),
    exhaustion: Math.max(0, Math.min(6, number(input.exhaustion))),
    status: CHARACTER_STATUSES.includes(input.status) ? input.status : 'active',
    activeQuestId: clean(input.activeQuestId, 100),
    initiativeModifier: number(input.initiativeModifier),
    abilityModifiers: input.abilityModifiers && typeof input.abilityModifiers === 'object' ? clone(input.abilityModifiers) : {},
    selected: Boolean(input.selected),
    createdAt: input.createdAt || nowIso(),
    updatedAt: nowIso()
  };
}

function assertBindingConstraints(bindings, candidate) {
  const duplicate = bindings.find((item) => item.active !== false && item.id !== candidate.id &&
    item.campaignId === candidate.campaignId && item.appId === candidate.appId && item.guildId === candidate.guildId &&
    item.resourceType === candidate.resourceType && item.resourceId === candidate.resourceId && item.purpose === candidate.purpose);
  if (duplicate) throw Object.assign(new Error('This campaign resource is already bound for that purpose.'), { code: 'DUPLICATE_BINDING' });
  if (candidate.active && candidate.primary && candidate.purpose === 'main') {
    const conflict = bindings.find((item) => item.active !== false && item.id !== candidate.id && item.primary && item.purpose === 'main' &&
      item.campaignId === candidate.campaignId && item.appId === candidate.appId && item.guildId === candidate.guildId);
    if (conflict) throw Object.assign(new Error('Only one active primary main binding is allowed for this campaign, bot, and guild.'), { code: 'PRIMARY_BINDING_CONFLICT' });
  }
}

function validateSetupOperation(input = {}) {
  const mode = assertEnum(input.mode || 'none', SETUP_MODES, 'Setup mode');
  if (mode === 'none') return { mode, creates: 0, resourceType: null };
  if (mode === 'create-thread') return { mode, creates: 1, resourceType: 'thread' };
  if (mode === 'create-forum-post') return { mode, creates: 1, resourceType: 'forum_post' };
  return { mode, creates: 0, resourceType: mode.replace('existing-', '').replace('forum-post', 'forum_post') };
}

function resolveCampaignContext({ bindings = [], contexts = [], appId, guildId, channelId, parentChannelId = '' }) {
  const normalizedChannel = normalizeSnowflake(channelId, 'Channel ID');
  const exact = bindings.filter((item) => item.active !== false && item.appId === appId && item.guildId === guildId && item.resourceId === normalizedChannel);
  const exactCampaigns = [...new Set(exact.map((item) => item.campaignId))];
  if (exactCampaigns.length === 1) return { campaignId: exactCampaigns[0], source: 'exact', binding: exact.find((item) => item.primary) || exact[0] };
  if (exactCampaigns.length > 1) {
    const selected = contexts.find((item) => item.active !== false && item.appId === appId && item.guildId === guildId && item.channelId === normalizedChannel);
    if (selected && exactCampaigns.includes(selected.campaignId)) {
      return {
        campaignId: selected.campaignId,
        source: 'explicit-context',
        binding: exact.find((item) => item.campaignId === selected.campaignId && item.primary) || exact.find((item) => item.campaignId === selected.campaignId)
      };
    }
    throw Object.assign(new Error('Multiple campaigns are bound to this Discord resource. Use /campaign use to select the active campaign.'), { code: 'AMBIGUOUS_CAMPAIGN_CONTEXT' });
  }

  if (parentChannelId) {
    const parent = normalizeSnowflake(parentChannelId, 'Parent channel ID');
    const inherited = bindings.filter((item) => item.active !== false && item.appId === appId && item.guildId === guildId && item.resourceId === parent && item.resourceType === 'channel');
    const campaigns = [...new Set(inherited.map((item) => item.campaignId))];
    if (campaigns.length === 1) return { campaignId: campaigns[0], source: 'parent', binding: inherited.find((item) => item.primary) || inherited[0] };
    if (campaigns.length > 1) {
      const selected = contexts.find((item) => item.active !== false && item.appId === appId && item.guildId === guildId && item.channelId === parent);
      if (selected && campaigns.includes(selected.campaignId)) return { campaignId: selected.campaignId, source: 'explicit-parent-context', binding: inherited.find((item) => item.campaignId === selected.campaignId) };
      throw Object.assign(new Error('This shared parent channel has multiple campaigns and no active campaign selection.'), { code: 'AMBIGUOUS_SHARED_CHANNEL' });
    }
  }

  const selected = contexts.find((item) => item.active !== false && item.appId === appId && item.guildId === guildId && item.channelId === normalizedChannel);
  if (selected) return { campaignId: selected.campaignId, source: 'explicit-context', binding: null };
  throw Object.assign(new Error('No D&D campaign context is configured for this Discord resource.'), { code: 'NO_CAMPAIGN_CONTEXT' });
}

function grantFor(state, campaignId, appId, guildId) {
  return state.grants.find((item) => item.active !== false && item.campaignId === campaignId && item.appId === appId && item.guildId === guildId) || null;
}
function requireScope(state, campaignId, appId, guildId, scope) {
  const grant = grantFor(state, campaignId, appId, guildId);
  if (!grant) throw Object.assign(new Error('This bot does not have a campaign grant.'), { code: 'MISSING_CAMPAIGN_GRANT' });
  if (!grant.scopes.includes(scope)) throw Object.assign(new Error(`This bot is missing the ${scope} scope.`), { code: 'MISSING_DND_SCOPE' });
  return grant;
}
function roleForDiscordUser(state, campaignId, discordUserId) {
  return state.members.find((item) => item.active !== false && item.campaignId === campaignId && item.discordUserId === String(discordUserId || ''))?.role || null;
}
function canManageCampaign(role) { return ['admin', 'dm', 'assistant_dm'].includes(role); }
function requireCampaignRole(state, campaignId, discordUserId, { manage = false } = {}) {
  const role = roleForDiscordUser(state, campaignId, discordUserId);
  if (!role) throw Object.assign(new Error('You are not a member of this campaign.'), { code: 'CAMPAIGN_ACCESS_DENIED' });
  if (manage && !canManageCampaign(role)) throw Object.assign(new Error('This action requires campaign owner, DM, or assistant DM access.'), { code: 'INSUFFICIENT_CAMPAIGN_ROLE' });
  return role;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function stableHash(value) { return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex'); }

function campaignPanelData(state, campaignId) {
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  if (!campaign) throw Object.assign(new Error('Campaign not found.'), { code: 'CAMPAIGN_NOT_FOUND' });
  const members = state.members.filter((item) => item.active !== false && item.campaignId === campaignId);
  const characters = state.characters.filter((item) => item.campaignId === campaignId && item.status === 'active');
  const sessions = state.sessions.filter((item) => item.campaignId === campaignId);
  const nextSession = sessions.filter((item) => item.status === 'planned' && item.startsAt).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0] || null;
  const activeSession = sessions.find((item) => item.status === 'active') || null;
  const quest = state.quests.find((item) => item.id === campaign.activeQuestId) || state.quests.find((item) => item.campaignId === campaignId && item.status === 'active') || null;
  const dm = members.find((item) => item.role === 'dm') || members.find((item) => item.role === 'admin') || null;
  return {
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status, ruleset: campaign.ruleset },
    dm: dm ? { id: dm.id, displayName: dm.displayName } : null,
    playerCount: members.filter((item) => item.role === 'player').length,
    nextSession: nextSession ? { id: nextSession.id, title: nextSession.title, startsAt: nextSession.startsAt } : null,
    activeSession: activeSession ? { id: activeSession.id, title: activeSession.title, startsAt: activeSession.startsAt } : null,
    currentLocation: campaign.currentLocation || '',
    activeQuest: quest ? { id: quest.id, title: quest.title || quest.name || 'Active quest' } : null,
    party: characters.map((item) => ({ id: item.id, name: item.name, hp: item.hp, maxHp: item.maxHp, armorClass: item.armorClass, conditions: item.conditions }))
  };
}

function parseDiceExpression(expression) {
  const input = clean(expression, 80).toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{0,3})d(\d{1,5})(?:(kh|kl)(\d{1,3}))?([+-]\d{1,6})?$/.exec(input);
  if (!match) throw Object.assign(new Error('Use dice notation such as d20, 2d6+3, 2d20kh1+5, or 2d20kl1.'), { code: 'INVALID_DICE_EXPRESSION' });
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const keepMode = match[3] || '';
  const keepCount = keepMode ? Number(match[4] || 1) : count;
  const modifier = Number(match[5] || 0);
  if (count < 1 || count > 100) throw Object.assign(new Error('Dice count must be between 1 and 100.'), { code: 'DICE_LIMIT_EXCEEDED' });
  if (sides < 2 || sides > 10000) throw Object.assign(new Error('Die sides must be between 2 and 10,000.'), { code: 'DICE_LIMIT_EXCEEDED' });
  if (keepCount < 1 || keepCount > count) throw Object.assign(new Error('The keep count must be between 1 and the number of dice.'), { code: 'INVALID_DICE_EXPRESSION' });
  return { original: clean(expression, 80), normalized: `${count}d${sides}${keepMode}${keepMode ? keepCount : ''}${modifier >= 0 && modifier ? `+${modifier}` : modifier || ''}`, count, sides, keepMode, keepCount, modifier };
}

function rollDice(expression, randomInt = crypto.randomInt) {
  const parsed = typeof expression === 'string' ? parseDiceExpression(expression) : expression;
  const rolls = Array.from({ length: parsed.count }, () => randomInt(1, parsed.sides + 1));
  const indexed = rolls.map((value, index) => ({ index, value }));
  let kept = indexed;
  if (parsed.keepMode === 'kh') kept = [...indexed].sort((a, b) => b.value - a.value || a.index - b.index).slice(0, parsed.keepCount);
  if (parsed.keepMode === 'kl') kept = [...indexed].sort((a, b) => a.value - b.value || a.index - b.index).slice(0, parsed.keepCount);
  const keptIndexes = kept.map((item) => item.index).sort((a, b) => a - b);
  return { ...parsed, rolls, keptIndexes, subtotal: kept.reduce((sum, item) => sum + item.value, 0), total: kept.reduce((sum, item) => sum + item.value, 0) + parsed.modifier };
}

function validateRollPrivacy({ privacy, dmDestinationAvailable }) {
  const mode = assertEnum(privacy || 'public', ROLL_PRIVACY, 'Roll privacy');
  if (mode === 'blind' && !dmDestinationAvailable) {
    throw Object.assign(new Error('A blind roll requires a verified DM-only destination. No roll was executed or saved.'), { code: 'MISSING_DM_ROLL_DESTINATION' });
  }
  return { mode, mayExecute: true, deliveryRequired: mode !== 'public', deliveryAvailable: Boolean(dmDestinationAvailable) };
}

function sortInitiative(combatants) {
  return [...combatants].sort((a, b) => Number(b.initiative || 0) - Number(a.initiative || 0) || Number(b.dexterity || 0) - Number(a.dexterity || 0) || String(a.id).localeCompare(String(b.id)));
}
function advanceInitiative(encounter, combatants) {
  const order = sortInitiative(combatants.filter((item) => item.active !== false));
  if (!order.length) throw Object.assign(new Error('No active combatants are in initiative.'), { code: 'EMPTY_INITIATIVE' });
  const currentIndex = Math.max(0, Math.min(order.length - 1, Number(encounter.currentTurnIndex || 0)));
  const nextIndex = currentIndex + 1 >= order.length ? 0 : currentIndex + 1;
  const nextRound = nextIndex === 0 ? Math.max(1, Number(encounter.round || 1)) + 1 : Math.max(1, Number(encounter.round || 1));
  return { order, currentTurnIndex: nextIndex, round: nextRound, currentCombatant: order[nextIndex] };
}

function startSession(state, sessionId, { resetInitiative = false } = {}) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error('Session not found.'), { code: 'SESSION_NOT_FOUND' });
  if (state.sessions.some((item) => item.campaignId === session.campaignId && item.status === 'active' && item.id !== session.id)) {
    throw Object.assign(new Error('Another session is already active for this campaign.'), { code: 'ACTIVE_SESSION_CONFLICT' });
  }
  session.status = 'active';
  session.startsAt ||= nowIso();
  session.updatedAt = nowIso();
  if (resetInitiative) {
    for (const encounter of state.encounters.filter((item) => item.campaignId === session.campaignId && item.status === 'active')) {
      encounter.currentTurnIndex = 0;
      encounter.round = 1;
    }
  }
  return session;
}

function endSession(state, sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) throw Object.assign(new Error('Session not found.'), { code: 'SESSION_NOT_FOUND' });
  session.status = 'completed';
  session.endsAt ||= nowIso();
  session.updatedAt = nowIso();
  const rolls = state.rolls.filter((item) => item.campaignId === session.campaignId && item.createdAt >= (session.startsAt || ''));
  const encounters = state.encounters.filter((item) => item.campaignId === session.campaignId && item.updatedAt >= (session.startsAt || ''));
  session.recapDraft = [
    `Session: ${session.title}`,
    `Recorded rolls: ${rolls.length}`,
    `Encounter updates: ${encounters.length}`,
    'Draft generated from Khaos Nexus activity only. DM approval is required before publishing.'
  ].join('\n');
  session.recapApprovedAt = '';
  return session;
}

module.exports = {
  SETUP_MODES, RESOURCE_TYPES, PURPOSES, DND_SCOPES, CAMPAIGN_ROLES, ATTENDANCE_STATUSES, ROLL_PRIVACY,
  defaultDndState, normalizeDndState, normalizeCampaign, normalizeMember, normalizeRegisteredApp, normalizeBinding,
  normalizeGrant, normalizeChannelContext, normalizePanel, normalizeSession, normalizeAttendance, normalizeCharacter,
  assertBindingConstraints, validateSetupOperation, resolveCampaignContext, grantFor, requireScope, roleForDiscordUser,
  canManageCampaign, requireCampaignRole, stableHash, campaignPanelData, parseDiceExpression, rollDice,
  validateRollPrivacy, sortInitiative, advanceInitiative, startSession, endSession, normalizeSnowflake, clean, clone, id, nowIso
};
