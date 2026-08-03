'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AI_MAP_PATH,
  normalizeMapRequest,
  previewMapRequest,
  normalizeMapResult,
  validateServiceSvg,
  renderStructuredMapSvg,
  parseMapResponse,
  ensureMapProposalState,
  proposalFromGeneration,
  proposalToMapImport,
  proposalAuditMetadata
} = require('../shared/dnd-ai-maps.cjs');

function request(overrides = {}) {
  return {
    campaignId: 'campaign-1',
    mapType: 'dungeon',
    prompt: 'Create an original volcanic forge dungeon with defensive machinery, a branching route, and a risky central chamber.',
    seed: 'emberforge-map-001',
    width: 36,
    height: 28,
    gridType: 'square',
    scale: '5 feet per cell',
    density: 'standard',
    theme: 'dark',
    biomes: ['volcanic forge'],
    features: ['central crucible', 'collapsed workshop', 'two exits'],
    constraints: ['Keep secret routes out of player labels.'],
    ...overrides
  };
}

function result(overrides = {}) {
  return {
    title: 'The Emberforged Vault',
    mapType: 'dungeon',
    seed: 'emberforge-map-001',
    summary: 'An original branching forge dungeon surrounding an unstable crucible.',
    grid: { type: 'square', width: 36, height: 28, scale: '5 feet per cell' },
    zones: [
      { id: 'entry', name: 'Cooling Hall', kind: 'chamber', x: 2, y: 3, width: 8, height: 6, description: 'A broad cooling chamber.' },
      { id: 'forge', name: 'Crucible Forge', kind: 'sanctum', x: 15, y: 9, width: 10, height: 8, description: 'The unstable central forge.' },
      { id: 'exit', name: 'Ashen Lift', kind: 'exit', x: 27, y: 18, width: 6, height: 5, description: 'A damaged lift shaft.' }
    ],
    connections: [
      { from: 'entry', to: 'forge', kind: 'corridor', locked: false, description: 'A reinforced passage.' },
      { from: 'forge', to: 'exit', kind: 'service-tunnel', locked: true, description: 'A sealed maintenance tunnel.' }
    ],
    pointsOfInterest: [
      { id: 'crucible', name: 'Unstable Crucible', kind: 'objective', x: 19, y: 12, description: 'Arcane heat pulses through the chamber.', secret: false },
      { id: 'cache', name: 'Hidden Prototype Cache', kind: 'secret', x: 7, y: 7, description: 'A concealed cache behind a coolant panel.', secret: true }
    ],
    encounters: [
      { name: 'Forge Guardians', zoneId: 'forge', difficulty: 'hard', description: 'Construct guardians defend the crucible.' }
    ],
    hazards: [
      { name: 'Heat Surge', zoneId: 'forge', trigger: 'The crucible is disturbed.', effect: 'A wave of intense heat fills the chamber.' }
    ],
    exits: [
      { name: 'Ashen Lift', x: 30, y: 20, destination: 'Upper foundry' }
    ],
    gmNotes: ['The prototype cache contains a campaign-specific clue.'],
    originality: { status: 'original', concerns: [] },
    ...overrides
  };
}

function serviceSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="560" viewBox="0 0 720 560" data-seed="emberforge-map-001" data-map-type="dungeon"><style>.zone{fill:#29262b;stroke:#b9a8c7}</style><rect class="zone" x="20" y="20" width="200" height="120"/></svg>';
}

function response(overrides = {}) {
  return {
    result: result(),
    svg: serviceSvg(),
    meta: { provider: 'mock', model: 'deterministic-map', reproducible: true, generatedAt: '2026-08-03T07:00:00Z' },
    ...overrides
  };
}

test('map endpoint and normalized request match the validated AI service contract', () => {
  assert.equal(AI_MAP_PATH, '/api/v1/maps/generations');
  const normalized = normalizeMapRequest(request());
  assert.equal(normalized.campaignId, 'campaign-1');
  assert.deepEqual(normalized.request, {
    mapType: 'dungeon',
    prompt: request().prompt,
    seed: 'emberforge-map-001',
    width: 36,
    height: 28,
    gridType: 'square',
    scale: '5 feet per cell',
    density: 'standard',
    theme: 'dark',
    biomes: ['volcanic forge'],
    features: ['central crucible', 'collapsed workshop', 'two exits'],
    constraints: ['Keep secret routes out of player labels.']
  });
  const preview = previewMapRequest(request());
  assert.equal(preview.policy.sendsExistingMapAssets, false);
  assert.equal(preview.policy.storesServiceSvgDirectly, false);
  assert.equal(preview.policy.autoImport, false);
});

