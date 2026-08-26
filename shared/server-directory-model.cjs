'use strict';

const OWNER_TYPES = Object.freeze(['nexus-official', 'community']);
const APPLICATION_STATES = Object.freeze(['draft', 'submitted', 'automated-review', 'staff-review', 'changes-required', 'approved', 'denied', 'listed', 'suspended', 'delisted']);

const SERVER_TYPES = Object.freeze({
  generic: {
    id: 'generic',
    label: 'Dedicated / Direct Connect',
    fields: ['serverName', 'host', 'gamePort', 'queryPort', 'rconPort', 'joinPassword', 'description', 'joinInstructions', 'region', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'host'],
    private: ['joinPassword', 'rconPort', 'adminNotes'],
    health: { mode: 'probe', automatic: true },
    management: { mode: 'game-adapter' }
  },
  'once-human-custom': {
    id: 'once-human-custom',
    label: 'Once Human Custom Server',
    gameId: 'once-human',
    fields: ['serverName', 'customServerId', 'region', 'scenario', 'joinPassword', 'description', 'joinInstructions', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'customServerId'],
    private: ['joinPassword', 'adminNotes'],
    health: { mode: 'manual-or-connector', automatic: false },
    management: { mode: 'manual-or-connector', capabilities: ['settings-profiles', 'events', 'shop', 'players', 'admins', 'snapshots', 'audit'] }
  },
  'minecraft-java': {
    id: 'minecraft-java',
    label: 'Minecraft Java Dedicated',
    gameId: 'minecraft',
    fields: ['serverName', 'host', 'gamePort', 'queryPort', 'joinPassword', 'description', 'joinInstructions', 'region', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'host'],
    private: ['joinPassword', 'adminNotes'],
    health: { mode: 'minecraft-status', automatic: true },
    management: { mode: 'adapter' }
  },
  'minecraft-bedrock': {
    id: 'minecraft-bedrock',
    label: 'Minecraft Bedrock Dedicated',
    gameId: 'minecraft',
    fields: ['serverName', 'host', 'gamePort', 'joinPassword', 'description', 'joinInstructions', 'region', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'host'],
    private: ['joinPassword', 'adminNotes'],
    health: { mode: 'minecraft-status', automatic: true },
    management: { mode: 'adapter' }
  },
  'minecraft-realm-java': {
    id: 'minecraft-realm-java',
    label: 'Minecraft Realm - Java',
    gameId: 'minecraft',
    fields: ['serverName', 'realmOwner', 'realmInviteCode', 'joinApproval', 'description', 'joinInstructions', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'realmOwner'],
    private: ['realmInviteCode', 'adminNotes'],
    health: { mode: 'owner-attestation', automatic: false },
    management: { mode: 'realm-owner' }
  },
  'minecraft-realm-bedrock': {
    id: 'minecraft-realm-bedrock',
    label: 'Minecraft Realm - Bedrock',
    gameId: 'minecraft',
    fields: ['serverName', 'realmOwner', 'realmInviteCode', 'realmShareLink', 'joinApproval', 'description', 'joinInstructions', 'publicVisibility', 'adminNotes'],
    required: ['serverName', 'realmOwner'],
    private: ['realmInviteCode', 'realmShareLink', 'adminNotes'],
    health: { mode: 'owner-attestation', automatic: false },
    management: { mode: 'realm-owner' }
  }
});

const GAME_TYPES = Object.freeze({
  'once-human': ['once-human-custom'],
  minecraft: ['minecraft-java', 'minecraft-bedrock', 'minecraft-realm-java', 'minecraft-realm-bedrock'],
  ark: ['generic'],
  palworld: ['generic'],
  rust: ['generic'],
  satisfactory: ['generic'],
  other: ['generic']
});

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeServerType(value) {
  const id = clean(value, 80) || 'generic';
  if (!SERVER_TYPES[id]) throw new Error(`Unsupported server type: ${id}`);
  return id;
}

function availableServerTypes(gameId) {
  return (GAME_TYPES[clean(gameId, 80).toLowerCase()] || ['generic']).map((id) => SERVER_TYPES[id]);
}

function validateOnceHumanId(value) {
  const id = clean(value, 32);
  if (!/^\d{8,20}$/.test(id)) throw new Error('Once Human Custom Server ID must be 8-20 digits.');
  return id;
}

function normalizeMonetization(input = {}) {
  return {
    acceptsDonations: Boolean(input.acceptsDonations),
    sellsCosmetics: Boolean(input.sellsCosmetics),
    sellsGameplayAdvantages: Boolean(input.sellsGameplayAdvantages),
    requiresPaymentToJoin: Boolean(input.requiresPaymentToJoin),
    affiliateOrReferralRevenue: Boolean(input.affiliateOrReferralRevenue),
    intendedForProfit: Boolean(input.intendedForProfit),
    monthlyOperatingCost: Math.max(0, Number(input.monthlyOperatingCost) || 0),
    expectedMonthlyRevenue: Math.max(0, Number(input.expectedMonthlyRevenue) || 0),
    disclosure: clean(input.disclosure, 2000)
  };
}

function monetizationRisk(input = {}) {
  const m = normalizeMonetization(input);
  const blockers = [];
  const warnings = [];
  if (m.requiresPaymentToJoin) blockers.push('Mandatory payment to join');
  if (m.sellsGameplayAdvantages) blockers.push('Paid gameplay advantages / pay-to-win');
  if (m.intendedForProfit) blockers.push('Server is intended to generate profit');
  if (m.affiliateOrReferralRevenue) warnings.push('Affiliate/referral monetization requires staff review');
  if (m.expectedMonthlyRevenue > m.monthlyOperatingCost && m.expectedMonthlyRevenue > 0) warnings.push('Expected revenue exceeds disclosed operating cost');
  if ((m.acceptsDonations || m.sellsCosmetics) && !m.disclosure) warnings.push('Monetization disclosure is incomplete');
  return { blockers, warnings, pass: blockers.length === 0 };
}

