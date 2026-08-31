'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validIngestToken, parseShinyWebhook, announcement } = require('../src/sentinel/ark-shiny-anomaly.cjs');
const { createSentinalAdminServer } = require('../src/sentinel/admin-server.cjs');

test('official Shiny configuration targets 3-5 active creatures and withholds coordinates', () => {
  const ini = fs.readFileSync(path.resolve(__dirname, '../config/ark/shiny/shiny-nexus-balanced.ini'), 'utf8');
  assert.match(ini, /^\[Shiny\]$/m);
  assert.match(ini, /^MaxNumShinies=4$/m);
  assert.match(ini, /^DisableNotificationCoordinates=True$/m);
  assert.match(ini, /^DisableTrackerCoordinates=True$/m);
  assert.match(ini, /^DisableDinoTracking=True$/m);
  assert.match(ini, /^UnlockTekOnKill=False$/m);
  assert.match(ini, /^NoActiveDuplicateDinos=True$/m);
  assert.match(ini, /^PatternSpawn=NEXUS\|ACTIVE\|\[Dino\]\|\[Location\]\|\[ServerName\]\|\[MapName\]$/m);
  assert.doesNotMatch(ini, /\[Lat\]|\[Lon\]/);
});

test('webhook parser produces bounded lifecycle events without accepting coordinates', () => {
  const active = parseShinyWebhook({ content: 'NEXUS|ACTIVE|Shiny Rex|Volcano|Genesis One|Genesis Part 1' });
  assert.deepEqual({ state: active.state, dino: active.dinoName, region: active.regionName, map: active.mapName }, { state: 'ACTIVE', dino: 'Shiny Rex', region: 'Volcano', map: 'Genesis Part 1' });
  const tamed = parseShinyWebhook({ embeds: [{ description: 'NEXUS|TAMED|Shiny Rex|Survivor|Genesis One|Genesis Part 1' }] });
  assert.equal(tamed.state, 'TAMED'); assert.equal(tamed.playerName, 'Survivor'); assert.equal(tamed.correlationKey, active.correlationKey);
  assert.throws(() => parseShinyWebhook({ content: 'NEXUS|ACTIVE|Shiny Rex|Lat 12 Lon 34|Genesis One|Genesis Part 1' }), /Coordinate-bearing/);
  assert.throws(() => parseShinyWebhook({ content: 'ordinary Discord message' }), /marker/);
});

test('public anomaly announcements never contain exact coordinates', () => {
  const event = parseShinyWebhook({ content: 'NEXUS|ACTIVE|Shiny Rex|Volcano|Genesis One|Genesis Part 1' });
  const message = announcement(event, { state: 'ACTIVE' });
  assert.match(message, /Coordinates are intentionally withheld/);
  assert.doesNotMatch(message, /latitude|longitude|\d+\.\d+/i);
});

test('Shiny ingest token is strong and constant-length checked', () => {
  const expected = 's'.repeat(40);
  assert.equal(validIngestToken(expected, expected), true);
  assert.equal(validIngestToken('s'.repeat(39), expected), false);
  assert.equal(validIngestToken('short', 'short'), false);
});

test('dedicated Shiny webhook route does not grant general admin scope', async (t) => {
  const calls = [];
  const server = createSentinalAdminServer({ host: '127.0.0.1', port: 0, token: 'a'.repeat(40), shinyWebhookHandler: async (input) => { calls.push(input); return { status: 202, body: { ok: true } }; } });
  await server.start(); t.after(() => server.stop());
  const port = server.server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/v1/ark/shiny-events/${'b'.repeat(40)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'NEXUS|ACTIVE|Rex|Volcano|Gen1|Genesis Part 1' }) });
  assert.equal(response.status, 202); assert.equal(calls.length, 1); assert.equal(calls[0].token, 'b'.repeat(40));
  const admin = await fetch(`http://127.0.0.1:${port}/v1/status`);
  assert.equal(admin.status, 401);
});
