'use strict';

const assert = require('node:assert/strict');
const {
  ensureCoDmState,
  buildCampaignContext,
  CO_DM_WORKFLOWS
} = require('../shared/dnd-co-dm.cjs');
const {
  DEFAULT_AI_SERVICE_ENDPOINT,
  HEALTH_PATH,
  CAMPAIGNS_PATH,
  serviceUrl,
  normalizeHealth,
  buildLegacyCampaignRequest,
  buildLegacyTurnRequest,
  parseLegacyCampaignResponse,
  parseLegacyTurnResponse
} = require('../shared/dnd-ai-service.cjs');

const endpoint = process.env.KHAOS_AI_ENDPOINT || DEFAULT_AI_SERVICE_ENDPOINT;

async function jsonRequest(pathname, { method = 'GET', body = null } = {}) {
  const response = await fetch(serviceUrl(endpoint, pathname), {
    method,
    headers: {
      accept: 'application/json',
      ...(body === null ? {} : { 'content-type': 'application/json' }),
      'x-khaos-request-id': `integration-${Date.now()}`
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Khaos Nexus AI returned invalid JSON from ${pathname}: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`Khaos Nexus AI returned HTTP ${response.status} from ${pathname}: ${text.slice(0, 500)}`);
  return payload;
}

function integrationState() {
  return ensureCoDmState({
    campaigns: [{
      id: 'integration-campaign',
      name: 'Emberforge Integration',
      description: 'A test campaign used only for cross-repository validation.',
      ruleset: 'D&D 5e-compatible',
      status: 'active',
      active: true
    }],
    members: [{ id: 'member-1', campaignId: 'integration-campaign', displayName: 'Integration GM', role: 'dm', active: true }],
    characters: [{
      id: 'character-1',
      campaignId: 'integration-campaign',
      name: 'Vorkesh Emberforge',
      race: 'Dragonborn',
      className: 'Artificer',
      level: 7,
      notes: 'Arcane power glows through his scales.',
      active: true
    }],
    quests: [{ id: 'quest-1', campaignId: 'integration-campaign', title: 'Inspect the Ashen Forge', status: 'active', summary: 'Find the source of the unstable runes.', active: true }],
    npcs: [], locations: [], factions: [], encounters: [], sessions: [], sources: [], campaignSources: [], homebrew: [], rolls: [], registeredApps: [], bindings: [], panels: [], grants: [], channelContexts: [], audit: [], attendance: [], loot: [], combatants: [], contentEntries: []
  });
}

async function main() {
  const healthPayload = await jsonRequest(HEALTH_PATH);
  const health = normalizeHealth(healthPayload, endpoint);
  assert.equal(health.reachable, true);
  assert.equal(health.service, 'khaos-nexus-ai');
  assert.equal(health.legacyCampaignTurns, true);

  const state = integrationState();
  const context = buildCampaignContext(state, 'integration-campaign', {
    includeCharacterDetails: true,
    includeEncounterDetails: true,
    includeSessionRecaps: true,
    includeGmNotes: false,
    includeApprovedHomebrew: false,
    includePublicRolls: false
  });
  assert.match(context.text, /Vorkesh Emberforge/);

  const campaignRequest = buildLegacyCampaignRequest(state, 'integration-campaign', context);
  const campaignResponse = await jsonRequest(CAMPAIGNS_PATH, { method: 'POST', body: campaignRequest });
  const serviceCampaign = parseLegacyCampaignResponse(campaignResponse);
  assert.match(serviceCampaign.id, /^[0-9a-f-]{36}$/i);

  const turnRequest = buildLegacyTurnRequest(CO_DM_WORKFLOWS.session_prep, {
    prompt: 'Inspect the ruined forge for hidden runes and prepare three reviewable scene options.'
  });
  const turnResponse = await jsonRequest(`${CAMPAIGNS_PATH}/${encodeURIComponent(serviceCampaign.id)}/turns`, {
    method: 'POST',
    body: turnRequest
  });
  const generated = parseLegacyTurnResponse(turnResponse);
  assert.ok(generated.content.length > 20);
  assert.match(generated.content, /Khaos Nexus Owner|world responds|Options|Suggested/i);
  assert.equal(generated.provider, 'mock');
  assert.equal(generated.model, 'deterministic-local');

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    service: health.service,
    provider: generated.provider,
    model: generated.model,
    serviceCampaignId: serviceCampaign.id,
    draftCharacters: generated.content.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
