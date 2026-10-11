import assert from 'node:assert/strict';
import { onRequestGet as getConfig } from '../functions/api/v1/config.js';
import { onRequestGet as getHealth } from '../functions/api/v1/health.js';
import { onRequestGet as getSession } from '../functions/api/v1/session.js';
import { createSignedSession, verifySignedSession } from '../functions/_lib/session.js';

const secret = 'development-test-secret-that-is-long-enough-for-ci-only';
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: '1234567890',
  exp: now + 300,
  user: {
    id: '1234567890',
    displayName: 'CI Staff',
    roles: ['staff'],
    capabilities: ['nexus.web.access', 'nexus.staff.access']
  }
};

const token = await createSignedSession(payload, secret);
const verified = await verifySignedSession(token, secret);
assert.equal(verified?.sub, payload.sub, 'signed session should round-trip');
assert.equal(await verifySignedSession(`${token}x`, secret), null, 'tampered session must be rejected');

const sessionRequest = new Request('https://nexus.example/api/v1/session', {
  headers: { Cookie: `nexus_session=${encodeURIComponent(token)}` }
});
const sessionResponse = await getSession({
  request: sessionRequest,
  env: { NEXUS_SESSION_SECRET: secret }
});
assert.equal(sessionResponse.status, 200);
const sessionBody = await sessionResponse.json();
assert.equal(sessionBody.authenticated, true);
assert.equal(sessionBody.user.displayName, 'CI Staff');

const configResponse = await getConfig({
  env: {
    NEXUS_ENV: 'ci',
    DISCORD_CLIENT_ID: 'client-id',
    DISCORD_CLIENT_SECRET: 'client-secret',
    NEXUS_SESSION_SECRET: secret,
    NEXUS_OWNER_DISCORD_IDS: '1234567890',
    NEXUS_STAFF_DISCORD_IDS: '5555555555'
  }
});
const configBody = await configResponse.json();
assert.equal(configBody.ready, true);
assert.equal(configBody.readyCount, configBody.totalCount);

const healthResponse = await getHealth({ env: { NEXUS_ENV: 'ci' } });
const healthBody = await healthResponse.json();
assert.equal(healthBody.apiVersion, 'v1');
assert.equal(healthBody.services.find((service) => service.id === 'nexus-web')?.state, 'online');
assert.equal(healthBody.services.find((service) => service.id === 'sentinel')?.state, 'unknown');

console.log('Cloudflare Function smoke tests passed.');
