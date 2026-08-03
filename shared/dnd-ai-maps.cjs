'use strict';

const crypto = require('node:crypto');
const { assertRequestSize } = require('./dnd-ai-service.cjs');

const AI_MAP_PATH = '/api/v1/maps/generations';
const MAP_TYPES = Object.freeze(['encounter', 'dungeon', 'settlement', 'region', 'travel']);
const GRID_TYPES = Object.freeze(['square', 'hex', 'none']);
const DENSITIES = Object.freeze(['sparse', 'standard', 'dense']);
const THEMES = Object.freeze(['parchment', 'blueprint', 'dark', 'minimal']);
const DIFFICULTIES = Object.freeze(['easy', 'moderate', 'hard', 'deadly', 'variable']);
const MAX_PROPOSALS = 50;
const MAX_SVG_BYTES = 256 * 1024;
const CELL_PIXELS = 20;
const STANDARD_SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const PROTECTED_MAP_PATTERN = /\b(recreate|replicate|copy|trace|duplicate|reconstruct|redraw|transcribe|scan|ocr)\b.{0,80}\b(exact|identical|official|published|commercial|paid|copyrighted|adventure|module|sourcebook|map|layout|dungeon|region)\b|\b(exact|identical)\b.{0,80}\b(layout|map|dungeon|region|adventure)\b|\b(from|out of)\b.{0,80}\b(paid module|paid adventure|commercial sourcebook)\b|\b(ignore|bypass|evade)\b.{0,30}\bcopyright\b/i;
const DANGEROUS_SVG_PATTERN = /<!doctype|<!entity|<\?xml|<\s*(?:script|foreignobject|image|use|a|iframe|object|embed|canvas|video|audio|animate|set|mpath|filter)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href|src)\s*=|javascript\s*:|data\s*:|file\s*:|@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i;
const ALLOWED_SVG_ELEMENTS = new Set(['svg', 'g', 'rect', 'line', 'polygon', 'polyline', 'path', 'circle', 'ellipse', 'text', 'tspan', 'style', 'title', 'desc']);
const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewbox', 'class', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-opacity',
  'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline',
  'vector-effect', 'role', 'aria-label', 'aria-labelledby', 'data-seed', 'data-map-type'
]);

function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function clean(value, maximum = 1000) { return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maximum); }
function cleanLine(value, maximum = 1000) { return clean(value, maximum).replace(/\s+/g, ' '); }
function nowIso() { return new Date().toISOString(); }
function id(prefix = 'ai_map') { return `${prefix}_${crypto.randomUUID()}`; }
function validationError(message, field, code = 'DND_AI_MAP_INVALID') { return Object.assign(new Error(message), { code, field }); }
function assertRawLength(value, maximum, message, field, code) {
  if (String(value ?? '').trim().length > maximum) throw validationError(message, field, code);
}
function integer(value, field, minimum, maximum, fallback) {
  const candidate = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw validationError(`${field} must be an integer from ${minimum} to ${maximum}.`, field, 'DND_AI_MAP_RANGE_INVALID');
  }
  return candidate;
}
function bool(value) { return value === true; }
function uniqueLines(value, maximumItems, maximumLength, field) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  const nonEmpty = source.filter((item) => String(item || '').trim());
  if (nonEmpty.length > maximumItems) throw validationError(`${field} may contain at most ${maximumItems} entries.`, field, 'DND_AI_MAP_TOO_MANY_ITEMS');
  nonEmpty.forEach((item, index) => assertRawLength(item, maximumLength, `${field} entry ${index + 1} exceeds ${maximumLength} characters.`, `${field}.${index}`, 'DND_AI_MAP_ITEM_TOO_LONG'));
  return [...new Set(nonEmpty.map((item) => cleanLine(item, maximumLength)))];
}
function defaultsForMapType(mapType) {
  return ({
    encounter: { width: 24, height: 18, gridType: 'square', scale: '5 feet per cell' },
    dungeon: { width: 36, height: 28, gridType: 'square', scale: '5 feet per cell' },
    settlement: { width: 48, height: 36, gridType: 'square', scale: '25 feet per cell' },
    region: { width: 60, height: 45, gridType: 'hex', scale: '1 mile per cell' },
    travel: { width: 50, height: 30, gridType: 'square', scale: '1 mile per cell' }
  })[mapType];
}
function assertOriginalMapRequest(request = {}) {
  const combined = [request.prompt, ...(request.biomes || []), ...(request.features || []), ...(request.constraints || [])].join('\n');
  if (PROTECTED_MAP_PATTERN.test(combined)) {
    throw validationError('Exact reconstruction, tracing, or close replication of a published or commercial map is not supported. Describe terrain, encounter goals, routes, and atmosphere for a new original layout.', 'prompt', 'DND_AI_MAP_COPY_REQUEST');
  }
  return true;
}

