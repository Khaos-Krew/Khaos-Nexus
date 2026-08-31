'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ALLOWED_COMMANDS,
  CitadelControlClient,
  baseUrl,
  credentialsFromEnv,
  serviceIdFromEnv
} = require('../src/sentinel/ark-citadel-control.cjs');

function headers(cookie = '') {
  return {
    getSetCookie: () => cookie ? [cookie] : [],
    get: () => cookie || null
  };
}

function response(status, body = '', cookie = '') {
  return { status, headers: headers(cookie), text: async () => body };
}

test('Citadel control allowlist contains only lifecycle commands', () => {
  assert.deepEqual([...ALLOWED_COMMANDS].sort(), ['restart', 'start', 'stop']);
  assert.equal(ALLOWED_COMMANDS.has('delete'), false);
});

test('GEN1 retains the verified legacy service id while secondary maps require configuration', () => {
  assert.equal(serviceIdFromEnv('ARK_GEN1', {}), '48289');
  assert.equal(serviceIdFromEnv('ARK_MAP2', { ARK_MAP2_CITADEL_SERVICE_ID: '99881' }), '99881');
  assert.throws(() => serviceIdFromEnv('ARK_MAP2', {}), /service ID is not configured/);
});

test('Citadel credentials can reuse existing per-map SFTP account without exposing it', () => {
  const creds = credentialsFromEnv('ARK_MAP2', { ARK_MAP2_SFTP_USERNAME: 'account', ARK_MAP2_SFTP_PASSWORD: 'secret' });
  assert.deepEqual(creds, { username: 'account', password: 'secret' });
});

test('Citadel base URL requires HTTPS', () => {
  assert.equal(baseUrl({}), 'https://gamecp.citadelservers.com');
  assert.throws(() => baseUrl({ CITADEL_GAMECP_BASE_URL: 'http://example.test' }), /HTTPS/);
});

test('restart authenticates, reads service state, and sends only the typed restart command', async () => {
  const calls = [];
  const loginHtml = '<input name="__RequestVerificationToken" value="login-token"><input name="__encrypted_RequireToken" value="encrypted">';
  const homeHtml = '<input name="__RequestVerificationToken" value="service-token"><div>Status Running</div>';
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: String(options.body || '') });
    if (url.includes('/Login') && !options.method) return response(200, loginHtml, 'anti=one; Path=/');
    if (url.includes('/Login') && options.method === 'POST') return response(302, '', 'auth=two; Path=/');
    if (url.includes('/Service/Home/48289')) return response(200, homeHtml, 'home=three; Path=/');
    if (url.includes('/Service/Command/48289')) return response(302, '', 'cmd=four; Path=/');
    throw new Error(`unexpected URL ${url}`);
  };
  const client = new CitadelControlClient({
    prefix: 'ARK_GEN1',
    env: { ARK_GEN1_SFTP_USERNAME: 'account', ARK_GEN1_SFTP_PASSWORD: 'secret' },
    fetchImpl
  });
  const result = await client.restart();
  assert.equal(result.ok, true);
  assert.equal(result.action, 'restart');
  assert.equal(result.previousState, 'running');
  assert.equal(result.serviceId, '48289');
  assert.equal(calls.at(-1).method, 'POST');
  assert.match(calls.at(-1).body, /Command=restart/);
  assert.equal(calls.some((call) => /secret/.test(call.url)), false);
});

test('unsupported Citadel commands are rejected before any request is made', async () => {
  let called = false;
  const client = new CitadelControlClient({
    prefix: 'ARK_GEN1',
    env: { ARK_GEN1_SFTP_USERNAME: 'account', ARK_GEN1_SFTP_PASSWORD: 'secret' },
    fetchImpl: async () => { called = true; return response(500); }
  });
  await assert.rejects(() => client.command('delete'), /Unsupported Citadel command/);
  assert.equal(called, false);
});
