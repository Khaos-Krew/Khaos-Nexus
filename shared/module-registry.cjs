'use strict';

const base = require('./module-catalog.cjs');
const { moduleForServer } = require('./game-module-policy.cjs');

const IMPLEMENTED_PATCHES = Object.freeze({
  'operator-console': {
    dependencies: ['game-server-control'],
    description: 'Safe Recovery, Maintenance Mode, server health and guarded self-healing without requiring the Discord bot to remain enabled.'
  },
  'server-scheduler': {
    stage: 'live', launchView: 'scheduler', availability: 'implemented',
    description: 'Recurring saves and host-managed restart workflows with warnings, cancellation, verification, Discord reporting and execution history.'
  },
  'players-console': {
    stage: 'live', launchView: 'players', availability: 'implemented',
    description: 'Cross-server player visibility and guarded moderation with short-lived action tokens and audit history.'
  },
  'server-status-panels': {
    stage: 'live', launchView: 'status-panels', availability: 'implemented',
    description: 'Persistent Discord game-server panels with public-safe status, player summaries and automatic refresh.'
  },
  'pterodactyl-control': {
    stage: 'live', launchView: 'hosted-servers', availability: 'implemented',
    description: 'Encrypted Pterodactyl Client API connections, live resource snapshots and guarded start, stop, restart and kill controls.',
    features: ['Encrypted provider profiles', 'Server discovery', 'Live resource snapshots', 'Start, stop, restart and kill', 'Short-lived action tokens', 'Protected action history'],
    dependencies: ['game-server-control']
  },
  'ark-server-operations': {
    stage: 'live', launchView: 'servers', availability: 'implemented',
    description: 'ARK RCON status, players, saves, broadcasts, moderation and Discord status panels.'
  },
  'embed-studio': {
    stage: 'live', launchView: 'discord-studio', availability: 'implemented'
  },
  'role-menus': {
    stage: 'live', launchView: 'discord-automation', availability: 'implemented'
  },
  'color-roles': {
    stage: 'live', launchView: 'discord-automation', availability: 'implemented'
  },
  'discord-organization': {
    stage: 'live', launchView: 'discord-automation', availability: 'implemented'
  },
  'discord-audit-logging': {
    stage: 'live', launchView: 'discord-automation', availability: 'implemented',
    dependencies: ['discord-runtime']
  },
  'admin-command-center': {
    stage: 'live', launchView: 'operator', availability: 'implemented'
  }
});

const ADDITIONAL_MODULES = Object.freeze([
  {
    id: 'rust-server-operations', name: 'Rust Server Operations', category: 'Server Operations', workspace: 'Operations',
    stage: 'live', availability: 'implemented', priority: 15, launchView: 'servers', requiredRole: 'viewer',
    description: 'Vanilla-safe Rust WebRCON status, players, saves, announcements, moderation, guarded console access and Discord status panels.',
    features: ['WebRCON status', 'JSON player list', 'World save', 'Announcements', 'Kick, ban and unban', 'Owner raw console', 'Confirmed shutdown', 'Discord status panels'],
    sourceRoutes: ['/rust', '/servers/rust'], dependencies: ['game-server-control']
  },
  {
    id: 'satisfactory-server-operations', name: 'Satisfactory Server Operations', category: 'Server Operations', workspace: 'Operations',
    stage: 'live', availability: 'implemented', priority: 16, launchView: 'servers', requiredRole: 'viewer',
    description: 'Official Satisfactory HTTPS API and lightweight UDP query status, saves, server options, console access, shutdown and Discord status panels.',
    features: ['HTTPS API health and state', 'Lightweight loading-state query', 'TLS certificate pinning', 'Application token authentication', 'Connected player counts', 'Server options', 'Save enumeration and world saves', 'Owner console commands', 'Save-first shutdown', 'Discord status panels'],
    sourceRoutes: ['/satisfactory', '/servers/satisfactory'], dependencies: ['game-server-control']
  },
  {
    id: 'discord-observability', name: 'Discord Observability', category: 'Discord Automation', workspace: 'Discord',
    stage: 'live', availability: 'implemented', priority: 19, launchView: 'discord-observability', requiredRole: 'viewer',
    description: 'Discord heartbeat, release, error and server-health delivery with protected routing and retained history.',
    features: ['Heartbeat panel', 'Release notices', 'Error notices', 'Server-health notices', 'Channel tests', 'Delivery history'],
    sourceRoutes: ['/admin/discord-observability'], dependencies: ['discord-runtime', 'application-monitor']
  },
  {
    id: 'mobile-gateway', name: 'Mobile Companion Gateway', category: 'Private Administration', workspace: 'Private',
    stage: 'foundation', availability: 'partial', priority: 61, launchView: 'mobile-companion', requiredRole: 'owner',
    description: 'Owner-controlled Android pairing contract and protected gateway settings. Network transport remains disabled until HTTPS validation is complete.',
    features: ['Pairing preview', 'Role contract', 'Device registry', 'Revocation', 'Protected settings', 'Future HTTPS transport'],
    sourceRoutes: ['/mobile-companion'], dependencies: ['admin-command-center']
  }
]);

