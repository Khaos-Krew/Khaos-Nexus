'use strict';

const parent = process.parentPort;
const { createAiCoreClient } = require('./ai-core-client.cjs');

let latestBootstrap = null;
let checkSequence = 0;

function sendStatus(payload) {
  parent?.postMessage({ type: 'ai-core-status', payload });
}

async function refreshAiCore(bootstrap) {
  const sequence = ++checkSequence;
  latestBootstrap = bootstrap && typeof bootstrap === 'object' ? bootstrap : {};
  const connection = latestBootstrap.aiCore || null;
  if (!connection?.enabled) {
    sendStatus({
      enabled: false,
      reachable: false,
      linkedToPrimaryBot: false,
      endpoint: connection?.endpoint || '',
      checkedAt: new Date().toISOString(),
      capabilities: [],
      error: 'Nexus AI Core is not linked to the primary bot.'
    });
    return;
  }
  const result = await createAiCoreClient(connection).check();
  if (sequence !== checkSequence) return;
  sendStatus(result);
}

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap' || message?.type === 'config-update') {
    refreshAiCore(message.payload || {}).catch((error) => {
      sendStatus({
        enabled: Boolean(message.payload?.aiCore?.enabled),
        reachable: false,
        linkedToPrimaryBot: Boolean(message.payload?.aiCore?.enabled),
        endpoint: String(message.payload?.aiCore?.endpoint || ''),
        checkedAt: new Date().toISOString(),
        capabilities: [],
        error: String(error?.message || 'Nexus AI Core status check failed.').slice(0, 800)
      });
    });
  }
  if (message?.type === 'shutdown') checkSequence += 1;
});

require('./index.cjs');

module.exports = {
  refreshAiCore: (bootstrap) => refreshAiCore(bootstrap),
  currentBootstrap: () => latestBootstrap
};