function normalizeMapRequest(input = {}) {
  const campaignId = cleanLine(input.campaignId, 100);
  const mapType = MAP_TYPES.includes(input.mapType) ? input.mapType : '';
  if (!campaignId) throw validationError('Select a campaign before generating a map.', 'campaignId', 'DND_CAMPAIGN_REQUIRED');
  if (!mapType) throw validationError(`Choose a supported map type: ${MAP_TYPES.join(', ')}.`, 'mapType', 'DND_AI_MAP_TYPE_INVALID');
  const defaults = defaultsForMapType(mapType);
  const prompt = clean(input.prompt, 4000);
  if (!prompt) throw validationError('Describe the original map you want to generate.', 'prompt');
  assertRawLength(input.prompt, 4000, 'The map prompt must be 4,000 characters or fewer.', 'prompt', 'DND_AI_MAP_PROMPT_TOO_LONG');
  const seed = cleanLine(input.seed || crypto.randomUUID(), 128);
  assertRawLength(input.seed || '', 128, 'The map seed must be 128 characters or fewer.', 'seed', 'DND_AI_MAP_SEED_TOO_LONG');
  const width = integer(input.width, 'width', 12, 80, defaults.width);
  const height = integer(input.height, 'height', 12, 80, defaults.height);
  const gridType = GRID_TYPES.includes(input.gridType) ? input.gridType : defaults.gridType;
  const scale = cleanLine(input.scale || defaults.scale, 80);
  const density = DENSITIES.includes(input.density) ? input.density : 'standard';
  const theme = THEMES.includes(input.theme) ? input.theme : 'parchment';
  const biomes = uniqueLines(input.biomes, 8, 120, 'biomes');
  const features = uniqueLines(input.features, 24, 300, 'features');
  const constraints = uniqueLines(input.constraints, 20, 400, 'constraints');
  const request = { mapType, prompt, seed, width, height, gridType, scale, density, theme, biomes, features, constraints };
  assertOriginalMapRequest(request);
  assertRequestSize(request);
  return { campaignId, request };
}

function previewMapRequest(input = {}) {
  const normalized = normalizeMapRequest(input);
  return {
    campaignId: normalized.campaignId,
    request: normalized.request,
    metrics: {
      requestBytes: Buffer.byteLength(JSON.stringify(normalized.request), 'utf8'),
      gridCells: normalized.request.width * normalized.request.height,
      biomes: normalized.request.biomes.length,
      features: normalized.request.features.length,
      constraints: normalized.request.constraints.length
    },
    policy: {
      sendsExistingMapAssets: false,
      storesServiceSvgDirectly: false,
      autoImport: false,
      autoReveal: false,
      autoActivation: false,
      autoDiscordPublication: false
    }
  };
}

