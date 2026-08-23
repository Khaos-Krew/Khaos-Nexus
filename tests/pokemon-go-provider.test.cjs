'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PokemonGoProvider, POGO_ACTIONS } = require('../src/backend/providers/pokemon-go-provider.cjs');
const { getModule } = require('../src/backend/modules/catalog.cjs');
const { nativeProvidersFromConfig } = require('../src/backend/providers/native-providers.cjs');
const { layoutFor } = require('../src/sentinel/module-layouts.cjs');
const { pogoCommand, raidEmbed, panelPayload } = require('../src/sentinel/pokemon-go.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pogo-'));
  return path.join(dir, 'state.json');
}

test('Pokémon GO provider contract matches the module catalog', () => {
  const module = getModule('pokemongo');
  assert.equal(module.console, true);
  assert.deepEqual(new Set(module.capabilities.map((cap) => cap.id)), new Set(POGO_ACTIONS));
  assert.equal(layoutFor('pokemongo').consoleChannel, 'pokemon-go-hub');
});

test('Pokémon GO native provider is enabled by default and persists trainer state', async () => {
  const stateFile = tempFile();
  const providers = nativeProvidersFromConfig({ modules: { pokemongo: { enabled: true, stateFile }, warframe:{enabled:false}, division2:{enabled:false}, idleon:{enabled:false} } });
  const provider = providers.pokemongo;
  assert.equal(provider.providerKind, 'pokemon-go-local');
  assert.equal(provider.connected, true);

  await provider.invoke('profile-set', {
    trainerName: 'NexusTrainer', team: 'mystic', level: 50, friendCode: '1234 5678 9012', vivillonRegion: 'polar', raidStyle: 'both'
  }, { actorId: '100000000000000001', role: 'viewer' });

  const reloaded = new PokemonGoProvider({ stateFile });
  const result = await reloaded.invoke('profile', {}, { actorId: '100000000000000001', role: 'viewer' });
  assert.equal(result.profile.trainerName, 'NexusTrainer');
  assert.equal(result.profile.friendCode, '123456789012');
  assert.equal(result.profile.vivillonRegion, 'polar');
});

test('raid creation and RSVP are identity-scoped and update attendance', async () => {
  const provider = new PokemonGoProvider({ stateFile: tempFile() });
  const raid = await provider.invoke('raid-create', {
    boss: 'Rayquaza', battleType: 'raid', location: 'Town Park', remoteAllowed: true
  }, { actorId: '100000000000000001', role: 'viewer' });
  assert.deepEqual(raid.attendees.local, ['100000000000000001']);

  const updated = await provider.invoke('raid-rsvp', { id: raid.id, status: 'remote' }, { actorId: '100000000000000002', role: 'viewer' });
  assert.deepEqual(updated.attendees.remote, ['100000000000000002']);
  assert.match(raidEmbed(updated).footer.text, new RegExp(raid.id));
});

test('trade matcher finds a wanted Pokémon offered by another trainer', async () => {
  const provider = new PokemonGoProvider({ stateFile: tempFile() });
  await provider.invoke('profile-set', { trainerName:'One' }, { actorId:'100000000000000001', role:'viewer' });
  await provider.invoke('profile-set', { trainerName:'Two' }, { actorId:'100000000000000002', role:'viewer' });
  await provider.invoke('trade-add', { kind:'want', pokemon:'Rayquaza' }, { actorId:'100000000000000001', role:'viewer' });
  await provider.invoke('trade-add', { kind:'offer', pokemon:'Rayquaza' }, { actorId:'100000000000000002', role:'viewer' });
  const result = await provider.invoke('trade-matches', {}, { actorId:'100000000000000001', role:'viewer' });
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].trainer.trainerName, 'Two');
});

test('counter helper computes weaknesses without accessing a Pokémon GO account', async () => {
  const provider = new PokemonGoProvider({ stateFile: tempFile() });
  const result = await provider.invoke('counter', { boss:'Rayquaza', types:'dragon,flying' }, { actorId:'100000000000000001', role:'viewer' });
  assert.equal(result.types.includes('dragon'), true);
  assert.equal(result.types.includes('flying'), true);
  assert.equal(result.weaknesses.some((item) => item.type === 'ice' && item.doublePressure), true);
});

test('/pogo command and operations panel expose the coordination surface', () => {
  const json = pogoCommand().toJSON();
  assert.equal(json.name, 'pogo');
  assert.ok(json.options.some((option) => option.name === 'raid'));
  assert.ok(json.options.some((option) => option.name === 'trade'));
  assert.ok(json.options.some((option) => option.name === 'vivillon'));
  const panel = panelPayload();
  assert.match(panel.embeds[0].title, /POKÉMON GO/);
  assert.equal(panel.components[0].components.length, 5);
});
