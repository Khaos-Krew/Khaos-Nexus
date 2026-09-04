'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../src/sentinel/arn-parser-runtime-patch.cjs');
const { parseShinyDiscordPayload } = require('../src/sentinel/arn-live-board-extension.cjs');

test('parses current plain-text Shiny markdown detection from production', () => {
  const event = parseShinyDiscordPayload({
    content: '**Jungle Dodo** detected on **Astraeos** at **Lat 38 / Lon 20**.'
  }, 'Astraeos');

  assert.deepEqual(event && {
    lifecycle: event.lifecycle,
    dinoName: event.dinoName,
    mapName: event.mapName,
    lat: event.lat,
    lon: event.lon
  }, {
    lifecycle: 'ACTIVE',
    dinoName: 'Jungle Dodo',
    mapName: 'Astraeos',
    lat: 38,
    lon: 20
  });
});

test('parses current Genesis plain-text markdown detection from production', () => {
  const event = parseShinyDiscordPayload({
    content: '**Colossal Brimstone X-Xiphactinus** detected on **Genesis** at **Lat 56 / Lon 86**.'
  }, 'Genesis 1');

  assert.equal(event.lifecycle, 'ACTIVE');
  assert.equal(event.dinoName, 'Colossal Brimstone X-Xiphactinus');
  assert.equal(event.mapName, 'Genesis 1');
  assert.equal(event.lat, 56);
  assert.equal(event.lon, 86);
});