function normalizeStringArray(value, maximumItems, maximumLength) {
  return (Array.isArray(value) ? value : []).slice(0, maximumItems).map((item) => clean(item, maximumLength)).filter(Boolean);
}
function coordinate(value, field, maximum) { return integer(value, field, 0, maximum, -1); }
function requiredObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw validationError(`${field} must be an object.`, field, 'DND_AI_MAP_RESULT_INVALID');
  return value;
}
function boundedArray(value, field, maximum) {
  if (!Array.isArray(value) || value.length > maximum) throw validationError(`${field} must be an array with at most ${maximum} entries.`, field, 'DND_AI_MAP_RESULT_INVALID');
  return value;
}
function uniqueId(value, field, seen) {
  const result = cleanLine(value, 80);
  if (!result) throw validationError(`${field} requires an ID.`, field, 'DND_AI_MAP_RESULT_INVALID');
  if (seen.has(result)) throw validationError(`${field} duplicates ID ${result}.`, field, 'DND_AI_MAP_DUPLICATE_ID');
  seen.add(result);
  return result;
}

function normalizeMapResult(input = {}) {
  const result = requiredObject(input, 'result');
  const title = cleanLine(result.title, 160);
  const mapType = MAP_TYPES.includes(result.mapType) ? result.mapType : '';
  const seed = cleanLine(result.seed, 128);
  const summary = clean(result.summary, 1500);
  if (!title || !mapType || !seed || !summary) throw validationError('Khaos Nexus AI returned an incomplete map result.', 'result', 'DND_AI_MAP_RESULT_INVALID');
  const gridInput = requiredObject(result.grid, 'result.grid');
  const width = integer(gridInput.width, 'result.grid.width', 12, 80);
  const height = integer(gridInput.height, 'result.grid.height', 12, 80);
  const gridType = GRID_TYPES.includes(gridInput.type) ? gridInput.type : '';
  const scale = cleanLine(gridInput.scale, 80);
  if (!gridType || !scale) throw validationError('Khaos Nexus AI returned an invalid map grid.', 'result.grid', 'DND_AI_MAP_RESULT_INVALID');

  const zoneIds = new Set();
  const zones = boundedArray(result.zones || [], 'result.zones', 40).map((item, index) => {
    const zone = requiredObject(item, `result.zones.${index}`);
    const x = coordinate(zone.x, `result.zones.${index}.x`, width - 1);
    const y = coordinate(zone.y, `result.zones.${index}.y`, height - 1);
    const zoneWidth = integer(zone.width, `result.zones.${index}.width`, 1, width);
    const zoneHeight = integer(zone.height, `result.zones.${index}.height`, 1, height);
    if (x + zoneWidth > width || y + zoneHeight > height) throw validationError(`Zone ${index + 1} extends outside the map grid.`, `result.zones.${index}`, 'DND_AI_MAP_RESULT_INVALID');
    return {
      id: uniqueId(zone.id, `result.zones.${index}.id`, zoneIds),
      name: cleanLine(zone.name, 120), kind: cleanLine(zone.kind, 80), x, y,
      width: zoneWidth, height: zoneHeight, description: clean(zone.description, 1200)
    };
  });

  const connections = boundedArray(result.connections || [], 'result.connections', 80).map((item, index) => {
    const connection = requiredObject(item, `result.connections.${index}`);
    const from = cleanLine(connection.from, 80); const to = cleanLine(connection.to, 80);
    if (!zoneIds.has(from) || !zoneIds.has(to)) throw validationError(`Connection ${index + 1} references an unknown zone.`, `result.connections.${index}`, 'DND_AI_MAP_REFERENCE_INVALID');
    return { from, to, kind: cleanLine(connection.kind, 80), locked: bool(connection.locked), description: clean(connection.description, 600) };
  });

  const pointIds = new Set();
  const pointsOfInterest = boundedArray(result.pointsOfInterest || [], 'result.pointsOfInterest', 60).map((item, index) => {
    const point = requiredObject(item, `result.pointsOfInterest.${index}`);
    return {
      id: uniqueId(point.id, `result.pointsOfInterest.${index}.id`, pointIds),
      name: cleanLine(point.name, 120), kind: cleanLine(point.kind, 80),
      x: coordinate(point.x, `result.pointsOfInterest.${index}.x`, width - 1),
      y: coordinate(point.y, `result.pointsOfInterest.${index}.y`, height - 1),
      description: clean(point.description, 900), secret: bool(point.secret)
    };
  });

  const encounters = boundedArray(result.encounters || [], 'result.encounters', 30).map((item, index) => {
    const encounter = requiredObject(item, `result.encounters.${index}`);
    const zoneId = cleanLine(encounter.zoneId, 80);
    if (!zoneIds.has(zoneId)) throw validationError(`Encounter ${index + 1} references an unknown zone.`, `result.encounters.${index}.zoneId`, 'DND_AI_MAP_REFERENCE_INVALID');
    const difficulty = DIFFICULTIES.includes(encounter.difficulty) ? encounter.difficulty : '';
    if (!difficulty) throw validationError(`Encounter ${index + 1} has an invalid difficulty.`, `result.encounters.${index}.difficulty`, 'DND_AI_MAP_RESULT_INVALID');
    return { name: cleanLine(encounter.name, 120), zoneId, difficulty, description: clean(encounter.description, 1000) };
  });

  const hazards = boundedArray(result.hazards || [], 'result.hazards', 30).map((item, index) => {
    const hazard = requiredObject(item, `result.hazards.${index}`);
    const zoneId = cleanLine(hazard.zoneId, 80);
    if (!zoneIds.has(zoneId)) throw validationError(`Hazard ${index + 1} references an unknown zone.`, `result.hazards.${index}.zoneId`, 'DND_AI_MAP_REFERENCE_INVALID');
    return { name: cleanLine(hazard.name, 120), zoneId, trigger: clean(hazard.trigger, 700), effect: clean(hazard.effect, 900) };
  });

  const exits = boundedArray(result.exits || [], 'result.exits', 12).map((item, index) => ({
    name: cleanLine(item?.name, 120),
    x: coordinate(item?.x, `result.exits.${index}.x`, width - 1),
    y: coordinate(item?.y, `result.exits.${index}.y`, height - 1),
    destination: clean(item?.destination, 300)
  }));
  const originalityInput = requiredObject(result.originality || {}, 'result.originality');
  const originalityStatus = originalityInput.status === 'needs-review' ? 'needs-review' : originalityInput.status === 'original' ? 'original' : '';
  if (!originalityStatus) throw validationError('Khaos Nexus AI returned an invalid originality status.', 'result.originality.status', 'DND_AI_MAP_RESULT_INVALID');
  return {
    title, mapType, seed, summary,
    grid: { type: gridType, width, height, scale },
    zones, connections, pointsOfInterest, encounters, hazards, exits,
    gmNotes: normalizeStringArray(result.gmNotes, 20, 700),
    originality: { status: originalityStatus, concerns: normalizeStringArray(originalityInput.concerns, 12, 500) }
  };
}

