'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MIGRATION_STEPS, MODULE_CATALOG, defaultModuleStates, mergeModuleStates, moduleVisibleForRole, moduleProgress, summarizeMigration, validateCatalog, getModule } = require('../shared/module-catalog.cjs');

test('module catalog is structurally valid and IDs are unique', () => {
  assert.equal(validateCatalog(), true);
  assert.equal(new Set(MODULE_CATALOG.map((module) => module.id)).size, MODULE_CATALOG.length);
  assert.ok(MODULE_CATALOG.length >= 30);
});

test('module catalog does not ship the retired platform name', () => {
  assert.equal(/lovable/i.test(JSON.stringify(MODULE_CATALOG)), false);
});

test('private DnD workspace is owner-hidden', () => {
  const dnd = getModule('dnd-workspace');
  assert.equal(dnd.hidden, true);
  assert.equal(dnd.requiredRole, 'owner');
  assert.equal(moduleVisibleForRole(dnd, 'viewer'), false);
  assert.equal(moduleVisibleForRole(dnd, 'operator'), false);
  assert.equal(moduleVisibleForRole(dnd, 'owner'), true);
  assert.equal(moduleVisibleForRole(dnd, 'local-admin'), true);
});

test('website route inventory is represented by desktop modules', () => {
  const routes = new Set(MODULE_CATALOG.flatMap((module) => module.sourceRoutes || []));
  for (const route of ['/server-control', '/module-embeds', '/admin/discord-role-menus', '/communities', '/events', '/warframe', '/palworld', '/idleon/import', '/streamer', '/wallpapers', '/support', '/admin/audit-log', '/dnd']) {
    assert.equal(routes.has(route), true, `Missing route inventory for ${route}`);
  }
});

test('default states preserve legacy module choices', () => {
  const states = defaultModuleStates({ embedStudio: true, warframeCompanion: true });
  assert.equal(states['embed-studio'].enabled, true);
  assert.equal(states['warframe-companion'].enabled, true);
  assert.equal(states['discord-runtime'].enabled, true);
  assert.equal(states['dnd-workspace'].enabled, false);
});

test('state merging sanitizes unknown steps and long notes', () => {
  const states = mergeModuleStates({ 'embed-studio': { enabled: true, completedSteps: ['inventory', 'unknown', 'inventory'], notes: 'x'.repeat(3000), updatedAt: '2026-07-23T00:00:00.000Z' } });
  assert.deepEqual(states['embed-studio'].completedSteps, ['inventory']);
  assert.equal(states['embed-studio'].notes.length, 2000);
  assert.equal(states['embed-studio'].enabled, true);
});

test('progress and summary use the six migration gates', () => {
  const states = defaultModuleStates();
  states['embed-studio'].completedSteps = MIGRATION_STEPS.slice(0, 3).map((step) => step.id);
  assert.equal(moduleProgress(states['embed-studio']), 50);
  const viewer = summarizeMigration(states, 'viewer');
  const owner = summarizeMigration(states, 'owner');
  assert.ok(owner.total > viewer.total);
  assert.ok(owner.overallProgress >= 0 && owner.overallProgress <= 100);
  assert.equal(owner.byStage.private, 1);
});
