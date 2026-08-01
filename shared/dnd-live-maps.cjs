'use strict';

const crypto = require('node:crypto');
const { clean, clone, id, nowIso } = require('./dnd-discord.cjs');

const MAP_UPLOAD_MIME = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
const MAP_STORAGE_MIME = Object.freeze([...MAP_UPLOAD_MIME, 'image/svg+xml']);
const MAP_GRID_TYPES = Object.freeze(['none', 'square', 'hex']);
const MAP_GENERATION_MODES = Object.freeze(['blank_grid', 'overworld', 'dungeon']);
const MAP_MARKER_TYPES = Object.freeze(['party', 'character', 'npc', 'location', 'encounter', 'quest', 'loot', 'note', 'custom']);
const MAP_MAX_BYTES = 10 * 1024 * 1024;
const MAP_MAX_DIMENSION = 8192;
const MAP_MIN_DIMENSION = 128;

function ensureMapCollections(state) {
  if (!Array.isArray(state.maps)) state.maps = [];
  if (!Array.isArray(state.mapMarkers)) state.mapMarkers = [];
  if (!Array.isArray(state.mapRevisions)) state.mapRevisions = [];
  return state;
}
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function integer(value, fallback = 0) { return Math.trunc(number(value, fallback)); }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, number(value, minimum))); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function fail(message, code, field = '') { const error = new Error(message); error.code = code; if (field) error.field = field; return error; }
function safeName(value, fallback = 'campaign-map') {
  return clean(value || fallback, 120).replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || fallback;
}

function normalizeMap(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  const name = clean(input.name, 180);
  if (!campaignId) throw fail('Map campaign is required.', 'DND_MAP_CAMPAIGN_REQUIRED', 'campaignId');
  if (!name) throw fail('Map name is required.', 'DND_MAP_NAME_REQUIRED', 'name');
  const mimeType = clean(input.mimeType || 'image/svg+xml', 100).toLowerCase();
  if (!MAP_STORAGE_MIME.includes(mimeType)) throw fail('Map image type is unsupported.', 'DND_MAP_MIME_INVALID', 'mimeType');
  const width = integer(input.width, 1920);
  const height = integer(input.height, 1080);
  if (width < MAP_MIN_DIMENSION || height < MAP_MIN_DIMENSION || width > MAP_MAX_DIMENSION || height > MAP_MAX_DIMENSION) throw fail('Map dimensions are outside the supported range.', 'DND_MAP_DIMENSIONS_INVALID');
  const gridType = MAP_GRID_TYPES.includes(input.gridType) ? input.gridType : 'none';
  const gridSize = Math.max(8, Math.min(512, integer(input.gridSize, 64)));
  const sourceType = input.sourceType === 'uploaded' ? 'uploaded' : 'generated';
  const generationMode = MAP_GENERATION_MODES.includes(input.generationMode) ? input.generationMode : '';
  return {
    id: clean(input.id, 100) || id('map'), campaignId, name, sourceType,
    fileName: clean(input.fileName || `${safeName(name)}.${mimeType === 'image/svg+xml' ? 'svg' : mimeType.split('/')[1]}`, 180),
    mimeType, bytes: Math.max(0, integer(input.bytes)), sha256: clean(input.sha256, 64).toLowerCase(),
    width, height, gridType, gridSize, scaleLabel: clean(input.scaleLabel, 120),
    seed: clean(input.seed, 160), generationMode, theme: clean(input.theme || 'dark-fantasy', 80),
    active: Boolean(input.active), revealed: Boolean(input.revealed), archived: Boolean(input.archived),
    relativePath: clean(input.relativePath, 500),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : {},
    createdBy: clean(input.createdBy, 100), updatedBy: clean(input.updatedBy, 100),
    createdAt: input.createdAt || nowIso(), updatedAt: nowIso()
  };
}

function normalizeMarker(input = {}) {
  const campaignId = clean(input.campaignId, 100);
  const mapId = clean(input.mapId, 100);
  const markerType = MAP_MARKER_TYPES.includes(input.markerType) ? input.markerType : 'custom';
  const label = clean(input.label, 160);
  if (!campaignId || !mapId) throw fail('Marker campaign and map are required.', 'DND_MAP_MARKER_PARENT_REQUIRED');
  if (!label) throw fail('Marker label is required.', 'DND_MAP_MARKER_LABEL_REQUIRED', 'label');
  return {
    id: clean(input.id, 100) || id('marker'), campaignId, mapId, markerType,
    linkedId: clean(input.linkedId, 100), label,
    publicDescription: clean(input.publicDescription, 2000), gmNotes: clean(input.gmNotes, 5000),
    x: clamp(input.x, 0, 1), y: clamp(input.y, 0, 1),
    visible: input.visible !== false, locked: Boolean(input.locked),
    icon: clean(input.icon, 30), color: clean(input.color, 30),
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? clone(input.metadata) : {},
    createdAt: input.createdAt || nowIso(), updatedAt: nowIso()
  };
}

