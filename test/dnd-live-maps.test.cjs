'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  ensureMapCollections,
  normalizeMap,
  normalizeMarker,
  saveMap,
  saveMarker,
  removeMarker,
  playerSafeMapState,
  generateMapSvg,
  inspectUploadedImage
} = require('../shared/dnd-live-maps.cjs');
const { validateGenerationDraft, validateMarkerDraft, normalizedPosition } = require('../renderer/dnd-live-maps.js');

function png(width = 800, height = 600) {
  const buffer = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(13, 8); Buffer.from('IHDR').copy(buffer, 12);
  buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('map state is additive and preserves existing campaign collections', () => {
  const state = { campaigns: [{ id: 'c1' }], npcs: [{ id: 'n1' }] };
  ensureMapCollections(state);
  assert.deepEqual(state.campaigns, [{ id: 'c1' }]);
  assert.deepEqual(state.npcs, [{ id: 'n1' }]);
  assert.deepEqual(state.maps, []);
  assert.deepEqual(state.mapMarkers, []);
});

test('local generation is deterministic for identical settings and distinct for different seeds', () => {
  const input = { mode: 'dungeon', width: 1200, height: 800, gridType: 'square', gridSize: 50, seed: 'same-seed', theme: 'dark-fantasy' };
  const first = generateMapSvg(input);
  const second = generateMapSvg(input);
  const changed = generateMapSvg({ ...input, seed: 'other-seed' });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.svg, second.svg);
  assert.notEqual(first.sha256, changed.sha256);
  assert.match(first.svg, /data-mode="dungeon"/);
  assert.match(first.svg, /class="room"/);
});

test('blank, overworld, and dungeon generation remain local SVG assets', () => {
  for (const mode of ['blank_grid', 'overworld', 'dungeon']) {
    const value = generateMapSvg({ mode, width: 640, height: 480, seed: 'fixed' });
    assert.equal(value.mimeType, 'image/svg+xml');
    assert.match(value.buffer.subarray(0, 50).toString('utf8'), /^<svg/);
    assert.ok(value.bytes < 10 * 1024 * 1024);
  }
});

test('uploaded maps require supported raster signatures and safe dimensions', () => {
  assert.deepEqual(inspectUploadedImage(png()), { mimeType: 'image/png', width: 800, height: 600, bytes: 32, sha256: require('node:crypto').createHash('sha256').update(png()).digest('hex') });
  assert.throws(() => inspectUploadedImage(Buffer.from('<svg></svg>')), (error) => error.code === 'DND_MAP_UPLOAD_SIGNATURE');
  assert.throws(() => inspectUploadedImage(png(64, 64)), (error) => error.code === 'DND_MAP_DIMENSIONS_INVALID');
  assert.throws(() => inspectUploadedImage(png(9000, 600)), (error) => error.code === 'DND_MAP_DIMENSIONS_INVALID');
});

test('map activation is unique per campaign and revisions are retained', () => {
  const state = {};
  const first = saveMap(state, { campaignId: 'c1', name: 'First', mimeType: 'image/svg+xml', width: 800, height: 600, active: true });
  const second = saveMap(state, { campaignId: 'c1', name: 'Second', mimeType: 'image/svg+xml', width: 800, height: 600, active: true });
  assert.equal(state.maps.find((item) => item.id === first.id).active, false);
  assert.equal(state.maps.find((item) => item.id === second.id).active, true);
  assert.equal(state.mapRevisions.length, 2);
});

test('party markers are unique per map and update in place', () => {
  const state = {};
  const first = saveMarker(state, { campaignId: 'c1', mapId: 'm1', markerType: 'party', label: 'Party', x: .1, y: .2 });
  const second = saveMarker(state, { campaignId: 'c1', mapId: 'm1', markerType: 'party', label: 'New Party Position', x: .8, y: .7 });
  assert.equal(state.mapMarkers.length, 1);
  assert.equal(first.id, second.id);
  assert.equal(state.mapMarkers[0].x, .8);
  assert.equal(state.mapMarkers[0].label, 'New Party Position');
});

test('marker coordinates clamp and removal is explicit', () => {
  const state = {};
  const marker = saveMarker(state, { campaignId: 'c1', mapId: 'm1', markerType: 'note', label: 'Edge', x: -5, y: 9 });
  assert.equal(marker.x, 0);
  assert.equal(marker.y, 1);
  assert.equal(removeMarker(state, marker.id).id, marker.id);
  assert.throws(() => removeMarker(state, marker.id), /not found/);
});

test('player-safe maps omit hidden map and marker GM notes', () => {
  const state = {};
  const map = saveMap(state, { campaignId: 'c1', name: 'World', mimeType: 'image/svg+xml', width: 800, height: 600, revealed: true });
  saveMarker(state, { campaignId: 'c1', mapId: map.id, markerType: 'location', label: 'Town', publicDescription: 'Safe haven', gmNotes: 'Secret cult', visible: true });
  saveMarker(state, { campaignId: 'c1', mapId: map.id, markerType: 'npc', label: 'Hidden villain', gmNotes: 'Boss', visible: false });
  const safe = playerSafeMapState(state, 'c1', map.id);
  assert.equal(safe.markers.length, 1);
  assert.equal(safe.markers[0].label, 'Town');
  assert.equal(safe.markers[0].gmNotes, undefined);
  state.maps[0].revealed = false;
  assert.equal(playerSafeMapState(state, 'c1', map.id).map, null);
});

test('renderer validation enforces map dimensions, marker labels, and normalized positions', () => {
  const draft = validateGenerationDraft({ campaignId: 'c1', name: 'Dungeon', mode: 'dungeon', width: 1000, height: 700, gridType: 'hex', seed: 'abc' });
  assert.equal(draft.mode, 'dungeon');
  assert.equal(draft.gridType, 'hex');
  assert.throws(() => validateGenerationDraft({ campaignId: 'c1', name: 'Bad', width: 9000, height: 700 }), /dimensions/);
  const marker = validateMarkerDraft({ campaignId: 'c1', mapId: 'm1', label: 'Boss', markerType: 'npc', x: 2, y: -1 });
  assert.equal(marker.x, 1); assert.equal(marker.y, 0);
  assert.throws(() => validateMarkerDraft({ campaignId: 'c1', mapId: 'm1', label: '' }), /label/);
  const position = normalizedPosition(50, 25, { left: 0, top: 0, width: 100, height: 50 }, { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual(position, { x: .5, y: .5 });
});

test('production wiring includes protected storage, Owner IPC, Maps tab, dragging, links and snapshot export', () => {
  const entry = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const extension = fs.readFileSync(require.resolve('../main/dnd-live-maps-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer/dnd-live-maps.js'), 'utf8');
  assert.ok(entry.indexOf('dnd-world-content-extension') < entry.indexOf('dnd-live-maps-extension'));
  assert.ok(entry.indexOf('dnd-live-maps-extension') < entry.indexOf('dnd-access-policy-extension'));
  for (const channel of ['dnd:maps-get','dnd:map-upload','dnd:map-generate','dnd:map-save','dnd:map-marker-save','dnd:map-marker-remove','dnd:map-export']) assert.ok(extension.includes(channel));
  assert.match(extension, /safeInside/);
  assert.match(extension, /isSymbolicLink/);
  assert.match(extension, /inspectUploadedImage/);
  assert.match(renderer, /data-dnd-map-tab/);
  assert.match(renderer, /Upload Map/);
  assert.match(renderer, /Generate Map/);
  assert.match(renderer, /pointermove/);
  assert.match(renderer, /Export PNG/);
  assert.match(renderer, /characters: clone/);
});