function normalizeServerRecord(input = {}, options = {}) {
  const gameId = clean(input.gameId || 'other', 80).toLowerCase();
  const serverType = normalizeServerType(input.serverType || (gameId === 'once-human' ? 'once-human-custom' : 'generic'));
  const schema = SERVER_TYPES[serverType];
  if (schema.gameId && schema.gameId !== gameId) throw new Error(`${schema.label} is not valid for ${gameId}.`);
  const ownerType = OWNER_TYPES.includes(input.ownerType) ? input.ownerType : 'community';
  if (ownerType === 'nexus-official' && !options.canCreateOfficial) throw new Error('Creating Khaos Nexus Official servers requires servers.official.create permission.');

  const record = {
    id: clean(input.id, 120) || `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    gameId,
    serverType,
    ownerType,
    ownerUserId: clean(input.ownerUserId, 120),
    ownerDisplayName: clean(input.ownerDisplayName, 160),
    serverName: clean(input.serverName, 160),
    host: clean(input.host, 255),
    gamePort: clean(input.gamePort, 12),
    queryPort: clean(input.queryPort, 12),
    rconPort: clean(input.rconPort, 12),
    customServerId: serverType === 'once-human-custom' && input.customServerId ? validateOnceHumanId(input.customServerId) : clean(input.customServerId, 32),
    region: clean(input.region, 120),
    scenario: clean(input.scenario, 160),
    realmOwner: clean(input.realmOwner, 160),
    realmInviteCode: clean(input.realmInviteCode, 255),
    realmShareLink: clean(input.realmShareLink, 1000),
    joinApproval: clean(input.joinApproval || 'request-access', 40),
    joinPassword: clean(input.joinPassword, 255),
    description: clean(input.description, 2000),
    joinInstructions: clean(input.joinInstructions, 2000),
    publicVisibility: clean(input.publicVisibility || 'listed', 40),
    adminNotes: clean(input.adminNotes, 4000),
    monetization: normalizeMonetization(input.monetization),
    applicationState: APPLICATION_STATES.includes(input.applicationState) ? input.applicationState : (ownerType === 'nexus-official' ? 'approved' : 'draft'),
    health: {
      mode: schema.health.mode,
      automatic: Boolean(schema.health.automatic),
      state: clean(input.health?.state || 'unknown', 40),
      offlineSince: input.health?.offlineSince || null,
      lastCheckedAt: input.health?.lastCheckedAt || null,
      maintenanceUntil: input.health?.maintenanceUntil || null
    },
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  for (const field of schema.required) {
    if (!clean(record[field], 4000)) throw new Error(`${field} is required for ${schema.label}.`);
  }
  if (ownerType === 'community') {
    const risk = monetizationRisk(record.monetization);
    record.vetting = { ...risk, reviewedAt: input.vetting?.reviewedAt || null, reviewedBy: clean(input.vetting?.reviewedBy, 160), notes: clean(input.vetting?.notes, 2000) };
  } else record.vetting = { blockers: [], warnings: [], pass: true, reviewedAt: null, reviewedBy: '', notes: '' };

  return record;
}

function sanitizePublic(record) {
  const schema = SERVER_TYPES[record.serverType] || SERVER_TYPES.generic;
  const blocked = new Set([...schema.private, 'monetization', 'vetting', 'ownerUserId']);
  const copy = JSON.parse(JSON.stringify(record));
  for (const key of blocked) delete copy[key];
  if (copy.health && !copy.health.automatic) {
    delete copy.health.offlineSince;
    delete copy.health.lastCheckedAt;
  }
  return copy;
}

function offlinePolicy(record, now = Date.now(), policy = {}) {
  const hours = (value, fallback) => Math.max(1, Number(value) || fallback) * 60 * 60 * 1000;
  const warnAfter = hours(policy.warnAfterHours, 24);
  const markOfflineAfter = hours(policy.markOfflineAfterHours, 48);
  const delistAfter = hours(policy.delistAfterHours, 72);
  const suspendAfter = hours(policy.suspendAfterHours, 168);
  if (!record?.health?.automatic || !record.health.offlineSince || record.health.maintenanceUntil) return { action: 'none', reason: 'No automatic offline action applies.' };
  const elapsed = now - new Date(record.health.offlineSince).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return { action: 'none', reason: 'Invalid or future offline timestamp.' };
  if (elapsed >= suspendAfter) return { action: 'suspend', reason: 'Server exceeded offline suspension threshold.' };
  if (elapsed >= delistAfter) return { action: 'delist', reason: 'Server exceeded offline delisting threshold.' };
  if (elapsed >= markOfflineAfter) return { action: 'mark-offline', reason: 'Server exceeded offline listing threshold.' };
  if (elapsed >= warnAfter) return { action: 'warn-owner', reason: 'Server exceeded offline warning threshold.' };
  return { action: 'none', reason: 'Offline threshold not reached.' };
}

module.exports = {
  OWNER_TYPES,
  APPLICATION_STATES,
  SERVER_TYPES,
  GAME_TYPES,
  availableServerTypes,
  validateOnceHumanId,
  normalizeMonetization,
  monetizationRisk,
  normalizeServerRecord,
  sanitizePublic,
  offlinePolicy
};