function validateServiceSvg(svg) {
  const source = String(svg || '').trim();
  const bytes = Buffer.byteLength(source, 'utf8');
  if (!source || bytes > MAX_SVG_BYTES || !/^<svg\b/i.test(source) || !/<\/svg>$/i.test(source)) {
    throw validationError('Khaos Nexus AI returned an invalid or oversized SVG preview.', 'svg', 'DND_AI_MAP_SVG_INVALID');
  }
  const openingTag = source.match(/^<svg\b[^>]*>/i)?.[0] || '';
  const namespaceMatches = [...openingTag.matchAll(/\sxmlns\s*=\s*(["'])(.*?)\1/gi)];
  if (namespaceMatches.length !== 1 || namespaceMatches[0][2] !== STANDARD_SVG_NAMESPACE) {
    throw validationError('Khaos Nexus AI returned an SVG with an unsupported namespace.', 'svg.xmlns', 'DND_AI_MAP_SVG_UNSAFE');
  }
  if (DANGEROUS_SVG_PATTERN.test(source)) throw validationError('Khaos Nexus AI returned unsafe SVG content.', 'svg', 'DND_AI_MAP_SVG_UNSAFE');
  const tagPattern = /<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_SVG_ELEMENTS.has(name)) throw validationError(`SVG element ${name} is not permitted.`, 'svg', 'DND_AI_MAP_SVG_UNSAFE');
    if (match[0].startsWith('</') || name === 'style') continue;
    const attributePattern = /\s([a-zA-Z_:][\w:.-]*)\s*=/g;
    let attribute;
    while ((attribute = attributePattern.exec(match[0]))) {
      const attributeName = attribute[1].toLowerCase();
      if (!ALLOWED_SVG_ATTRIBUTES.has(attributeName)) throw validationError(`SVG attribute ${attributeName} is not permitted.`, 'svg', 'DND_AI_MAP_SVG_UNSAFE');
      if (attributeName === 'xmlns') {
        const namespaceValue = match[0].match(/\sxmlns\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
        if (namespaceValue !== STANDARD_SVG_NAMESPACE) throw validationError('SVG namespace is not permitted.', 'svg.xmlns', 'DND_AI_MAP_SVG_UNSAFE');
      }
    }
  }
  return { bytes, sha256: crypto.createHash('sha256').update(source).digest('hex') };
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}
function renderStructuredMapSvg(resultInput = {}, options = {}) {
  const result = normalizeMapResult(resultInput);
  const includeSecrets = options.includeSecrets === true;
  const width = result.grid.width * CELL_PIXELS;
  const height = result.grid.height * CELL_PIXELS;
  const zoneById = new Map(result.zones.map((zone) => [zone.id, zone]));
  const parts = [];
  for (const connection of result.connections) {
    const from = zoneById.get(connection.from); const to = zoneById.get(connection.to);
    if (!from || !to) continue;
    const x1 = (from.x + from.width / 2) * CELL_PIXELS; const y1 = (from.y + from.height / 2) * CELL_PIXELS;
    const x2 = (to.x + to.width / 2) * CELL_PIXELS; const y2 = (to.y + to.height / 2) * CELL_PIXELS;
    parts.push(`<line class="connection" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }
  for (const zone of result.zones) {
    const x = zone.x * CELL_PIXELS; const y = zone.y * CELL_PIXELS;
    const zoneWidth = zone.width * CELL_PIXELS; const zoneHeight = zone.height * CELL_PIXELS;
    parts.push(`<rect class="zone" x="${x}" y="${y}" width="${zoneWidth}" height="${zoneHeight}" rx="6" ry="6"/>`);
    parts.push(`<text class="zone-label" x="${x + 8}" y="${y + 18}">${escapeXml(zone.name || zone.kind || 'Zone')}</text>`);
  }
  for (const point of result.pointsOfInterest.filter((item) => includeSecrets || !item.secret)) {
    const x = (point.x + 0.5) * CELL_PIXELS; const y = (point.y + 0.5) * CELL_PIXELS;
    parts.push(`<circle class="poi${point.secret ? ' secret' : ''}" cx="${x}" cy="${y}" r="6"/>`);
    parts.push(`<text class="poi-label" x="${x + 9}" y="${y + 4}">${escapeXml(point.name || point.kind || 'Point')}</text>`);
  }
  for (const exit of result.exits) {
    const x = (exit.x + 0.5) * CELL_PIXELS; const y = (exit.y + 0.5) * CELL_PIXELS;
    parts.push(`<rect class="exit" x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})"/>`);
  }
  const grid = result.grid.type === 'none' ? '' : `<path class="grid" d="${Array.from({ length: result.grid.width + 1 }, (_, index) => `M${index * CELL_PIXELS} 0V${height}`).concat(Array.from({ length: result.grid.height + 1 }, (_, index) => `M0 ${index * CELL_PIXELS}H${width}`)).join(' ')}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-seed="${escapeXml(result.seed)}" data-map-type="${escapeXml(result.mapType)}"><style>.background{fill:#121318}.grid{fill:none;stroke:#fff;stroke-opacity:.08;stroke-width:1}.connection{stroke:#8b7d94;stroke-width:5;stroke-linecap:round}.zone{fill:#29262b;stroke:#b9a8c7;stroke-width:2}.zone-label,.poi-label{fill:#f4f1f7;font-family:Arial,sans-serif;font-size:12px}.poi{fill:#d2a84a;stroke:#171717;stroke-width:2}.poi.secret{fill:#b44c5d}.exit{fill:#65a9b8}</style><rect class="background" width="${width}" height="${height}"/>${grid}${parts.join('')}</svg>`;
}

function parseMapResponse(payload = {}, request = null) {
  const result = normalizeMapResult(payload.result || payload.map || payload);
  if (request) {
    for (const [field, actual, expected] of [
      ['mapType', result.mapType, request.mapType], ['seed', result.seed, request.seed],
      ['grid.width', result.grid.width, request.width], ['grid.height', result.grid.height, request.height],
      ['grid.type', result.grid.type, request.gridType], ['grid.scale', result.grid.scale, request.scale]
    ]) if (actual !== expected) throw validationError(`Khaos Nexus AI returned ${field} that does not match the approved request.`, `result.${field}`, 'DND_AI_MAP_RESULT_MISMATCH');
  }
  const serviceSvg = validateServiceSvg(payload.svg);
  return {
    result,
    playerSvg: renderStructuredMapSvg(result, { includeSecrets: false }),
    gmSvg: renderStructuredMapSvg(result, { includeSecrets: true }),
    serviceSvg,
    provider: cleanLine(payload.meta?.provider || payload.provider, 80),
    model: cleanLine(payload.meta?.model || payload.model, 120),
    generatedAt: payload.meta?.generatedAt || nowIso(),
    reproducible: payload.meta?.reproducible !== false
  };
}

function normalizeProposal(input = {}) {
  const result = normalizeMapResult(input.result || {});
  const createdAt = input.createdAt || nowIso();
  return {
    id: cleanLine(input.id, 100) || id(), campaignId: cleanLine(input.campaignId, 100),
    requestSummary: {
      mapType: MAP_TYPES.includes(input.requestSummary?.mapType) ? input.requestSummary.mapType : result.mapType,
      seed: cleanLine(input.requestSummary?.seed || result.seed, 128),
      width: integer(input.requestSummary?.width, 'requestSummary.width', 12, 80, result.grid.width),
      height: integer(input.requestSummary?.height, 'requestSummary.height', 12, 80, result.grid.height),
      gridType: GRID_TYPES.includes(input.requestSummary?.gridType) ? input.requestSummary.gridType : result.grid.type,
      scale: cleanLine(input.requestSummary?.scale || result.grid.scale, 80),
      density: DENSITIES.includes(input.requestSummary?.density) ? input.requestSummary.density : 'standard',
      theme: THEMES.includes(input.requestSummary?.theme) ? input.requestSummary.theme : 'parchment',
      biomes: uniqueLines(input.requestSummary?.biomes, 8, 120, 'requestSummary.biomes'),
      features: uniqueLines(input.requestSummary?.features, 24, 300, 'requestSummary.features'),
      constraints: uniqueLines(input.requestSummary?.constraints, 20, 400, 'requestSummary.constraints')
    },
    result,
    playerSvg: renderStructuredMapSvg(result, { includeSecrets: false }),
    gmSvg: renderStructuredMapSvg(result, { includeSecrets: true }),
    serviceSvgSha256: cleanLine(input.serviceSvgSha256, 64),
    provider: cleanLine(input.provider, 80), model: cleanLine(input.model, 120),
    generatedAt: input.generatedAt || createdAt, createdAt, updatedAt: input.updatedAt || createdAt
  };
}
function ensureMapProposalState(state) {
  if (!state || typeof state !== 'object') throw new Error('D&D state is unavailable.');
  if (!Array.isArray(state.aiMapProposals)) state.aiMapProposals = [];
  state.aiMapProposals = state.aiMapProposals.map((item) => { try { return normalizeProposal(item); } catch { return null; } }).filter(Boolean).slice(-MAX_PROPOSALS);
  return state;
}
function proposalFromGeneration({ campaignId, request, response }) {
  return normalizeProposal({
    campaignId,
    requestSummary: { mapType: request.mapType, seed: request.seed, width: request.width, height: request.height, gridType: request.gridType, scale: request.scale, density: request.density, theme: request.theme, biomes: request.biomes, features: request.features, constraints: request.constraints },
    result: response.result, serviceSvgSha256: response.serviceSvg.sha256,
    provider: response.provider, model: response.model, generatedAt: response.generatedAt
  });
}
function proposalToMapImport(proposalInput = {}, options = {}) {
  const proposal = normalizeProposal(proposalInput);
  if (proposal.result.originality.status === 'needs-review' && options.acknowledgedOriginality !== true) {
    throw validationError('Acknowledge the originality concerns before importing this map proposal.', 'acknowledgedOriginality', 'DND_AI_MAP_ORIGINALITY_ACK_REQUIRED');
  }
  const svg = proposal.playerSvg;
  const buffer = Buffer.from(svg, 'utf8');
  return {
    svg,
    mapInput: {
      campaignId: proposal.campaignId, name: proposal.result.title, sourceType: 'generated',
      mimeType: 'image/svg+xml', bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      width: proposal.result.grid.width * CELL_PIXELS, height: proposal.result.grid.height * CELL_PIXELS,
      gridType: proposal.result.grid.type, gridSize: CELL_PIXELS, scaleLabel: proposal.result.grid.scale,
      seed: proposal.result.seed, generationMode: 'ai_structured', theme: proposal.requestSummary.theme,
      active: false, revealed: false,
      metadata: {
        aiGenerated: true, structuredMap: clone(proposal.result), provider: proposal.provider, model: proposal.model,
        generatedAt: proposal.generatedAt, request: clone(proposal.requestSummary), serviceSvgSha256: proposal.serviceSvgSha256,
        playerSafePreview: true, originalityAcknowledged: options.acknowledgedOriginality === true
      }
    }
  };
}
function proposalAuditMetadata(proposalInput = {}) {
  const proposal = normalizeProposal(proposalInput);
  return {
    proposalId: proposal.id, mapType: proposal.result.mapType, seed: proposal.result.seed,
    zones: proposal.result.zones.length, pointsOfInterest: proposal.result.pointsOfInterest.length,
    secretPoints: proposal.result.pointsOfInterest.filter((item) => item.secret).length,
    originalityStatus: proposal.result.originality.status, provider: proposal.provider, model: proposal.model,
    serviceSvgSha256: proposal.serviceSvgSha256
  };
}

module.exports = {
  AI_MAP_PATH, MAP_TYPES, GRID_TYPES, DENSITIES, THEMES, DIFFICULTIES, MAX_PROPOSALS, MAX_SVG_BYTES, CELL_PIXELS, STANDARD_SVG_NAMESPACE,
  normalizeMapRequest, previewMapRequest, assertOriginalMapRequest, normalizeMapResult,
  validateServiceSvg, renderStructuredMapSvg, parseMapResponse,
  normalizeProposal, ensureMapProposalState, proposalFromGeneration, proposalToMapImport, proposalAuditMetadata
};
