'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync } = require('node:fs');
const test = require('node:test');
const { DndContentRegistry, CORE_SOURCE_ID, SHATTERED_REALMS_SOURCE_ID } = require('../src/backend/services/dnd-content-registry.cjs');
const { DndDomainService } = require('../src/backend/services/dnd-domain-service.cjs');

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nexus-dnd-'));
  let current = new Date('2026-08-25T12:00:00Z');
  const filePath = path.join(root, 'dnd.json');
  return { root, filePath, service: new DndDomainService({ filePath, now: () => current, randomInt: (min) => min }), setNow(value) { current = new Date(value); } };
}

test('canonical D&D registry keeps open reference and Nexus homebrew provenance separate', () => {
  const registry = new DndContentRegistry();
  const manifest = registry.manifest();
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.sources.find((source) => source.id === CORE_SOURCE_ID)?.enabledByDefault);
  assert.equal(manifest.sources.find((source) => source.id === SHATTERED_REALMS_SOURCE_ID)?.enabledByDefault, false);
  assert.match(manifest.sources[0].provenance, /no protected commercial rules text/i);
  assert.ok(registry.get('class:fighter@1'));
});

test('campaigns, membership, and characters persist with campaign-scoped authorization', async () => {
  const fx = fixture();
  const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Shattered Realms' }, owner);
  await fx.service.invoke('dnd', 'campaigns', { op: 'add-member', campaignId: campaign.id, userId: 'player-1', role: 'player' }, owner);
  const character = await fx.service.invoke('dnd', 'characters', { op: 'create', campaignId: campaign.id, name: 'Aria', speciesId: 'species:human@1', classId: 'class:fighter@1' }, { actorId: 'player-1' });
  assert.equal(character.level, 1);
  assert.rejects(() => fx.service.invoke('dnd', 'characters', { op: 'list', campaignId: campaign.id }, { actorId: 'outsider' }), /membership/i);
  const restarted = new DndDomainService({ filePath: fx.filePath });
  assert.equal((await restarted.invoke('dnd', 'campaigns', { op: 'list' }, owner))[0].id, campaign.id);
});

test('sessions and encounters require campaign DM authority', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Campaign' }, owner);
  await fx.service.invoke('dnd', 'campaigns', { op: 'add-member', campaignId: campaign.id, userId: 'player-1', role: 'player' }, owner);
  await assert.rejects(() => fx.service.invoke('dnd', 'sessions', { op: 'create', campaignId: campaign.id }, { actorId: 'player-1' }), /DM authority/i);
  const encounter = await fx.service.invoke('dnd', 'encounters', { op: 'create', campaignId: campaign.id, name: 'Bridge Ambush' }, owner);
  const initiative = await fx.service.invoke('dnd', 'initiative', { encounterId: encounter.id }, { actorId: 'player-1' });
  assert.equal(initiative.status, 'prepared');
});

test('dice rolls are explicit, bounded, auditable, and restart-safe', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Campaign' }, owner);
  const roll = await fx.service.invoke('dnd', 'dice', { campaignId: campaign.id, count: 2, sides: 20, modifier: 3, reason: 'Perception' }, owner);
  assert.deepEqual(roll.values, [1, 1]);
  assert.equal(roll.total, 5);
  assert.equal(roll.expression, '2d20+3');
  assert.equal(fx.service.state().audit.at(-1).action, 'roll-recorded');
});

test('DM-only campaign records never appear in player collection lists', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Campaign' }, owner);
  await fx.service.invoke('dnd', 'campaigns', { op: 'add-member', campaignId: campaign.id, userId: 'player-1', role: 'player' }, owner);
  await fx.service.invoke('dnd', 'npcs', { op: 'create', campaignId: campaign.id, name: 'Hidden Villain', dmOnly: true }, owner);
  assert.equal((await fx.service.invoke('dnd', 'npcs', { op: 'list', campaignId: campaign.id }, { actorId: 'player-1' })).length, 0);
  assert.equal((await fx.service.invoke('dnd', 'npcs', { op: 'list', campaignId: campaign.id }, owner)).length, 1);
});

test('campaign safety state is explicit and DM-controlled', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Campaign' }, owner);
  const safety = await fx.service.invoke('dnd', 'campaigns', { op: 'safety', campaignId: campaign.id, lines: ['Graphic torture'], veils: ['Romance'], pauseWord: 'Pause' }, owner);
  assert.deepEqual(safety, { lines: ['Graphic torture'], veils: ['Romance'], pauseWord: 'Pause' });
});

test('encounters run a complete ordered turn lifecycle', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const campaign = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Campaign' }, owner);
  let encounter = await fx.service.invoke('dnd', 'encounters', { op: 'create', campaignId: campaign.id, name: 'Ambush' }, owner);
  encounter = await fx.service.invoke('dnd', 'encounters', { op: 'add-combatant', campaignId: campaign.id, encounterId: encounter.id, name: 'Hero', kind: 'player', initiative: 12, hp: 20 }, owner);
  encounter = await fx.service.invoke('dnd', 'encounters', { op: 'add-combatant', campaignId: campaign.id, encounterId: encounter.id, name: 'Bandit', initiative: 18, hp: 8 }, owner);
  encounter = await fx.service.invoke('dnd', 'encounters', { op: 'start', campaignId: campaign.id, encounterId: encounter.id }, owner);
  assert.equal(encounter.combatants[0].name, 'Bandit');
  assert.equal(encounter.round, 1);
  await fx.service.invoke('dnd', 'encounters', { op: 'advance', campaignId: campaign.id, encounterId: encounter.id }, owner);
  encounter = await fx.service.invoke('dnd', 'encounters', { op: 'advance', campaignId: campaign.id, encounterId: encounter.id }, owner);
  assert.equal(encounter.round, 2);
  assert.equal((await fx.service.invoke('dnd', 'encounters', { op: 'complete', campaignId: campaign.id, encounterId: encounter.id }, owner)).status, 'completed');
});

test('campaign export contains only campaign-scoped backup-safe state', async () => {
  const fx = fixture(); const owner = { actorId: 'owner-1' };
  const first = await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'First' }, owner);
  await fx.service.invoke('dnd', 'campaigns', { op: 'create', name: 'Second' }, owner);
  await fx.service.invoke('dnd', 'maps', { op: 'create', campaignId: first.id, name: 'World Map', notes: 'Version one' }, owner);
  const bundle = await fx.service.invoke('dnd', 'export', { campaignId: first.id }, owner);
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.campaign.id, first.id);
  assert.equal(bundle.collections.maps.length, 1);
  assert.equal(bundle.collections.maps[0].campaignId, first.id);
});