function saveMap(state, input = {}) {
  ensureMapCollections(state);
  const existing = input.id ? state.maps.find((item) => item.id === input.id) : null;
  const map = normalizeMap({ ...existing, ...input, createdAt: existing?.createdAt || input.createdAt });
  if (map.active) {
    for (const item of state.maps) if (item.campaignId === map.campaignId && item.id !== map.id) item.active = false;
  }
  const index = state.maps.findIndex((item) => item.id === map.id);
  if (index >= 0) state.maps[index] = map; else state.maps.push(map);
  state.mapRevisions.push({ id: id('map_revision'), mapId: map.id, campaignId: map.campaignId, sha256: map.sha256, width: map.width, height: map.height, sourceType: map.sourceType, createdAt: nowIso() });
  state.mapRevisions = state.mapRevisions.slice(-500);
  return clone(map);
}

function saveMarker(state, input = {}) {
  ensureMapCollections(state);
  const existing = input.id ? state.mapMarkers.find((item) => item.id === input.id) : null;
  const marker = normalizeMarker({ ...existing, ...input, createdAt: existing?.createdAt || input.createdAt });
  if (marker.markerType === 'party') {
    const duplicate = state.mapMarkers.find((item) => item.mapId === marker.mapId && item.markerType === 'party' && item.id !== marker.id);
    if (duplicate) marker.id = duplicate.id, marker.createdAt = duplicate.createdAt;
  }
  const index = state.mapMarkers.findIndex((item) => item.id === marker.id);
  if (index >= 0) state.mapMarkers[index] = marker; else state.mapMarkers.push(marker);
  return clone(marker);
}

function removeMarker(state, markerId) {
  ensureMapCollections(state);
  const index = state.mapMarkers.findIndex((item) => item.id === markerId);
  if (index < 0) throw fail('Map marker was not found.', 'DND_MAP_MARKER_NOT_FOUND');
  return clone(state.mapMarkers.splice(index, 1)[0]);
}

function playerSafeMapState(state, campaignId, mapId) {
  ensureMapCollections(state);
  const map = state.maps.find((item) => item.id === mapId && item.campaignId === campaignId && item.revealed && !item.archived) || null;
  if (!map) return { map: null, markers: [] };
  const safeMap = { id: map.id, campaignId: map.campaignId, name: map.name, width: map.width, height: map.height, gridType: map.gridType, gridSize: map.gridSize, scaleLabel: map.scaleLabel, active: map.active, revealed: true };
  const markers = state.mapMarkers.filter((item) => item.mapId === map.id && item.visible).map((item) => ({
    id: item.id, mapId: item.mapId, campaignId: item.campaignId, markerType: item.markerType,
    linkedId: item.linkedId, label: item.label, publicDescription: item.publicDescription,
    x: item.x, y: item.y, icon: item.icon, color: item.color
  }));
  return { map: safeMap, markers };
}

function seededRandom(seedValue) {
  let seed = crypto.createHash('sha256').update(String(seedValue || 'khaos-nexus')).digest().readUInt32LE(0) || 1;
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
}
function esc(value) { return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]); }

function squareGrid(width, height, size) {
  const lines = [];
  for (let x = size; x < width; x += size) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
  for (let y = size; y < height; y += size) lines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
  return `<g class="grid">${lines.join('')}</g>`;
}
function hexGrid(width, height, size) {
  const parts = [];
  const radius = size / 2;
  const stepX = radius * 1.5;
  const stepY = Math.sqrt(3) * radius;
  for (let column = 0, x = radius; x < width + radius; column += 1, x += stepX) {
    for (let y = radius + (column % 2 ? stepY / 2 : 0); y < height + radius; y += stepY) {
      const points = Array.from({ length: 6 }, (_, index) => { const angle = Math.PI / 3 * index; return `${(x + radius * Math.cos(angle)).toFixed(2)},${(y + radius * Math.sin(angle)).toFixed(2)}`; }).join(' ');
      parts.push(`<polygon points="${points}"/>`);
    }
  }
  return `<g class="grid">${parts.join('')}</g>`;
}

