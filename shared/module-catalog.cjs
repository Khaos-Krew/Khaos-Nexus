'use strict';

const MIGRATION_STEPS = Object.freeze([
  { id: 'inventory', label: 'Feature inventory', description: 'Confirm the website functions, routes, data and expected operator workflow.' },
  { id: 'data', label: 'Local data model', description: 'Define local-first storage, import/export and optional shared-service boundaries.' },
  { id: 'services', label: 'Desktop services', description: 'Implement the isolated background services, APIs and bot integrations.' },
  { id: 'interface', label: 'Nexus interface', description: 'Build the clean desktop workspace and responsive operator controls.' },
  { id: 'access', label: 'Access and audit', description: 'Apply owner/operator/viewer permissions, confirmations and audit records.' },
  { id: 'validation', label: 'Validation and release', description: 'Test failure paths, backups, packaging and upgrade compatibility.' }
]);

const ROLE_RANK = Object.freeze({ locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 });
const VALID_STAGES = Object.freeze(['live', 'foundation', 'building', 'queued', 'private']);

const MODULE_CATALOG = Object.freeze([
  {
    id: 'discord-runtime', name: 'Discord Runtime', category: 'Core Operations', workspace: 'Discord', stage: 'live', priority: 1,
    description: 'Protected bot credentials, supervised runtime, command registration, crash recovery and Discord operator login.',
    features: ['Start, stop and restart', 'Slash-command registration', 'Protected token storage', 'Discord OAuth operator login', 'Crash isolation and recovery'],
    sourceRoutes: ['/discord', '/discord-apps'], launchView: 'setup', requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'game-server-control', name: 'Game Server Control', category: 'Core Operations', workspace: 'Operations', stage: 'live', priority: 2,
    description: 'Unified local control for configured game servers with protected credentials and health checks.',
    features: ['Server registry', 'Connection testing', 'Readiness checks', 'Health monitoring', 'Maintenance workflows'],
    sourceRoutes: ['/servers', '/my-servers', '/server-control'], launchView: 'servers', requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'palworld-operations', name: 'Palworld Operations', category: 'Core Operations', workspace: 'Operations', stage: 'live', priority: 3,
    description: 'Full Palworld REST management for status, players, settings, metrics, saves, announcements, moderation and shutdown.',
    features: ['REST status and players', 'World save', 'Announcements', 'Kick, ban and unban', 'Graceful shutdown and force stop', 'World snapshot export'],
    sourceRoutes: ['/palworld', '/admin/servers/palworld/:serverId'], launchView: 'servers', requiredRole: 'viewer', dependencies: ['game-server-control']
  },
  {
    id: 'operator-console', name: 'Operator Console', category: 'Core Operations', workspace: 'Operations', stage: 'live', priority: 4,
    description: 'Safe Recovery, Maintenance Mode, automatic backups, server health and guarded self-healing.',
    features: ['Safe Recovery', 'Maintenance Mode', 'Verified backups', 'Automatic health checks', 'Private Discord notices'],
    sourceRoutes: ['/admin/system-health'], launchView: 'operator', requiredRole: 'viewer', dependencies: ['discord-runtime', 'game-server-control']
  },
  {
    id: 'application-monitor', name: 'Application Monitor', category: 'Core Operations', workspace: 'System', stage: 'live', priority: 5,
    description: 'Redacted diagnostics, error fingerprints, offline report queueing and opt-in GitHub issue delivery.',
    features: ['Redacted diagnostics', 'Error fingerprints', 'Duplicate suppression', 'Offline queue', 'GitHub issue reporting'],
    sourceRoutes: ['/admin/system-health', '/admin/audit-log'], launchView: 'monitor', requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'backup-update-center', name: 'Backup & Update Center', category: 'Core Operations', workspace: 'System', stage: 'live', priority: 6,
    description: 'Verified configuration backups, restore, stable release checks and in-app update installation.',
    features: ['Manual and scheduled backups', 'Backup verification', 'Restore', 'Portable self-update', 'Installed-build update channel'],
    sourceRoutes: ['/admin/setup'], launchView: 'settings', requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'server-scheduler', name: 'Server Scheduler', category: 'Server Operations', workspace: 'Operations', stage: 'foundation', priority: 10,
    description: 'Scheduled warnings, saves, restarts, maintenance windows and recurring server tasks.',
    features: ['Recurring schedules', 'Restart warnings', 'Save-before-action', 'Per-server tasks', 'Execution history'],
    sourceRoutes: ['/scheduler'], launchView: 'operator', requiredRole: 'operator', dependencies: ['game-server-control']
  },
  {
    id: 'players-console', name: 'Players & Moderation', category: 'Server Operations', workspace: 'Operations', stage: 'foundation', priority: 11,
    description: 'Cross-server player visibility, moderation actions and operator-safe confirmations.',
    features: ['Player lists', 'Cross-server search', 'Kick and ban', 'Action reasons', 'Audit history'],
    sourceRoutes: ['/players'], launchView: 'servers', requiredRole: 'operator', dependencies: ['game-server-control']
  },
  {
    id: 'server-status-panels', name: 'Server Status Panels', category: 'Server Operations', workspace: 'Operations', stage: 'foundation', priority: 12,
    description: 'Persistent Discord status panels and public-safe game server summaries.',
    features: ['Live status cards', 'Refresh controls', 'Public-safe fields', 'Discord channel publishing', 'Embed fault containment'],
    sourceRoutes: ['/status', '/discord-status'], requiredRole: 'operator', dependencies: ['discord-runtime', 'game-server-control']
  },
  {
    id: 'pterodactyl-control', name: 'Hosted Server Control', category: 'Server Operations', workspace: 'Operations', stage: 'queued', priority: 13,
    description: 'Provider-backed server power, console, files, backups, schedules, startup variables, databases and subusers.',
    features: ['Start, stop, restart and kill', 'Live console', 'File and config editor', 'Backup restore', 'Schedules and startup variables', 'Ports, databases and subusers'],
    sourceRoutes: ['/my-servers', '/server-control', '/server-owner-tools'], requiredRole: 'owner', dependencies: ['game-server-control']
  },
  {
    id: 'ark-server-operations', name: 'ARK Server Operations', category: 'Server Operations', workspace: 'Operations', stage: 'foundation', priority: 14,
    description: 'ARK RCON, players, saves, broadcasts, moderation, status panels and cluster-aware administration.',
    features: ['RCON status', 'Cluster players', 'SaveWorld', 'Broadcasts', 'Moderation', 'Status embeds'],
    sourceRoutes: ['/ark-dododex', '/rcon'], launchView: 'servers', requiredRole: 'operator', dependencies: ['game-server-control']
  },
  {
    id: 'other-game-operations', name: 'Additional Game Operations', category: 'Server Operations', workspace: 'Operations', stage: 'queued', priority: 15,
    description: 'Focused server operation adapters for Minecraft, 7 Days to Die, Conan Exiles and Rust.',
    features: ['Game-specific health', 'Console commands', 'Save and restart', 'Player tools', 'Status embeds'],
    sourceRoutes: ['/minecraft', '/7-days-to-die', '/conan-exiles', '/rust'], requiredRole: 'operator', dependencies: ['game-server-control']
  },
  {
    id: 'embed-studio', name: 'Embed Studio', category: 'Discord Automation', workspace: 'Discord', stage: 'building', priority: 20,
    description: 'Design, preview, publish and maintain component-based Discord embeds for every supported module.',
    features: ['Visual embed builder', 'Component v2 layouts', 'Game banners', 'Preview and validation', 'Persistent publishing'],
    sourceRoutes: ['/module-embeds', '/embed-studio'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'role-menus', name: 'Role Menus', category: 'Discord Automation', workspace: 'Discord', stage: 'building', priority: 21,
    description: 'Button-driven platform, game, pronoun, notification and category visibility roles.',
    features: ['Button role menus', 'Category visibility', 'Platform roles', 'Pronoun roles', 'Notification roles'],
    sourceRoutes: ['/admin/discord-role-menus'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'color-roles', name: 'Color Roles', category: 'Discord Automation', workspace: 'Discord', stage: 'building', priority: 22,
    description: 'Hex-based name color choices positioned safely below protected staff roles.',
    features: ['Color buttons', 'Hex previews', 'Role ordering safety', 'Staff-compatible changes', 'Automatic cleanup'],
    sourceRoutes: ['/admin/discord-color-roles'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'discord-organization', name: 'Discord Organization', category: 'Discord Automation', workspace: 'Discord', stage: 'building', priority: 23,
    description: 'Module-driven categories, channels, voice spaces and server layout synchronization.',
    features: ['Category templates', 'Channel creation', 'Voice channels', 'Duplicate prevention', 'Module synchronization'],
    sourceRoutes: ['/admin/discord-modules'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'discord-audit-logging', name: 'Discord Logs & Audit', category: 'Discord Automation', workspace: 'Discord', stage: 'building', priority: 24,
    description: 'Structured Discord and application activity logs with tags, filters and retention.',
    features: ['Member logs', 'Moderation logs', 'Configuration logs', 'Tagged events', 'Retention and export'],
    sourceRoutes: ['/admin/discord-logs', '/admin/audit-log'], requiredRole: 'operator', dependencies: ['discord-runtime', 'application-monitor']
  },
  {
    id: 'role-sync-staff', name: 'Role Sync & Staff', category: 'Discord Automation', workspace: 'Discord', stage: 'queued', priority: 25,
    description: 'Role synchronization, senior-staff controls and owner-safe delegation.',
    features: ['Role synchronization', 'Community Manager delegation', 'Senior staff rules', 'Protected role boundaries', 'Permission review'],
    sourceRoutes: ['/role-sync', '/admin/discord-senior-staff'], requiredRole: 'owner', dependencies: ['discord-runtime']
  },
  {
    id: 'chat-relay', name: 'Chat Relay', category: 'Discord Automation', workspace: 'Discord', stage: 'queued', priority: 26,
    description: 'Controlled game-to-Discord and Discord-to-game relay with channel routing and moderation.',
    features: ['Game chat relay', 'Channel routing', 'Message filtering', 'Rate limits', 'Relay health'],
    sourceRoutes: ['/relay'], requiredRole: 'operator', dependencies: ['discord-runtime', 'game-server-control']
  },
  {
    id: 'leveling-tickets', name: 'Leveling & Support Tickets', category: 'Discord Automation', workspace: 'Discord', stage: 'queued', priority: 27,
    description: 'Community leveling, rewards, support tickets and staff escalation workflows.',
    features: ['XP and levels', 'Reward roles', 'Ticket panels', 'Claim and close', 'Transcripts'],
    sourceRoutes: ['/discord-apps'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'patch-notes', name: 'Patch Notes Automation', category: 'Discord Automation', workspace: 'Discord', stage: 'queued', priority: 28,
    description: 'Collect, review and publish game or application update notes to Discord.',
    features: ['Update feeds', 'Review queue', 'Game targeting', 'Discord publishing', 'History'],
    sourceRoutes: ['/patch-notes'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'communities-directory', name: 'Communities Directory', category: 'Community', workspace: 'Community', stage: 'queued', priority: 30,
    description: 'Create, edit, discover and safely publish community profiles and server listings.',
    features: ['Community profiles', 'Public discovery', 'Ownership checks', 'Submission review', 'Safe public fields'],
    sourceRoutes: ['/communities', '/communities/new', '/communities/:slug', '/communities/:slug/edit'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'groups-events-lfg', name: 'Groups, Events & LFG', category: 'Community', workspace: 'Community', stage: 'queued', priority: 31,
    description: 'Organize groups, events, recruitment and looking-for-group posts from one workspace.',
    features: ['Groups', 'Events calendar', 'LFG posts', 'Recruitment', 'Moderation and expiry'],
    sourceRoutes: ['/groups', '/events', '/lfg', '/recruitment'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'profiles-achievements', name: 'Nexus Profiles & Achievements', category: 'Community', workspace: 'Community', stage: 'queued', priority: 32,
    description: 'Local and optional shared profiles, achievements, badges and community identity.',
    features: ['Nexus profile', 'Achievements', 'Badges', 'Privacy controls', 'Public sharing'],
    sourceRoutes: ['/profile', '/nexus-profile', '/achievements'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'supporter-status', name: 'Supporter Status', category: 'Community', workspace: 'Community', stage: 'queued', priority: 33,
    description: 'Supporter recognition, entitlement visibility and administrative review without coupling core operation to billing.',
    features: ['Supporter lookup', 'Entitlement display', 'Manual grants', 'History', 'Privacy-safe status'],
    sourceRoutes: ['/support/status', '/admin/kofi'], requiredRole: 'owner', dependencies: []
  },
  {
    id: 'ark-companion', name: 'ARK Companion', category: 'Game Companions', workspace: 'Companions', stage: 'queued', priority: 40,
    description: 'Taming, breeding, mod discovery, server notes, resource guidance and base automation references.',
    features: ['Taming tools', 'Breeding guide', 'Mod discovery', 'Resource guides', 'Server notes'],
    sourceRoutes: ['/ark-dododex'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'palworld-companion', name: 'Palworld Companion', category: 'Game Companions', workspace: 'Companions', stage: 'foundation', priority: 41,
    description: 'Breeding, maps, base automation, rates, snapshots, configuration and server operations in one module.',
    features: ['Breeding', 'Map and atlas', 'Base automation', 'Rates and settings', 'Server operations'],
    sourceRoutes: ['/palworld'], launchView: 'servers', requiredRole: 'viewer', dependencies: ['palworld-operations']
  },
  {
    id: 'warframe-companion', name: 'Warframe Companion', category: 'Game Companions', workspace: 'Companions', stage: 'queued', priority: 42,
    description: 'Market and wiki search, builds, progression planning, clan tools and update-aware references.',
    features: ['Market search', 'Wiki search', 'Build library', 'Progression planner', 'Clan hub'],
    sourceRoutes: ['/warframe', '/warframe-hub'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'idleon-companion', name: 'IdleOn Companion', category: 'Game Companions', workspace: 'Companions', stage: 'foundation', priority: 43,
    description: 'Account import, review, compare, history, achievements and controlled public sharing.',
    features: ['Account import', 'Review dashboard', 'Comparison', 'History', 'Achievements and sharing'],
    sourceRoutes: ['/idleon', '/idleon/import', '/idleon/review', '/idleon/share', '/idleon/compare', '/idleon/history', '/idleon/achievements', '/idleon/profile/:slug', '/idleon/debug'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'sandbox-companions', name: 'Sandbox Game Companions', category: 'Game Companions', workspace: 'Companions', stage: 'queued', priority: 44,
    description: 'Companion workspaces for Minecraft, 7 Days to Die, Conan Exiles and Rust.',
    features: ['Guides', 'Server notes', 'Mod discovery', 'Configuration helpers', 'Update tracking'],
    sourceRoutes: ['/minecraft', '/7-days-to-die', '/conan-exiles', '/rust'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'streamer-toolkit', name: 'Streamer Toolkit', category: 'Creator & Content', workspace: 'Creator', stage: 'foundation', priority: 50,
    description: 'Twitch live tools, go-live announcements, clips, schedules and OBS-ready overlays.',
    features: ['Streamer dashboard', 'Live status', 'Go-live Discord notices', 'Clips and schedule', 'OBS overlays'],
    sourceRoutes: ['/streamer', '/live', '/overlay/:slug'], requiredRole: 'operator', dependencies: ['discord-runtime']
  },
  {
    id: 'wallpapers-assets', name: 'Wallpapers & Asset Library', category: 'Creator & Content', workspace: 'Creator', stage: 'foundation', priority: 51,
    description: 'Manage the Khaos Nexus crest, game-themed wallpapers, banners and downloadable community assets.',
    features: ['Wallpaper catalog', 'Crest variants', 'Game banners', 'Publishing workflow', 'Download metadata'],
    sourceRoutes: ['/wallpapers', '/admin/wallpapers'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'guide-knowledge', name: 'Guide & Knowledge Center', category: 'Creator & Content', workspace: 'Content', stage: 'queued', priority: 52,
    description: 'Searchable categorized guides, setup instructions and module-specific knowledge.',
    features: ['Search', 'Categories', 'Single-open sections', 'Module guides', 'Version notes'],
    sourceRoutes: ['/guide', '/guide/ark-survival-ascended-discord-bot'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'support-feedback', name: 'Support & Feedback', category: 'Creator & Content', workspace: 'Content', stage: 'queued', priority: 53,
    description: 'Prominent support, structured feedback, issue triage and administrative review.',
    features: ['Support requests', 'Feedback form', 'Attachments', 'Status tracking', 'Admin review'],
    sourceRoutes: ['/support', '/feedback', '/admin/feedback'], requiredRole: 'viewer', dependencies: ['application-monitor']
  },
  {
    id: 'merch-support', name: 'Merch & Support Links', category: 'Creator & Content', workspace: 'Content', stage: 'queued', priority: 54,
    description: 'A clean optional storefront and supporter links separated from core application operation.',
    features: ['Merch catalog', 'External provider links', 'Wallpaper separation', 'Support links', 'Admin visibility'],
    sourceRoutes: ['/merch', '/shop', '/store'], requiredRole: 'viewer', dependencies: []
  },
  {
    id: 'admin-command-center', name: 'Admin Command Center', category: 'Private Administration', workspace: 'Private', stage: 'foundation', priority: 60,
    description: 'A focused owner workspace for analytics, health, audit, setup, feedback and advanced operations.',
    features: ['Admin overview', 'Analytics', 'System health', 'Audit log', 'Setup checklist', 'Advanced operations'],
    sourceRoutes: ['/admin-center', '/analytics', '/admin/advanced', '/admin/system-health', '/admin/audit-log', '/admin/setup'], launchView: 'operator', requiredRole: 'owner', dependencies: ['operator-console', 'application-monitor']
  },
  {
    id: 'dnd-workspace', name: 'Dungeons & Dragons Workspace', category: 'Private Administration', workspace: 'Private', stage: 'private', priority: 99,
    description: 'Owner-hidden campaign, source, content, homebrew, character and future encounter management.',
    features: ['Campaigns and members', 'Source toggles', 'Content library', 'Homebrew approval', 'Characters and builder', 'Future dice, encounters, quests, NPCs, locations, loot, sessions and calendar'],
    sourceRoutes: ['/dnd', '/dnd/campaigns', '/dnd/characters', '/dnd/sources', '/dnd/content', '/dnd/homebrew', '/dnd/dice', '/dnd/encounters', '/dnd/quests', '/dnd/npcs', '/dnd/locations', '/dnd/loot', '/dnd/sessions', '/dnd/calendar', '/dnd/settings'], requiredRole: 'owner', dependencies: [], hidden: true
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultCompletedSteps(stage) {
  const count = { live: 6, foundation: 3, building: 2, queued: 1, private: 3 }[stage] || 0;
  return MIGRATION_STEPS.slice(0, count).map((step) => step.id);
}

function defaultModuleStates(previous = {}) {
  const legacy = previous && typeof previous === 'object' ? previous : {};
  const legacyMap = {
    discordAutomation: 'discord-runtime', gameServers: 'game-server-control', palworldOps: 'palworld-operations',
    embedStudio: 'embed-studio', communityManager: 'communities-directory', arkCompanion: 'ark-companion',
    palworldCompanion: 'palworld-companion', warframeCompanion: 'warframe-companion', idleonCompanion: 'idleon-companion'
  };
  const enabledFromLegacy = new Set(Object.entries(legacyMap).filter(([key]) => legacy[key] === true).map(([, id]) => id));
  return Object.fromEntries(MODULE_CATALOG.map((module) => [module.id, {
    enabled: module.stage === 'live' || enabledFromLegacy.has(module.id),
    completedSteps: defaultCompletedSteps(module.stage), notes: '', updatedAt: null
  }]));
}

function mergeModuleStates(input, legacyModules = {}) {
  const defaults = defaultModuleStates(legacyModules);
  const source = input && typeof input === 'object' ? input : {};
  const validStepIds = new Set(MIGRATION_STEPS.map((step) => step.id));
  for (const module of MODULE_CATALOG) {
    const current = source[module.id];
    if (!current || typeof current !== 'object') continue;
    defaults[module.id] = {
      enabled: Boolean(current.enabled),
      completedSteps: [...new Set((Array.isArray(current.completedSteps) ? current.completedSteps : []).filter((id) => validStepIds.has(id)))],
      notes: String(current.notes || '').slice(0, 2000),
      updatedAt: current.updatedAt ? String(current.updatedAt) : null
    };
  }
  return defaults;
}

function roleAtLeast(role, requiredRole) {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[requiredRole] ?? 0);
}

function moduleVisibleForRole(module, role) {
  if (!module) return false;
  if (module.hidden && !roleAtLeast(role, 'owner')) return false;
  return roleAtLeast(role, module.requiredRole || 'viewer');
}

function moduleProgress(state) {
  const completed = new Set(state?.completedSteps || []);
  return Math.round((MIGRATION_STEPS.filter((step) => completed.has(step.id)).length / MIGRATION_STEPS.length) * 100);
}

function summarizeMigration(states, role = 'local-admin') {
  const merged = mergeModuleStates(states);
  const visible = MODULE_CATALOG.filter((module) => moduleVisibleForRole(module, role));
  const progressValues = visible.map((module) => moduleProgress(merged[module.id]));
  const byStage = Object.fromEntries(VALID_STAGES.map((stage) => [stage, visible.filter((module) => module.stage === stage).length]));
  return {
    total: visible.length,
    enabled: visible.filter((module) => merged[module.id]?.enabled).length,
    overallProgress: progressValues.length ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length) : 0,
    byStage,
    completed: visible.filter((module) => moduleProgress(merged[module.id]) === 100).length
  };
}

function getModule(id) { return MODULE_CATALOG.find((module) => module.id === id) || null; }
function catalogForRole(role = 'local-admin') { return MODULE_CATALOG.filter((module) => moduleVisibleForRole(module, role)).map(clone); }

function validateCatalog() {
  const ids = new Set();
  for (const module of MODULE_CATALOG) {
    if (!module.id || ids.has(module.id)) throw new Error(`Duplicate or missing module ID: ${module.id}`);
    ids.add(module.id);
    if (!VALID_STAGES.includes(module.stage)) throw new Error(`Invalid module stage for ${module.id}`);
    if (!Array.isArray(module.features) || !module.features.length) throw new Error(`Module ${module.id} requires features.`);
  }
  for (const module of MODULE_CATALOG) {
    for (const dependency of module.dependencies || []) if (!ids.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${module.id}`);
  }
  return true;
}

validateCatalog();

module.exports = { MIGRATION_STEPS, ROLE_RANK, VALID_STAGES, MODULE_CATALOG, defaultModuleStates, mergeModuleStates, moduleVisibleForRole, moduleProgress, summarizeMigration, catalogForRole, getModule, validateCatalog, roleAtLeast };