const VIEW_RULES = Object.freeze({
  // Discord Setup remains visible so an access-controlled Owner can always authenticate and re-enable the bot runtime.
  // Game Servers remains visible when a game adapter is disabled so the Owner can repair its configuration.
  servers: { allOf: ['game-server-control'] },
  monitor: { allOf: ['application-monitor'] },
  operator: { allOf: ['operator-console'] },
  'discord-studio': { anyOf: ['embed-studio', 'server-status-panels'] },
  'discord-automation': { anyOf: ['role-menus', 'color-roles', 'discord-organization', 'discord-audit-logging'] },
  'status-panels': { allOf: ['server-status-panels'] },
  scheduler: { allOf: ['server-scheduler'] },
  players: { allOf: ['players-console'] },
  'hosted-servers': { allOf: ['pterodactyl-control'] },
  'discord-observability': { allOf: ['discord-observability'] },
  'mobile-companion': { allOf: ['mobile-gateway'] }
});

const LEGACY_MAP = Object.freeze({
  discordAutomation: 'discord-runtime', gameServers: 'game-server-control', palworldOps: 'palworld-operations',
  embedStudio: 'embed-studio', communityManager: 'communities-directory', arkCompanion: 'ark-companion',
  palworldCompanion: 'palworld-companion', warframeCompanion: 'warframe-companion', idleonCompanion: 'idleon-companion'
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function catalog() {
  const items = base.MODULE_CATALOG.map((module) => ({
    ...clone(module),
    availability: module.availability || (module.stage === 'live' ? 'implemented' : ['foundation', 'building'].includes(module.stage) ? 'partial' : 'planned'),
    ...(IMPLEMENTED_PATCHES[module.id] || {})
  }));
  items.push(...ADDITIONAL_MODULES.map(clone));
  return items.sort((left, right) => Number(left.priority || 999) - Number(right.priority || 999));
}

function getModule(id) {
  return catalog().find((module) => module.id === id) || null;
}

function defaultCompletedSteps(stage) {
  const count = { live: 6, foundation: 3, building: 2, queued: 1, private: 3 }[stage] || 0;
  return base.MIGRATION_STEPS.slice(0, count).map((step) => step.id);
}

function normalizeModuleOverrides(input = {}) {
  const validIds = new Set(catalog().map((module) => module.id));
  const source = input && typeof input === 'object' ? input : {};
  const result = {};
  for (const [id, value] of Object.entries(source)) {
    if (!validIds.has(id)) continue;
    if (typeof value === 'boolean') result[id] = { enabled: value, updatedAt: null };
    else if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'enabled')) {
      result[id] = { enabled: Boolean(value.enabled), updatedAt: value.updatedAt ? String(value.updatedAt) : null };
    }
  }
  return result;
}

function defaultModuleStates(legacyModules = {}, overrides = {}) {
  const enabledFromLegacy = new Set(Object.entries(LEGACY_MAP).filter(([key]) => legacyModules?.[key] === true).map(([, id]) => id));
  const normalizedOverrides = normalizeModuleOverrides(overrides);
  return Object.fromEntries(catalog().map((module) => {
    const state = {
      enabled: module.stage === 'live' || enabledFromLegacy.has(module.id),
      completedSteps: defaultCompletedSteps(module.stage),
      notes: '',
      updatedAt: null
    };
    if (normalizedOverrides[module.id]) state.enabled = normalizedOverrides[module.id].enabled;
    return [module.id, state];
  }));
}

function mergeModuleStates(input = {}, legacyModules = {}, overrides = {}) {
  const defaults = defaultModuleStates(legacyModules, overrides);
  const source = input && typeof input === 'object' ? input : {};
  const validSteps = new Set(base.MIGRATION_STEPS.map((step) => step.id));
  for (const module of catalog()) {
    const current = source[module.id];
    if (!current || typeof current !== 'object') continue;
    defaults[module.id] = {
      enabled: Boolean(current.enabled),
      completedSteps: [...new Set((Array.isArray(current.completedSteps) ? current.completedSteps : []).filter((step) => validSteps.has(step)))],
      notes: String(current.notes || '').slice(0, 2000),
      updatedAt: current.updatedAt ? String(current.updatedAt) : null
    };
  }
  const normalizedOverrides = normalizeModuleOverrides(overrides);
  for (const [id, override] of Object.entries(normalizedOverrides)) defaults[id].enabled = override.enabled;
  return defaults;
}

