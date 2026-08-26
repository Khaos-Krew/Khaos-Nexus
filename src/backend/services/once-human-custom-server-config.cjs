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
  'NetEase Custom Server configuration is applied through the official in-game/web management dashboard; Nexus does not use undocumented private endpoints.',
  'Some setting changes apply immediately while others require a server restart.',
  'Switching scenarios can reset server progression and player-character state. Review the NetEase warning shown by the dashboard before confirming a scenario change.',
  'Keep invitation codes, admin assignments, and other access-sensitive values out of public Discord fields.'
]);

function onceHumanSetupGuide(server = {}) {
  return {
    ok: true,
    game: 'Once Human',
    provider: 'NetEase Custom Server',
    managementMode: 'manual-official-dashboard',
    publicManagementApi: false,
    setupVersion: ONCE_HUMAN_SETUP_VERSION,
    serverId: String(server.id || ''),
    sections: ONCE_HUMAN_SETUP_SECTIONS.map((section) => ({ ...section, settings: [...section.settings] })),
    warnings: [...ONCE_HUMAN_LIFECYCLE_WARNINGS]
  };
}

function nitradoPalworldSetupGuide(server = {}) {
  return {
    ok: true,
    game: 'Palworld',
    provider: 'Nitrado',
    managementMode: 'nitrado-rest',
    publicManagementApi: true,
    serverId: String(server.id || ''),
    requirements: [
      'Set provider to nitrado-palworld.',
      'Set provider_ref to the Nitrado service ID.',
      'Store the Nitrado API token in Railway and set credential_env to that environment-variable name. Never paste the token into Discord.',
      'Use /server status to validate the Nitrado connection and /server refresh to update #game-servers.',
      'Direct Palworld REST remains available as the palworld-rest provider when you intentionally expose/configure the game REST endpoint.'
    ]
  };
}

function hostedServerSetupGuide(server = {}) {
  if (server.moduleId === 'oncehuman') return onceHumanSetupGuide(server);
  if (server.moduleId === 'palworld') return nitradoPalworldSetupGuide(server);
  return { ok: false, code: 'SETUP_NOT_SUPPORTED' };
}

module.exports = {
  ONCE_HUMAN_SETUP_VERSION,
  ONCE_HUMAN_SETUP_SECTIONS,
  ONCE_HUMAN_LIFECYCLE_WARNINGS,
  onceHumanSetupGuide,
  nitradoPalworldSetupGuide,
  hostedServerSetupGuide
};
