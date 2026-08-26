'use strict';

const ONCE_HUMAN_SETUP_VERSION = '2026-08';

const ONCE_HUMAN_SETUP_SECTIONS = Object.freeze([
  { id: 'identity-access', title: 'Identity & Access', settings: ['Server name', 'Server slogan / introduction', 'Public/unlocked access or invitation-code access', 'Player capacity'] },
  { id: 'scenario', title: 'Scenario', settings: ['Scenario selection', 'Scenario gameplay mode', 'Scenario difficulty/stage/task settings', 'Scenario-specific switches and rules'] },
  { id: 'world', title: 'World', settings: ['Weather parameters', 'Day/night cycle', 'Resource distribution and respawn behavior'] },
  { id: 'character-progression', title: 'Character & Progression', settings: ['Hunger/thirst and survival pressure', 'Experience/progression rates', 'Death penalties', 'Starting/progression/tech point rules'] },
  { id: 'combat', title: 'Combat', settings: ['Combat difficulty/modifiers', 'PvE/PvP scenario-specific combat options', 'Damage/encounter tuning exposed by the selected scenario'] },
  { id: 'building-survival', title: 'Building & Survival', settings: ['Building and facility rules', 'Construction/maintenance parameters', 'Vehicle availability', 'Facility restrictions'] },
  { id: 'tech-social', title: 'Tech & Social', settings: ['Crafting/management efficiency', 'Technology-related parameters', 'Hive/community capacity and social rules'] },
  { id: 'host-admin', title: 'Host & Administration', settings: ['Host/GM privileges', 'Administrator assignment', 'Player management and kick controls', 'Character-data deletion controls', 'Host item distribution tools where available'] },
  { id: 'presentation-operations', title: 'Presentation & Operations', settings: ['Join/server announcements', 'Saved setting templates', 'Leaderboards', 'In-server shop/community-creation features where enabled'] },
  { id: 'advanced-customization', title: 'Advanced Customization', settings: ['Custom weapons, armor, and items', 'Deviation attributes/randomization rules', 'RaidZone / Hyper Brawl controls when supported by the selected scenario'] }
]);

const ONCE_HUMAN_LIFECYCLE_WARNINGS = Object.freeze([
  'Nexus registration is independent of the hosting company. Current Once Human configuration is performed through the official server-management interface exposed to the server owner.',
  'Nexus does not use undocumented private NetEase endpoints for management automation.',
  'Some setting changes apply immediately while others require a server restart.',
  'Switching scenarios can reset server progression and player-character state. Review the official warning shown by the management interface before confirming a scenario change.',
  'Keep invitation codes, admin assignments, and other access-sensitive values out of public Discord fields.'
]);

function onceHumanSetupGuide(server = {}) {
  return {
    ok: true,
    game: 'Once Human',
    provider: String(server.hostingProvider || 'Hosting provider not required'),
    managementMode: 'manual-official-dashboard',
    publicManagementApi: false,
    setupVersion: ONCE_HUMAN_SETUP_VERSION,
    serverId: String(server.id || ''),
    sections: ONCE_HUMAN_SETUP_SECTIONS.map((section) => ({ ...section, settings: [...section.settings] })),
    warnings: [...ONCE_HUMAN_LIFECYCLE_WARNINGS]
  };
}

function palworldSetupGuide(server = {}) {
  return {
    ok: true,
    game: 'Palworld',
    provider: String(server.hostingProvider || 'Hosting provider not required'),
    managementMode: 'palworld-adapters',
    serverId: String(server.id || ''),
    options: [
      {
        id: 'palworld-rest',
        name: 'Palworld REST API',
        description: 'Preferred when the server exposes Palworld REST. Configure host/admin port plus an environment variable containing the AdminPassword. This path is independent of Nitrado, self-hosting, or another provider.'
      },
      {
        id: 'palworld-rcon',
        name: 'Palworld RCON',
        description: 'Use when the server exposes Source RCON. Configure host/admin port plus an environment variable containing the RCON/AdminPassword.'
      },
      {
        id: 'nitrado-api',
        name: 'Nitrado API',
        description: 'Optional hosting-platform telemetry/control for Nitrado servers. Configure the private Nitrado service ID and an environment variable containing the Nitrado API token. This is an adapter, not a requirement for registering the server.'
      },
      {
        id: 'none',
        name: 'Registration only',
        description: 'Keep the server listed in Nexus without live telemetry until a supported connection method is available.'
      }
    ]
  };
}

// Legacy function name retained for compatibility.
function nitradoPalworldSetupGuide(server = {}) { return palworldSetupGuide(server); }

function hostedServerSetupGuide(server = {}) {
  if (server.moduleId === 'oncehuman') return onceHumanSetupGuide(server);
  if (server.moduleId === 'palworld') return palworldSetupGuide(server);
  return { ok: false, code: 'SETUP_NOT_SUPPORTED' };
}

module.exports = {
  ONCE_HUMAN_SETUP_VERSION,
  ONCE_HUMAN_SETUP_SECTIONS,
  ONCE_HUMAN_LIFECYCLE_WARNINGS,
  onceHumanSetupGuide,
  palworldSetupGuide,
  nitradoPalworldSetupGuide,
  hostedServerSetupGuide
};