function generateMapSvg(input = {}) {
  const mode = MAP_GENERATION_MODES.includes(input.mode) ? input.mode : 'blank_grid';
  const width = Math.max(MAP_MIN_DIMENSION, Math.min(MAP_MAX_DIMENSION, integer(input.width, 1600)));
  const height = Math.max(MAP_MIN_DIMENSION, Math.min(MAP_MAX_DIMENSION, integer(input.height, 900)));
  const gridType = MAP_GRID_TYPES.includes(input.gridType) ? input.gridType : 'square';
  const gridSize = Math.max(16, Math.min(256, integer(input.gridSize, 64)));
  const seed = clean(input.seed || crypto.randomUUID(), 160);
  const theme = clean(input.theme || 'dark-fantasy', 80);
  const random = seededRandom(`${seed}:${mode}:${width}:${height}:${theme}`);
  const features = [];
  if (mode === 'overworld') {
    const count = 7 + Math.floor(random() * 6);
    for (let index = 0; index < count; index += 1) {
      const cx = Math.floor(random() * width); const cy = Math.floor(random() * height);
      const rx = Math.floor(width * (.04 + random() * .12)); const ry = Math.floor(height * (.04 + random() * .13));
      const rotation = Math.floor(random() * 180);
      features.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rotation} ${cx} ${cy})" class="land"/>`);
    }
    for (let index = 0; index < 18; index += 1) features.push(`<circle cx="${Math.floor(random() * width)}" cy="${Math.floor(random() * height)}" r="${8 + Math.floor(random() * 26)}" class="feature"/>`);
  }
  if (mode === 'dungeon') {
    const rooms = [];
    const count = 10 + Math.floor(random() * 9);
    for (let index = 0; index < count; index += 1) {
      const roomWidth = gridSize * (2 + Math.floor(random() * 4)); const roomHeight = gridSize * (2 + Math.floor(random() * 4));
      const x = gridSize * Math.floor(random() * Math.max(1, (width - roomWidth) / gridSize));
      const y = gridSize * Math.floor(random() * Math.max(1, (height - roomHeight) / gridSize));
      rooms.push({ x, y, width: roomWidth, height: roomHeight, cx: x + roomWidth / 2, cy: y + roomHeight / 2 });
      features.push(`<rect x="${x}" y="${y}" width="${roomWidth}" height="${roomHeight}" class="room"/>`);
    }
    for (let index = 1; index < rooms.length; index += 1) {
      const left = rooms[index - 1]; const right = rooms[index];
      features.push(`<path d="M${left.cx} ${left.cy} H${right.cx} V${right.cy}" class="corridor"/>`);
    }
  }
  const grid = gridType === 'square' ? squareGrid(width, height, gridSize) : gridType === 'hex' ? hexGrid(width, height, gridSize) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-seed="${esc(seed)}" data-mode="${mode}"><style>.background{fill:#101116}.grid line,.grid polygon{fill:none;stroke:#ffffff;stroke-opacity:.11;stroke-width:1}.land{fill:#343c32;stroke:#6d8065;stroke-width:4}.feature{fill:#5a4233;opacity:.75}.room{fill:#29262b;stroke:#b9a8c7;stroke-width:3}.corridor{fill:none;stroke:#8b7d94;stroke-width:${Math.max(10, Math.floor(gridSize / 3))};stroke-linecap:square}</style><rect width="100%" height="100%" class="background"/>${features.join('')}${grid}</svg>`;
  const buffer = Buffer.from(svg, 'utf8');
  return { buffer, svg, width, height, gridType, gridSize, seed, mode, theme, bytes: buffer.length, sha256: hash(buffer), mimeType: 'image/svg+xml' };
}

function parsePngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
function parseJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) return { mimeType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}
function parseWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const type = buffer.subarray(12, 16).toString('ascii');
  if (type === 'VP8X') return { mimeType: 'image/webp', width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (type === 'VP8 ' && buffer.length >= 30) return { mimeType: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (type === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21); return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}
function inspectUploadedImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAP_MAX_BYTES) throw fail('Map upload is empty or exceeds 10 MB.', 'DND_MAP_UPLOAD_SIZE');
  const dimensions = parsePngDimensions(buffer) || parseJpegDimensions(buffer) || parseWebpDimensions(buffer);
  if (!dimensions || !MAP_UPLOAD_MIME.includes(dimensions.mimeType)) throw fail('Map upload must be PNG, JPEG, or WebP.', 'DND_MAP_UPLOAD_SIGNATURE');
  if (dimensions.width < MAP_MIN_DIMENSION || dimensions.height < MAP_MIN_DIMENSION || dimensions.width > MAP_MAX_DIMENSION || dimensions.height > MAP_MAX_DIMENSION) throw fail('Map image dimensions are outside the supported range.', 'DND_MAP_DIMENSIONS_INVALID');
  return { ...dimensions, bytes: buffer.length, sha256: hash(buffer) };
}

module.exports = {
  MAP_UPLOAD_MIME, MAP_STORAGE_MIME, MAP_GRID_TYPES, MAP_GENERATION_MODES, MAP_MARKER_TYPES,
  MAP_MAX_BYTES, MAP_MAX_DIMENSION, MAP_MIN_DIMENSION,
  ensureMapCollections, normalizeMap, normalizeMarker, saveMap, saveMarker, removeMarker,
  playerSafeMapState, seededRandom, generateMapSvg, inspectUploadedImage, safeName, hash
};
