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
  'Nexus registration only distinguishes Self-Hosted from Hosted Site; the hosting company is not part of the server identity.',
  'Current Once Human configuration is performed through the official server-management interface exposed to the server owner.',
  'Nexus does not use undocumented private NetEase endpoints for management automation.',
  'Some setting changes apply immediately while others require a server restart.',
  'Switching scenarios can reset server progression and player-character state. Review the official warning shown by the management interface before confirming a scenario change.',
  'Keep invitation codes, admin assignments, and other access-sensitive values out of public Discord fields.'
]);

function onceHumanSetupGuide(server = {}) {
  return {
    ok: true,
    game: 'Once Human',
    hostingType: String(server.hostingType || 'hosted-site'),
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
    hostingType: String(server.hostingType || 'hosted-site'),
    managementMode: 'palworld-adapters',
    serverId: String(server.id || ''),
    options: [
      {
        id: 'rest',
        name: 'REST API',
        description: 'Use when the Palworld server exposes its REST API. Configure the private host/admin port and an environment variable containing the AdminPassword. This works whether the server is Self-Hosted or on a Hosted Site.'
      },
      {
        id: 'rcon',
        name: 'RCON',
        description: 'Use when the Palworld server exposes Source RCON. Configure the private host/admin port and an environment variable containing the RCON/AdminPassword.'
      },
      {
        id: 'none',
        name: 'No live connection',
        description: 'Keep the server registered without live telemetry until REST or RCON is available.'
      }
    ]
  };
}

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
