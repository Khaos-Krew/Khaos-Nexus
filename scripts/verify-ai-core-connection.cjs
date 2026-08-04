'use strict';

const assert = require('node:assert/strict');
const {
  AI_CORE_SNAPSHOT,
  AI_CORE_HEALTH_PATH,
  AI_CORE_CAPABILITIES_PATH,
  normalizeServiceEndpoint,
  normalizeAiCoreHealth,
  normalizeAiCoreCapabilities
} = require('../shared/ai-service-connections.cjs');
const { createAiCoreClient } = require('../bot/ai-core-client.cjs');

const endpoint = normalizeServiceEndpoint(process.env.KHAOS_AI_CORE_ENDPOINT || 'http://127.0.0.1:8790');

async function jsonGet(pathname) {
  const response = await fetch(`${endpoint}${pathname}`, {
    method: 'GET',
    headers: { accept: 'application/json', 'user-agent': 'Khaos-Nexus-AI-Core-Integration/1' },
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Nexus AI Core returned invalid JSON from ${pathname}: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`Nexus AI Core returned HTTP ${response.status} from ${pathname}: ${text.slice(0, 500)}`);
  return payload;
}

async function main() {
  assert.equal(AI_CORE_SNAPSHOT, '181f6cb25e1ccc46344b8ac7fd82437918a4a4b0');
  const health = normalizeAiCoreHealth(await jsonGet(AI_CORE_HEALTH_PATH), endpoint);
  const capabilities = normalizeAiCoreCapabilities(await jsonGet(AI_CORE_CAPABILITIES_PATH), endpoint);

  assert.equal(health.reachable, true);
  assert.equal(health.service, 'khaos-nexus-ai-core');
  assert.equal(health.targetService, 'nexus-ai-core');
  assert.equal(health.directAiToAiCallsAllowed, false);
  assert.equal(health.schedulerOwnedExternally, true);
  assert.equal(health.providerStatus.store, false);
  assert.equal(health.providerStatus.toolsAllowed, false);
  assert.ok(capabilities.capabilities.includes('nexus.help'));
  assert.ok(capabilities.capabilities.includes('nexus.discord.assist'));
  assert.ok(capabilities.capabilities.includes('nexus.update.poll'));
  assert.ok(capabilities.capabilities.includes('nexus.maintenance.propose'));
  assert.deepEqual(capabilities.rejectedNamespaces, ['dnd.*']);
  assert.equal(capabilities.directServiceForwarding, false);
  assert.equal(capabilities.directDiscordConnection, false);
  assert.equal(capabilities.directExecution, false);

  const botStatus = await createAiCoreClient({
    enabled: true,
    endpoint,
    serviceToken: '',
    repository: 'Khaos-Krew/Khaos-Nexus-AI-Core',
    snapshot: AI_CORE_SNAPSHOT,
    targetService: 'nexus-ai-core'
  }).check();
  assert.equal(botStatus.reachable, true);
  assert.equal(botStatus.linkedToPrimaryBot, true);
  assert.deepEqual(botStatus.capabilities, capabilities.capabilities);

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    serviceSnapshot: AI_CORE_SNAPSHOT,
    service: health.service,
    version: health.version,
    provider: health.provider,
    model: health.model,
    capabilities: capabilities.capabilities.length,
    dndNamespaceRejected: true,
    directServiceForwarding: false,
    directDiscordConnection: false,
    directExecution: false,
    providerContentStored: health.providerStatus.store,
    providerToolsAllowed: health.providerStatus.toolsAllowed,
    primaryBotHealthContract: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
