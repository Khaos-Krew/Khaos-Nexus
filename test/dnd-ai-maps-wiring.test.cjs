'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  captureAiMapState,
  restoreAiMapState,
  sanitizeAiMapsForExternal
} = require('../main/dnd-ai-map-persistence-extension.cjs');

const root = path.join(__dirname, '..');

test('private AI map proposals survive normalization helpers and are excluded externally', () => {
  const proposal = { id: 'proposal-1', campaignId: 'campaign-1', result: { title: 'Private map' } };
  const captured = captureAiMapState({ aiMapProposals: [proposal] });
  const restored = restoreAiMapState({ campaigns: [] }, captured);
  assert.equal(restored.aiMapProposals.length, 0, 'invalid proposal records are rejected rather than leaked');

  const external = sanitizeAiMapsForExternal({ campaigns: [], aiMapProposals: [proposal], maps: [{ id: 'map-1' }] });
  assert.equal(Object.prototype.hasOwnProperty.call(external, 'aiMapProposals'), false);
  assert.equal(external.maps.length, 1);
});

test('entry installs map storage before AI map persistence and runtime', () => {
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const liveMaps = entry.indexOf("require('./dnd-live-maps-extension.cjs').install()");
  const coDmPersistence = entry.indexOf("require('./dnd-co-dm-persistence-extension.cjs').install()");
  const mapPersistence = entry.indexOf("require('./dnd-ai-map-persistence-extension.cjs').install()");
  const mapRuntime = entry.indexOf("require('./dnd-ai-maps-extension.cjs').install()");
  const mapStability = entry.indexOf("require('./dnd-ai-map-stability-extension.cjs').install()");
  assert.ok(liveMaps >= 0);
  assert.ok(coDmPersistence > liveMaps);
  assert.ok(mapPersistence > coDmPersistence);
  assert.ok(mapRuntime > mapPersistence);
  assert.ok(mapStability > mapRuntime);
});

test('AI map runtime exposes explicit-only actions and never overwrites, reveals, or activates by default', () => {
  const runtime = fs.readFileSync(path.join(root, 'main', 'dnd-ai-maps-extension.cjs'), 'utf8');
  assert.match(runtime, /input\.confirmed !== true/);
  assert.match(runtime, /writeNewAtomic/);
  assert.match(runtime, /flag:\s*['"]wx['"]/);
  assert.match(runtime, /activated:\s*false/);
  assert.match(runtime, /revealed:\s*false/);
  assert.match(runtime, /dnd:ai-map-preview/);
  assert.match(runtime, /dnd:ai-map-generate/);
  assert.match(runtime, /dnd:ai-map-import/);
  assert.doesNotMatch(runtime, /setInterval|post.*Discord|create.*encounter/i);
});

test('renderer requires preview and confirmation and uses image data URLs instead of injecting SVG markup', () => {
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-ai-maps.js'), 'utf8');
  assert.match(renderer, /Preview Exact Request/);
  assert.match(renderer, /Confirm and Generate Private Proposal/);
  assert.match(renderer, /Import as Hidden Campaign Map/);
  assert.match(renderer, /dnd:ai-map-preview/);
  assert.match(renderer, /dnd:ai-map-generate/);
  assert.match(renderer, /dnd:ai-map-import/);
  assert.match(renderer, /data:image\/svg\+xml;base64/);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=\s*proposal\.(?:playerSvg|gmSvg)|setInterval/);
});

test('renderer observation is bounded to the D&D root and stabilized after studio injection', () => {
  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-ai-maps.js'), 'utf8');
  const stability = fs.readFileSync(path.join(root, 'renderer', 'dnd-ai-maps-stability.js'), 'utf8');
  assert.match(renderer, /getElementById\(['"]view-dnd['"]\)/);
  assert.match(renderer, /observer\.observe\(rootNode/);
  assert.doesNotMatch(renderer, /observer\.observe\(doc(?:ument)?\.(?:body|documentElement)/);
  assert.match(stability, /api\.state\.observer\?\.disconnect/);
  assert.match(stability, /!mapsView\.querySelector\('\[data-dnd-ai-map-studio\]'\)/);
  assert.doesNotMatch(stability, /setInterval/);
});