function roleAtLeast(role, requiredRole) {
  return (base.ROLE_RANK[role] ?? 0) >= (base.ROLE_RANK[requiredRole] ?? 0);
}

function moduleVisibleForRole(module, role) {
  if (!module) return false;
  if (module.hidden && !roleAtLeast(role, 'owner')) return false;
  return roleAtLeast(role, module.requiredRole || 'viewer');
}

function moduleProgress(state) {
  const completed = new Set(state?.completedSteps || []);
  return Math.round((base.MIGRATION_STEPS.filter((step) => completed.has(step.id)).length / base.MIGRATION_STEPS.length) * 100);
}

function resolveModuleRuntime(statesInput, id, stack = [], mergedInput = null) {
  const merged = mergedInput || mergeModuleStates(statesInput);
  const module = getModule(id);
  if (!module) return { id, requestedEnabled: false, effectiveEnabled: false, blockedBy: [], reason: 'unknown-module', availability: 'planned' };
  if (stack.includes(id)) return { id, requestedEnabled: false, effectiveEnabled: false, blockedBy: [...stack, id], reason: 'dependency-cycle', availability: module.availability };
  const requestedEnabled = Boolean(merged[id]?.enabled);
  if (!requestedEnabled) return { id, requestedEnabled, effectiveEnabled: false, blockedBy: [], reason: 'disabled-by-owner', availability: module.availability };
  if (module.availability === 'planned') return { id, requestedEnabled, effectiveEnabled: false, blockedBy: [], reason: 'not-implemented', availability: module.availability };
  const blockedBy = [];
  for (const dependency of module.dependencies || []) {
    const state = resolveModuleRuntime(merged, dependency, [...stack, id], merged);
    if (!state.effectiveEnabled) blockedBy.push(dependency);
  }
  return {
    id,
    requestedEnabled,
    effectiveEnabled: blockedBy.length === 0,
    blockedBy,
    reason: blockedBy.length ? 'dependency-disabled' : 'enabled',
    availability: module.availability
  };
}

function buildModuleRuntime(statesInput = {}) {
  const merged = mergeModuleStates(statesInput);
  return Object.fromEntries(catalog().map((module) => [module.id, resolveModuleRuntime(merged, module.id, [], merged)]));
}

function decisionEnabled(runtime, decision) {
  if (!decision) return true;
  const allOf = Array.isArray(decision.allOf) ? decision.allOf : [];
  const anyOf = Array.isArray(decision.anyOf) ? decision.anyOf : [];
  if (allOf.some((id) => !runtime[id]?.effectiveEnabled)) return false;
  if (anyOf.length && !anyOf.some((id) => runtime[id]?.effectiveEnabled)) return false;
  return true;
}

function configuredServer(configStore, id) {
  try {
    return configStore?.getConfig?.().servers?.find((server) => String(server.id) === String(id)) || null;
  } catch {
    return null;
  }
}

