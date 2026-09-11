'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { authenticateArkIdentityWebhook, handleArkIdentityWebhook, signatureDigest } = require('../src/sentinel/ark-identity-webhook.cjs');

const secret = 'ark-identity-webhook-secret-at-least-32-chars';
const now = Date.UTC(2026, 8, 11, 8, 0, 0);

function signed(payload, timestamp = String(now)) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    rawBody,
    headers: {
      'x-nexus-timestamp': timestamp,
      'x-nexus-signature': `sha256=${signatureDigest(secret, timestamp, rawBody)}`
    }
  };
}

test('ARK identity webhook authenticates a fresh HMAC-signed event and invokes only the identity consumer', async () => {
  const request = signed({ source: 'RewardsAscended', eventId: 'ra-1', code: 'ABCD2345', eosId: '0002trustedplayer' });
  let calls = 0;
  let received = null;
  const result = await handleArkIdentityWebhook({
    ...request,
    secret,
    now,
    consumeEvent: async (payload) => {
      calls += 1;
      received = payload;
      return { ok: true };
    }
  });
  assert.deepEqual(result, { ok: true, status: 202, duplicate: false, ignored: false });
  assert.equal(calls, 1);
  assert.equal(received.eosId, '0002trustedplayer');
});

test('ARK identity webhook fails closed when its server secret is absent or weak', async () => {
  const request = signed({ source: 'server-plugin', eventId: 'plugin-1', code: 'ABCD2345', eosId: '0002trustedplayer' });
  let called = false;
  const result = await handleArkIdentityWebhook({ ...request, secret: '', now, consumeEvent: () => { called = true; return { ok: true }; } });
  assert.equal(result.status, 503);
  assert.equal(result.code, 'ARK_IDENTITY_WEBHOOK_DISABLED');
  assert.equal(called, false);
});

test('ARK identity webhook rejects missing, malformed, or incorrect signatures before parsing the event', () => {
  const request = signed({ source: 'server-plugin', eventId: 'plugin-2', code: 'ABCD2345', eosId: '0002trustedplayer' });
  assert.equal(authenticateArkIdentityWebhook({ headers: { 'x-nexus-timestamp': String(now) }, rawBody: request.rawBody, secret, now }).code, 'ARK_IDENTITY_SIGNATURE_INVALID');
  assert.equal(authenticateArkIdentityWebhook({ headers: { ...request.headers, 'x-nexus-signature': 'sha256=not-a-signature' }, rawBody: request.rawBody, secret, now }).code, 'ARK_IDENTITY_SIGNATURE_INVALID');
  const wrong = crypto.createHmac('sha256', 'different-secret-with-at-least-32-chars').update(`${now}.`).update(request.rawBody).digest('hex');
  assert.equal(authenticateArkIdentityWebhook({ headers: { ...request.headers, 'x-nexus-signature': wrong }, rawBody: request.rawBody, secret, now }).code, 'ARK_IDENTITY_SIGNATURE_INVALID');
});

test('ARK identity webhook rejects stale or invalid timestamps', () => {
  const staleAt = String(now - (5 * 60 * 1000) - 1);
  const stale = signed({ source: 'ark-plugin', eventId: 'plugin-3', code: 'ABCD2345', eosId: '0002trustedplayer' }, staleAt);
  assert.equal(authenticateArkIdentityWebhook({ ...stale, secret, now }).code, 'ARK_IDENTITY_TIMESTAMP_STALE');
  assert.equal(authenticateArkIdentityWebhook({ headers: { 'x-nexus-timestamp': 'yesterday', 'x-nexus-signature': 'a'.repeat(64) }, rawBody: stale.rawBody, secret, now }).code, 'ARK_IDENTITY_TIMESTAMP_INVALID');
});

test('ARK identity webhook signs the exact raw body so body tampering fails authentication', () => {
  const request = signed({ source: 'ark-plugin', eventId: 'plugin-4', code: 'ABCD2345', eosId: '0002trustedplayer' });
  const tampered = Buffer.from(request.rawBody.toString('utf8').replace('trustedplayer', 'otherplayer'));
  assert.equal(authenticateArkIdentityWebhook({ headers: request.headers, rawBody: tampered, secret, now }).code, 'ARK_IDENTITY_SIGNATURE_INVALID');
});

test('ARK identity webhook rejects malformed JSON after successful authentication without invoking the consumer', async () => {
  const rawBody = Buffer.from('{broken-json');
  const timestamp = String(now);
  const headers = { 'x-nexus-timestamp': timestamp, 'x-nexus-signature': signatureDigest(secret, timestamp, rawBody) };
  let calls = 0;
  const result = await handleArkIdentityWebhook({ headers, rawBody, secret, now, consumeEvent: () => { calls += 1; return { ok: true }; } });
  assert.equal(result.status, 400);
  assert.equal(result.code, 'ARK_IDENTITY_JSON_INVALID');
  assert.equal(calls, 0);
});

test('ARK identity webhook preserves identity-service replay suppression and rejection semantics', async () => {
  const request = signed({ source: 'server-plugin', eventId: 'plugin-5', code: 'ABCD2345', eosId: '0002trustedplayer' });
  const duplicate = await handleArkIdentityWebhook({ ...request, secret, now, consumeEvent: () => ({ ok: true, duplicate: true, ignored: true }) });
  assert.deepEqual(duplicate, { ok: true, status: 200, duplicate: true, ignored: true });
  const rejected = await handleArkIdentityWebhook({ ...request, secret, now, consumeEvent: () => ({ ok: false, reason: 'invalid-code' }) });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.code, 'ARK_IDENTITY_EVENT_REJECTED');
  assert.equal(rejected.reason, 'invalid-code');
});

test('ARK identity webhook does not expose a wallet mutation hook', async () => {
  const request = signed({ source: 'RewardsAscended', eventId: 'ra-wallet-isolation', code: 'ABCD2345', eosId: '0002trustedplayer' });
  const wallet = { mutations: 0 };
  const result = await handleArkIdentityWebhook({
    ...request,
    secret,
    now,
    consumeEvent: () => ({ ok: true }),
    wallet
  });
  assert.equal(result.ok, true);
  assert.equal(wallet.mutations, 0);
});