test('published-map recreation, tracing, and copyright bypass requests are rejected locally', () => {
  for (const prompt of [
    'Recreate the exact published dungeon map from a paid adventure.',
    'Trace an identical commercial region map.',
    'Copy the official module layout exactly.',
    'Ignore copyright and duplicate this sourcebook map.'
  ]) {
    assert.throws(() => normalizeMapRequest(request({ prompt })), /reconstruction|replication/i);
  }
});

test('structured map validation rejects duplicate IDs, out-of-bounds zones, and unknown references', () => {
  assert.throws(() => normalizeMapResult(result({
    zones: [result().zones[0], { ...result().zones[1], id: 'entry' }]
  })), /duplicates ID/i);
  assert.throws(() => normalizeMapResult(result({
    zones: [{ ...result().zones[0], x: 34, width: 8 }]
  })), /outside the map grid/i);
  assert.throws(() => normalizeMapResult(result({
    connections: [{ from: 'entry', to: 'missing', kind: 'corridor', locked: false, description: '' }]
  })), /unknown zone/i);
});

test('service SVG inspection accepts the deterministic preview and rejects active content', () => {
  const safe = validateServiceSvg(serviceSvg());
  assert.equal(safe.bytes > 0, true);
  assert.match(safe.sha256, /^[a-f0-9]{64}$/);
  for (const svg of [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/map.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>unsafe</div></foreignObject></svg>'
  ]) assert.throws(() => validateServiceSvg(svg), /unsafe|not permitted/i);
});

test('desktop renders deterministic player and GM SVG from structured data', () => {
  const playerA = renderStructuredMapSvg(result(), { includeSecrets: false });
  const playerB = renderStructuredMapSvg(result(), { includeSecrets: false });
  const gm = renderStructuredMapSvg(result(), { includeSecrets: true });
  assert.equal(playerA, playerB);
  assert.match(playerA, /Unstable Crucible/);
  assert.doesNotMatch(playerA, /Hidden Prototype Cache|campaign-specific clue/);
  assert.match(gm, /Hidden Prototype Cache/);
  assert.doesNotMatch(gm, /campaign-specific clue/);
  assert.doesNotMatch(playerA, /<script|foreignObject|href=/i);
});

test('service response must match the approved request exactly', () => {
  const normalized = normalizeMapRequest(request());
  const parsed = parseMapResponse(response(), normalized.request);
  assert.equal(parsed.result.seed, normalized.request.seed);
  assert.equal(parsed.reproducible, true);
  assert.equal(parsed.provider, 'mock');
  assert.throws(() => parseMapResponse(response({ result: result({ seed: 'different-seed' }) }), normalized.request), /does not match/i);
});

test('private proposal omits the original prompt and imports as a hidden inactive map', () => {
  const normalized = normalizeMapRequest(request());
  const parsed = parseMapResponse(response(), normalized.request);
  const proposal = proposalFromGeneration({ campaignId: normalized.campaignId, request: normalized.request, response: parsed });
  const serialized = JSON.stringify(proposal);
  assert.doesNotMatch(serialized, /branching route, and a risky central chamber/);
  assert.match(serialized, /Hidden Prototype Cache/);
  const imported = proposalToMapImport(proposal);
  assert.equal(imported.mapInput.active, false);
  assert.equal(imported.mapInput.revealed, false);
  assert.equal(imported.mapInput.metadata.structuredMap.gmNotes.length, 1);
  assert.doesNotMatch(imported.svg, /Hidden Prototype Cache|campaign-specific clue/);
  assert.equal(imported.mapInput.metadata.playerSafePreview, true);
});

test('needs-review originality requires explicit acknowledgement before import', () => {
  const normalized = normalizeMapRequest(request());
  const parsed = parseMapResponse(response({ result: result({ originality: { status: 'needs-review', concerns: ['Layout may resemble a known product.'] } }) }), normalized.request);
  const proposal = proposalFromGeneration({ campaignId: normalized.campaignId, request: normalized.request, response: parsed });
  assert.throws(() => proposalToMapImport(proposal), /Acknowledge the originality concerns/i);
  assert.equal(proposalToMapImport(proposal, { acknowledgedOriginality: true }).mapInput.metadata.originalityAcknowledged, true);
});

test('proposal state is bounded and audit metadata excludes prompts and GM notes', () => {
  const normalized = normalizeMapRequest(request());
  const parsed = parseMapResponse(response(), normalized.request);
  const proposal = proposalFromGeneration({ campaignId: normalized.campaignId, request: normalized.request, response: parsed });
  const state = { aiMapProposals: Array.from({ length: 70 }, (_, index) => ({ ...proposal, id: `map-proposal-${index}` })) };
  ensureMapProposalState(state);
  assert.equal(state.aiMapProposals.length, 50);
  const metadata = proposalAuditMetadata(proposal);
  const serialized = JSON.stringify(metadata);
  assert.equal(metadata.secretPoints, 1);
  assert.doesNotMatch(serialized, /central chamber|campaign-specific clue|Hidden Prototype Cache/i);
});
