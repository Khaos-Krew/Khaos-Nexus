'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MODULES, getModule } = require('../src/backend/modules/catalog.cjs');
const { WARFRAME_ACTIONS } = require('../src/backend/providers/warframe-provider.cjs');
const { DIVISION2_ACTIONS } = require('../src/backend/providers/division2-provider.cjs');
const { IDLEON_ACTIONS } = require('../src/backend/providers/idleon-provider.cjs');
const { BASE_ACTIONS: PALWORLD_ACTIONS } = require('../src/backend/providers/palworld-provider.cjs');
const { RUST_ACTIONS } = require('../src/backend/providers/rust-provider.cjs');
const { BASE_ACTIONS: SATISFACTORY_ACTIONS } = require('../src/backend/providers/satisfactory-provider.cjs');
const { renderModuleConsole, buttonCapabilities } = require('../src/sentinel/module-console.cjs');

function ids(moduleId, includeServices = true) {
  return getModule(moduleId).capabilities
    .filter((capability) => includeServices || !capability.service)
    .map((capability) => capability.id);
}

function assertProviderSubset(moduleId, actions) {
  const registered = new Set(ids(moduleId, false));
  for (const action of actions) assert.equal(registered.has(action), true, `${moduleId} provider action ${action} must exist in the catalog`);
}

test('every module capability id is unique within its module', () => {
  for (const module of MODULES) {
    const capabilityIds = module.capabilities.map((capability) => capability.id);
    assert.equal(new Set(capabilityIds).size, capabilityIds.length, `${module.id} has duplicate capability ids`);
  }
});

test('complete native companion providers match their catalog contracts', () => {
  assert.deepEqual(new Set(WARFRAME_ACTIONS), new Set(ids('warframe', false)));
  assert.deepEqual(new Set(DIVISION2_ACTIONS), new Set(ids('division2', false)));
  assert.deepEqual(new Set(IDLEON_ACTIONS), new Set(ids('idleon', false)));
});

test('server provider actions are registered in their module catalogs', () => {
  assertProviderSubset('palworld', PALWORLD_ACTIONS);
  assertProviderSubset('rust', RUST_ACTIONS);
  assertProviderSubset('satisfactory', SATISFACTORY_ACTIONS);
});

test('parameterized actions do not consume quick-button slots', () => {
  const module = getModule('warframe');
  assert.equal(buttonCapabilities(module).some((capability) => capability.id === 'market'), false);
  assert.equal(buttonCapabilities(module).some((capability) => capability.id === 'builds'), false);
  const payload = renderModuleConsole('warframe', {
    enabled: true,
    configured: true,
    connected: false,
    providerKind: 'public-data',
    availableActions: ids('warframe'),
    providerAvailableActions: ids('warframe'),
    serviceAvailableActions: []
  });
  const customIds = payload.components.flatMap((row) => row.components || []).map((component) => component.custom_id).filter(Boolean);
  assert.equal(customIds.includes('nexusmod:warframe:market'), false);
  assert.equal(customIds.includes('nexusmod:warframe:builds'), false);
  assert.equal(customIds.includes('nexusmod:warframe:help'), true);
});

test('module console distinguishes shared services from provider readiness', () => {
  const payload = renderModuleConsole('ark', {
    enabled: true,
    configured: false,
    connected: false,
    providerKind: 'none',
    availableActions: ['schedule-list', 'schedule-add', 'schedule-remove'],
    providerAvailableActions: [],
    serviceAvailableActions: ['schedule-list', 'schedule-add', 'schedule-remove']
  });
  assert.match(payload.embeds[0].description, /PROVIDER SETUP NEEDED/);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Shared Services'), true);
});