function moduleDecisionForChannel(channel, args = [], configStore = null) {
  const name = String(channel || '');
  if (!name || name.startsWith('modules:') || name.startsWith('startup-health:') || name.startsWith('stability:')) return null;
  // Desktop Discord OAuth remains available so an access-controlled Owner can always sign in and re-enable Discord Runtime.
  if (name.startsWith('discord-auth:')) return null;
  // Satisfactory certificate trust is a local repair/configuration action and remains available while its operations module is disabled.
  if (name === 'server:satisfactory-trust-certificate') return null;
  if (name.startsWith('bot:') || ['config:save-discord', 'secret:set-discord-token'].includes(name)) return { allOf: ['discord-runtime'] };
  if (name === 'server:palworld-action') return { allOf: ['palworld-operations'] };
  if (name === 'server:rust-action') return { allOf: ['rust-server-operations'] };
  if (name === 'server:satisfactory-action') return { allOf: ['satisfactory-server-operations'] };
  if (name === 'server:test') {
    const server = configuredServer(configStore, args?.[0]);
    if (server) return { allOf: ['game-server-control', moduleForServer(server)] };
  }
  if (name.startsWith('server:')) return { allOf: ['game-server-control'] };
  if (name.startsWith('autonomy:')) return { allOf: ['operator-console'] };
  if (name.startsWith('status-panels:')) return { allOf: ['server-status-panels'] };
  if (name.startsWith('server-scheduler:')) return { allOf: ['server-scheduler'] };
  if (name.startsWith('player-console:')) return { allOf: ['players-console'] };
  if (name.startsWith('hosted-server:')) return { allOf: ['pterodactyl-control'] };
  if (name.startsWith('discord-observability:')) return { allOf: ['discord-observability'] };
  if (name.startsWith('mobile-gateway:')) return { allOf: ['mobile-gateway'] };
  if (/^(monitor:|secret:set-github-token|config:save-monitor)/.test(name)) return { allOf: ['application-monitor'] };
  if (/^(backup:|update:)/.test(name)) return { allOf: ['backup-update-center'] };
  if (name.startsWith('discord-studio:')) {
    if (/:(save-panel|remove-panel|publish-panel|refresh-panel|refresh-all|delete-published-panel)$/.test(name)) return { allOf: ['server-status-panels'] };
    return { allOf: ['embed-studio'] };
  }
  if (name.startsWith('discord-automation:')) {
    if (/:(save-layout|remove-layout|preview-layout|apply-layout)$/.test(name)) return { allOf: ['discord-organization'] };
    if (/:(save-audit|clear-audit|export-audit)$/.test(name)) return { allOf: ['discord-audit-logging'] };
    if (/:(save-menu|remove-menu|publish-menu|delete-published-menu)$/.test(name)) {
      let kind = String(args?.[0]?.kind || '').toLowerCase();
      if (!kind && typeof args?.[0] === 'string') {
        try { kind = String(configStore?.getDiscordAutomation?.().roleMenus?.find((item) => item.id === args[0])?.kind || '').toLowerCase(); } catch {}
      }
      return { allOf: [kind === 'color' || kind === 'colors' ? 'color-roles' : 'role-menus'] };
    }
    return { anyOf: ['role-menus', 'color-roles', 'discord-organization', 'discord-audit-logging'] };
  }
  return null;
}

function summarizeMigration(statesInput, role = 'local-admin') {
  const merged = mergeModuleStates(statesInput);
  const runtime = buildModuleRuntime(merged);
  const visible = catalog().filter((module) => moduleVisibleForRole(module, role));
  const progressValues = visible.map((module) => moduleProgress(merged[module.id]));
  return {
    total: visible.length,
    enabled: visible.filter((module) => runtime[module.id]?.effectiveEnabled).length,
    requestedEnabled: visible.filter((module) => merged[module.id]?.enabled).length,
    blocked: visible.filter((module) => merged[module.id]?.enabled && !runtime[module.id]?.effectiveEnabled).length,
    implemented: visible.filter((module) => module.availability === 'implemented').length,
    partial: visible.filter((module) => module.availability === 'partial').length,
    planned: visible.filter((module) => module.availability === 'planned').length,
    overallProgress: progressValues.length ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length) : 0,
    completed: visible.filter((module) => moduleProgress(merged[module.id]) === 100).length,
    byStage: Object.fromEntries(base.VALID_STAGES.map((stage) => [stage, visible.filter((module) => module.stage === stage).length]))
  };
}

function catalogForRole(role = 'local-admin') {
  return catalog().filter((module) => moduleVisibleForRole(module, role));
}

function validateRegistry() {
  const items = catalog();
  const ids = new Set();
  for (const module of items) {
    if (!module.id || ids.has(module.id)) throw new Error(`Duplicate or missing module ID: ${module.id}`);
    ids.add(module.id);
    if (!['implemented', 'partial', 'planned'].includes(module.availability)) throw new Error(`Invalid availability for ${module.id}`);
  }
  for (const module of items) for (const dependency of module.dependencies || []) if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${module.id}`);
  const visit = (id, trail = []) => {
    if (trail.includes(id)) throw new Error(`Module dependency cycle: ${[...trail, id].join(' -> ')}`);
    const module = items.find((item) => item.id === id);
    for (const dependency of module?.dependencies || []) visit(dependency, [...trail, id]);
  };
  for (const module of items) visit(module.id);
  return true;
}

validateRegistry();

module.exports = {
  MIGRATION_STEPS: base.MIGRATION_STEPS,
  ROLE_RANK: base.ROLE_RANK,
  VALID_STAGES: base.VALID_STAGES,
  VIEW_RULES,
  catalog,
  catalogForRole,
  getModule,
  defaultModuleStates,
  mergeModuleStates,
  normalizeModuleOverrides,
  moduleVisibleForRole,
  moduleProgress,
  resolveModuleRuntime,
  buildModuleRuntime,
  decisionEnabled,
  moduleDecisionForChannel,
  summarizeMigration,
  roleAtLeast,
  validateRegistry
};