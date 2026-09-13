'use strict';

const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { ArkAccountLinkService } = require('./ark-account-linking.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { withIdentityProof } = require('./nexus-economy-identity-proof.cjs');
const { MAX_BODY_BYTES, handleArkIdentityWebhook } = require('./ark-identity-webhook.cjs');

const IDENTITY_WEBHOOK_ROUTE = '/ark/identity/link';

function enabledFromEnv() {
  return String(process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED || 'false').toLowerCase() === 'true';
}

function webhookSecretFromEnv() {
  return String(process.env.NEXUS_ARK_IDENTITY_WEBHOOK_SECRET || '');
}

async function syncLinkedIdentityToEconomy({ store, economyClient, event, result } = {}) {
  if (!result?.ok) return { skipped: 'link-rejected' };
  if (!economyClient || typeof economyClient.configured !== 'function' || !economyClient.configured()) {
    return { skipped: 'economy-worker-unconfigured' };
  }

  const eosId = String(event?.eosId || '').trim();
  const profile = result.profile || (eosId ? store?.profileByArk?.(eosId) : null);
  if (!eosId || !profile?.discordUserId) {
    throw new Error('Verified ARK identity could not be resolved for Nexus economy sync.');
  }

  const account = profile.arkAccounts?.find((item) => item.eosId === eosId);
  await economyClient.linkIdentity(withIdentityProof({
    discordUserId: profile.discordUserId,
    eosId,
    rankId: profile.rankId || 'shadow-recruit'
  }, account));
  return { ok: true, discordUserId: profile.discordUserId, eosId };
}

function createArkIdentityWebhookRuntime({
  store = new ArkIdentityStore(),
  accountLinking = null,
  economyClient = new NexusEconomyClient(),
  secret = webhookSecretFromEnv(),
  enabled = enabledFromEnv(),
  now = () => Date.now(),
  logger = console
} = {}) {
  const linker = accountLinking || new ArkAccountLinkService({ store });

  async function process({ headers = {}, rawBody = Buffer.alloc(0) } = {}) {
    if (!enabled) return { ok: false, status: 503, code: 'ARK_IDENTITY_LINKING_DISABLED' };
    try {
      store.requireSecret();
    } catch (error) {
      logger.warn?.(`[Nexus Sentinal] ARK identity webhook unavailable: ${String(error?.message || error).slice(0, 180)}`);
      return { ok: false, status: 503, code: 'ARK_IDENTITY_STORE_UNAVAILABLE' };
    }
    return handleArkIdentityWebhook({
      headers,
      rawBody,
      secret,
      now: now(),
      consumeEvent: async (event) => {
        const result = linker.consumeTrustedIdentityEvent(event);
        if (!result?.ok) return result;
        await syncLinkedIdentityToEconomy({ store, economyClient, event, result });
        return result;
      }
    });
  }

  return { process, store, accountLinking: linker, economyClient };
}

function readRawRequestBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        const error = new Error('ARK identity webhook body exceeds limit.');
        error.code = 'ARK_IDENTITY_WEBHOOK_TOO_LARGE';
        fail(error);
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, size));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new Error('ARK identity webhook request aborted.')));
  });
}

const singleton = createArkIdentityWebhookRuntime();

module.exports = {
  IDENTITY_WEBHOOK_ROUTE,
  createArkIdentityWebhookRuntime,
  enabledFromEnv,
  webhookSecretFromEnv,
  readRawRequestBody,
  syncLinkedIdentityToEconomy,
  singleton
};
