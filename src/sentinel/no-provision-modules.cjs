'use strict';

// Owner-approved game cleanup (2026-10-01): SENTINEL OPS deleted these game
// categories/channels from Discord but kept every game role. Sentinal must not
// recreate the categories or channels from any provisioning path (/nexus setup,
// /nexus repair, /nexus repair-all, admin HTTP /v1/repair and
// /v1/channels/reconcile, role-menu auto-provision, module auto-provision).
//
// This list is checked independently of `config.modules[id].enabled` (repair-all
// ignores enabled flags). It only gates channel/category provisioning: access
// roles and the self-role menu still include these games.
//
// To rebuild a game later, remove its key here (and redeploy), then run
// `/nexus repair module:<id>`.
const NO_PROVISION_CHANNEL_MODULES = Object.freeze({
  '7daystodie': '7 Days to Die',
  conanexiles: 'Conan Exiles',
  oncehuman: 'Once Human',
  idleon: 'Legends of IdleOn',
  osrs: 'Old School RuneScape',
  runescape3: 'RuneScape 3',
  rust: 'Rust',
  satisfactory: 'Satisfactory',
  dnd: 'Nexus D&D',
  callofduty: 'Call of Duty',
  deadbydaylight: 'Dead by Daylight'
});
const NO_PROVISION_CHANNEL_MODULE_IDS = Object.freeze(new Set(Object.keys(NO_PROVISION_CHANNEL_MODULES)));
const MODULE_CHANNELS_NOT_PROVISIONED = 'MODULE_CHANNELS_NOT_PROVISIONED';

function normalizeModuleId(value) {
  return String(value || '').trim().toLowerCase();
}

function isNoProvisionChannelModule(moduleId) {
  return NO_PROVISION_CHANNEL_MODULE_IDS.has(normalizeModuleId(moduleId));
}

class ModuleChannelsNotProvisionedError extends Error {
  constructor(moduleId) {
    const id = normalizeModuleId(moduleId);
    const name = NO_PROVISION_CHANNEL_MODULES[id] || id;
    super(`${name} channels are not provisioned: the category was removed by owner-approved cleanup (2026-10-01). Game roles stay available.`);
    this.name = 'ModuleChannelsNotProvisionedError';
    this.code = MODULE_CHANNELS_NOT_PROVISIONED;
    this.moduleId = id;
  }
}

function assertModuleChannelsProvisionable(moduleId) {
  if (isNoProvisionChannelModule(moduleId)) throw new ModuleChannelsNotProvisionedError(moduleId);
}

function isModuleChannelsNotProvisionedError(error) {
  return error?.code === MODULE_CHANNELS_NOT_PROVISIONED;
}

module.exports = {
  NO_PROVISION_CHANNEL_MODULES,
  NO_PROVISION_CHANNEL_MODULE_IDS,
  MODULE_CHANNELS_NOT_PROVISIONED,
  ModuleChannelsNotProvisionedError,
  isNoProvisionChannelModule,
  assertModuleChannelsProvisionable,
  isModuleChannelsNotProvisionedError
};
