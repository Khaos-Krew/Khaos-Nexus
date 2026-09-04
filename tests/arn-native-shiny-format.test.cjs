'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseShinyDiscordPayload,
  lifecycleFromText,
  cleanDinoName,
  coordinatesFromText
} = require('../src/sentinel/arn-live-board-extension.cjs');

test('recognizes native Shiny spawn lifecycle wording', () => {
  assert.equal(lifecycleFromText('A Shiny Dino has spawned!', '**Filthy Pastel Dodo** has spawned at **Lat 38 Lon 90**!'), 'ACTIVE');
});

test('parses native Shiny embed spawn payload and strips markdown', () => {
  const event = parseShinyDiscordPayload({
    embeds: [{
      title: 'A Shiny Dino has spawned!',
      description: '**Filthy Pastel Dodo** has spawned at **Lat 38 Lon 90**!',
      footer: { text: 'Khaos Nexus (Astraeos)' }
    }]
  }, 'Astraeos');
  assert.deepEqual(event && {
    lifecycle: event.lifecycle,
    dinoName: event.dinoName,
    mapName: event.mapName,
    lat: event.lat,
    lon: event.lon
  }, {
    lifecycle: 'ACTIVE',
    dinoName: 'Filthy Pastel Dodo',
    mapName: 'Astraeos',
    lat: 38,
    lon: 90
  });
});

test('parses plain-text native Shiny spawn payload', () => {
  const event = parseShinyDiscordPayload({
    content: '**Motley S-Direwolf** has spawned at Lat 12.5 Lon 44.25!'
  }, 'Genesis 1');
  assert.equal(event.lifecycle, 'ACTIVE');
  assert.equal(event.dinoName, 'Motley S-Direwolf');
  assert.equal(event.mapName, 'Genesis 1');
  assert.equal(event.lat, 12.5);
  assert.equal(event.lon, 44.25);
});

test('native despawn and tame names normalize to same identity form', () => {
  const despawn = parseShinyDiscordPayload({ content: '**Filthy Pastel Dodo** has despawned and will be missed!' }, 'Astraeos');
  const tamed = parseShinyDiscordPayload({ content: '**Filthy Pastel Dodo** has been tamed by Player!' }, 'Astraeos');
  assert.equal(despawn.dinoName, 'Filthy Pastel Dodo');
  assert.equal(tamed.dinoName, 'Filthy Pastel Dodo');
  assert.equal(despawn.lifecycle, 'SIGNAL_LOST');
  assert.equal(tamed.lifecycle, 'CAPTURED');
});

test('coordinate parser tolerates slash, comma, spaces and markdown', () => {
  assert.deepEqual(coordinatesFromText('**Lat 38 / Lon 90**'), { lat: 38, lon: 90 });
  assert.deepEqual(coordinatesFromText('Lat 38, Lon 90'), { lat: 38, lon: 90 });
  assert.deepEqual(coordinatesFromText('Lat 38 Lon 90'), { lat: 38, lon: 90 });
});

test('cleanDinoName removes Discord wrapper markdown only', () => {
  assert.equal(cleanDinoName('**Enraged Rex**'), 'Enraged Rex');
  assert.equal(cleanDinoName('__Rainbow Manta__'), 'Rainbow Manta');
});
