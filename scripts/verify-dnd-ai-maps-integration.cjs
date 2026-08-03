'use strict';

const assert = require('node:assert/strict');
const {
  DEFAULT_AI_SERVICE_ENDPOINT,
  serviceUrl
} = require('../shared/dnd-ai-service.cjs');
const {
  AI_MAP_PATH,
  normalizeMapRequest,
  parseMapResponse,
  proposalFromGeneration,
  proposalToMapImport
} = require('../shared/dnd-ai-maps.cjs');

const endpoint = process.env.KHAOS_AI_ENDPOINT || DEFAULT_AI_SERVICE_ENDPOINT;

async function jsonRequest(pathname, body) {
  const response = await fetch(serviceUrl(endpoint, pathname), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-khaos-request-id': `map-integration-${Date.now()}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Khaos Nexus AI returned invalid JSON from ${pathname}: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`Khaos Nexus AI returned HTTP ${response.status} from ${pathname}: ${text.slice(0, 500)}`);
  return payload;
}

async function main() {
  const normalized = normalizeMapRequest({
    campaignId: 'integration-campaign',
    mapType: 'dungeon',
    prompt: 'Create an original volcanic artificer forge dungeon with a branching route, defensive machinery, an unstable central crucible, and two distinct exits.',
    seed: 'emberforge-map-integration-001',
    width: 36,
    height: 28,
    gridType: 'square',
    scale: '5 feet per cell',
    density: 'standard',
    theme: 'dark',
    biomes: ['volcanic forge'],
    features: ['central crucible', 'collapsed workshop', 'two exits'],
    constraints: ['Keep secret points out of the player-safe preview.']
  });

  const firstPayload = await jsonRequest(AI_MAP_PATH, normalized.request);
  const secondPayload = await jsonRequest(AI_MAP_PATH, normalized.request);
  const first = parseMapResponse(firstPayload, normalized.request);
  const second = parseMapResponse(secondPayload, normalized.request);

  assert.deepEqual(first.result, second.result);
  assert.equal(firstPayload.svg, secondPayload.svg);
  assert.equal(first.reproducible, true);
  assert.equal(first.result.seed, normalized.request.seed);
  assert.equal(first.result.grid.width, normalized.request.width);
  assert.equal(first.result.grid.height, normalized.request.height);
  assert.equal(first.result.grid.type, normalized.request.gridType);
  assert.equal(first.result.grid.scale, normalized.request.scale);
  assert.ok(first.result.zones.length > 0);

  const secretNames = first.result.pointsOfInterest.filter((item) => item.secret).map((item) => item.name).filter(Boolean);
  for (const name of secretNames) assert.doesNotMatch(first.playerSvg, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  for (const note of first.result.gmNotes) {
    const pattern = new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    assert.doesNotMatch(first.playerSvg, pattern);
    assert.doesNotMatch(first.gmSvg, pattern);
  }
  if (secretNames.length) assert.ok(secretNames.some((name) => first.gmSvg.includes(name)));
  assert.doesNotMatch(first.playerSvg, /<script|foreignObject|onload=|href=/i);
  assert.doesNotMatch(first.gmSvg, /<script|foreignObject|onload=|href=/i);

  const proposal = proposalFromGeneration({
    campaignId: normalized.campaignId,
    request: normalized.request,
    response: first
  });
  const serializedProposal = JSON.stringify(proposal);
  assert.doesNotMatch(serializedProposal, /branching route, defensive machinery/i);
  const imported = proposalToMapImport(proposal, { acknowledgedOriginality: true });
  assert.equal(imported.mapInput.active, false);
  assert.equal(imported.mapInput.revealed, false);
  assert.equal(imported.mapInput.metadata.aiGenerated, true);
  assert.equal(imported.mapInput.metadata.playerSafePreview, true);
  assert.deepEqual(imported.mapInput.metadata.structuredMap, first.result);
  for (const name of secretNames) assert.doesNotMatch(imported.svg, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    provider: first.provider,
    model: first.model,
    mapTitle: first.result.title,
    mapType: first.result.mapType,
    seed: first.result.seed,
    zones: first.result.zones.length,
    publicPoints: first.result.pointsOfInterest.filter((item) => !item.secret).length,
    secretPoints: secretNames.length,
    deterministicStructuredResult: true,
    deterministicServiceSvg: true,
    playerSafePreview: true,
    importedActive: imported.mapInput.active,
    importedRevealed: imported.mapInput.revealed
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
