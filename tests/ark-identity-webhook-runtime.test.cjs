'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ArkIdentityStore } = require('../src/sentinel/ark-identity-store.cjs');
const { signatureDigest } = require('../src/sentinel/ark-identity-webhook.cjs');
const {
  IDENTITY_WEBHOOK_ROUTE,
  createArkIdentityWebhookRuntime,
  readRawRequestBody
} = require('../src/sentinel/ark-identity-webhook-runtime.cjs');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-identity-webhook-runtime-'));
}

function signedRequest(secret, timestamp, payload) {
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  return {
    rawBody,
    headers: {
      'x-nexus-timestamp': String(timestamp),
      'x-nexus-signature': `sha256=${signatureDigest(secret, String(timestamp), rawBody)}`
    }
  };
}

function economyClient({ configured = true, linkIdentity } = {}) {
  return {
    configured: () => configured,
    linkIdentity: linkIdentity || (async () => ({ ok: true }))
  };
}

test('identity webhook runtime is fail-closed unless live account linking is enabled', async () => {
  const root = tempRoot();
  try {
    const store = new ArkIdentityStore({ root, secret: 'i'.repeat(48) });
    const runtime = createArkIdentityWebhookRuntime({ store, economyClient: economyClient({ configured: false }), secret: 'w'.repeat(48), enabled: false });
    const result = await runtime.process({ rawBody: Buffer.from('{}'), headers: {} });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.code, 'ARK_IDENTITY_LINKING_DISABLED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated runtime consumes a one-time EOS proof and immediately syncs the same verified identity to Nexus economy', async () => {
  const root = tempRoot();
  const now = 1_789_123_456_000;
  const identitySecret = 'identity-secret-'.padEnd(48, 'i');
  const webhookSecret = 'webhook-secret-'.padEnd(48, 'w');
  const synced = [];
  try {
    const store = new ArkIdentityStore({ root, secret: identitySecret, now: () => now });
    const challenge = store.issueChallenge('123456789012345678');
    const runtime = createArkIdentityWebhookRuntime({
      store,
      economyClient: economyClient({ linkIdentity: async (input) => { synced.push(input); return { ok: true }; } }),
      secret: webhookSecret,
      enabled: true,
      now: () => now,
      logger: { warn() {} }
    });
    const request = signedRequest(webhookSecret, now, {
      source: 'rewardsascended',
      eventId: 'purchase-link-proof-001',
      code: challenge.code,
      eosId: 'EOS_PLAYER_123456789',
      playerName: 'Survivor',
      mapId: 'gen1'
    });

    const accepted = await runtime.process(request);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, 202);
    assert.equal(accepted.duplicate, false);
    assert.equal(store.profileByArk('EOS_PLAYER_123456789').discordUserId, '123456789012345678');
    assert.deepEqual(synced, [{
      discordUserId: '123456789012345678',
      eosId: 'EOS_PLAYER_123456789',
      rankId: 'shadow-recruit'
    }]);

    const replay = await runtime.process(request);
    assert.equal(replay.ok, true);
    assert.equal(replay.status, 200);
    assert.equal(replay.duplicate, true);
    assert.equal(synced.length, 2, 'duplicate delivery retries the idempotent worker identity link for convergence');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a transient economy sync failure is recoverable by replaying the same authenticated event without issuing a new challenge', async () => {
  const root = tempRoot();
  const now = 1_789_123_456_000;
  const webhookSecret = 'webhook-secret-'.padEnd(48, 'w');
  let attempts = 0;
  try {
    const store = new ArkIdentityStore({ root, secret: 'identity-secret-'.padEnd(48, 'i'), now: () => now });
    const challenge = store.issueChallenge('123456789012345678');
    const runtime = createArkIdentityWebhookRuntime({
      store,
      economyClient: economyClient({
        linkIdentity: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('temporary economy worker outage');
          return { ok: true };
        }
      }),
      secret: webhookSecret,
      enabled: true,
      now: () => now,
      logger: { warn() {} }
    });
    const request = signedRequest(webhookSecret, now, {
      source: 'server-plugin',
      eventId: 'retryable-link-event-001',
      code: challenge.code,
      eosId: 'EOS_PLAYER_RETRY_123',
      playerName: 'Retry Survivor',
      mapId: 'map2'
    });

    await assert.rejects(() => runtime.process(request), /temporary economy worker outage/);
    assert.equal(store.profileByArk('EOS_PLAYER_RETRY_123').discordUserId, '123456789012345678');

    const replay = await runtime.process(request);
    assert.equal(replay.ok, true);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.status, 200);
    assert.equal(attempts, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('account linking stays available when the economy worker is intentionally unconfigured', async () => {
  const root = tempRoot();
  const now = 1_789_123_456_000;
  const webhookSecret = 'webhook-secret-'.padEnd(48, 'w');
  try {
    const store = new ArkIdentityStore({ root, secret: 'identity-secret-'.padEnd(48, 'i'), now: () => now });
    const challenge = store.issueChallenge('123456789012345678');
    const runtime = createArkIdentityWebhookRuntime({
      store,
      economyClient: economyClient({ configured: false }),
      secret: webhookSecret,
      enabled: true,
      now: () => now,
      logger: { warn() {} }
    });
    const request = signedRequest(webhookSecret, now, {
      source: 'ark-plugin',
      eventId: 'link-with-worker-disabled-001',
      code: challenge.code,
      eosId: 'EOS_PLAYER_DISABLED_1',
      playerName: 'Survivor',
      mapId: 'gen1'
    });

    const accepted = await runtime.process(request);
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, 202);
    assert.equal(store.profileByArk('EOS_PLAYER_DISABLED_1').discordUserId, '123456789012345678');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime does not accept a trusted event when the HMAC body has been altered', async () => {
  const root = tempRoot();
  const now = 1_789_123_456_000;
  const webhookSecret = 'webhook-secret-'.padEnd(48, 'w');
  try {
    const store = new ArkIdentityStore({ root, secret: 'identity-secret-'.padEnd(48, 'i'), now: () => now });
    const runtime = createArkIdentityWebhookRuntime({ store, economyClient: economyClient({ configured: false }), secret: webhookSecret, enabled: true, now: () => now, logger: { warn() {} } });
    const request = signedRequest(webhookSecret, now, { source: 'server-plugin', eventId: 'event-1', code: 'ABCDEFGH', eosId: 'EOS_PLAYER_123456789' });
    request.rawBody = Buffer.from(request.rawBody.toString('utf8').replace('ABCDEFGH', 'ZZZZZZZZ'), 'utf8');
    const result = await runtime.process(request);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.code, 'ARK_IDENTITY_SIGNATURE_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('raw request reader enforces the webhook body ceiling before JSON parsing', async () => {
  const req = Readable.from([Buffer.alloc(65 * 1024, 1)]);
  await assert.rejects(() => readRawRequestBody(req), (error) => error?.code === 'ARK_IDENTITY_WEBHOOK_TOO_LARGE');
});

test('identity webhook route remains separate from DynamicConfig assets', () => {
  assert.equal(IDENTITY_WEBHOOK_ROUTE, '/ark/identity/link');
  assert.equal(IDENTITY_WEBHOOK_ROUTE.startsWith('/ark/dynamic/'), false);
});
