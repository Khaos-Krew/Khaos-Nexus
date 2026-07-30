'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('validated Mobile Gateway is promoted before module consumers capture registry functions', () => {
  const entry = read('main/entry.cjs');
  const promotion = entry.indexOf("require('./mobile-module-registry-extension.cjs').install()");
  const foundation = entry.indexOf("require('./module-foundation-extension.cjs').install()");
  const gateway = entry.indexOf("require('./mobile-gateway-extension.cjs').install()");
  const security = entry.indexOf("require('./mobile-gateway-security-extension.cjs').install()");
  assert.ok(promotion >= 0 && promotion < foundation);
  assert.ok(gateway > foundation);
  assert.ok(security > gateway);
});

test('mobile module promotion declares the HTTPS read-only implementation', () => {
  const patch = require('../main/mobile-module-registry-extension.cjs');
  const mobile = patch.promote({ id: 'mobile-gateway', stage: 'foundation', availability: 'partial' });
  assert.equal(mobile.stage, 'live');
  assert.equal(mobile.availability, 'implemented');
  assert.match(mobile.description, /HTTPS Android companion gateway/i);
  assert.ok(mobile.features.includes('P-256 signed requests'));
  assert.ok(mobile.features.includes('Immediate revocation'));
});

test('desktop pairing state is Owner-only and approved credentials are delivered once', () => {
  const source = read('main/mobile-gateway-security-extension.cjs');
  assert.match(source, /channel !== 'mobile-gateway:get'/);
  assert.match(source, /assertAccess\([^\n]+\s*'owner'/);
  assert.match(source, /pendingPairing = \{ \.\.\.this\.pendingPairing, deliveredAt \}/);
  assert.match(source, /this\.delivery = null/);
  assert.match(source, /response\.statusCode === 200/);
});

test('desktop HTTPS gateway has bounded read-only routes and replay protection', () => {
  const source = read('main/services/mobile-gateway-service.cjs');
  assert.match(source, /minVersion: 'TLSv1\.2'/);
  assert.match(source, /MAX_REQUEST_BODY_BYTES/);
  assert.match(source, /REPLAY_DETECTED/);
  assert.match(source, /DEVICE_RATE_LIMIT/);
  assert.match(source, /\/v1\/dashboard/);
  assert.match(source, /\/v1\/servers/);
  assert.match(source, /\/v1\/modules/);
  assert.match(source, /\/v1\/logs/);
  assert.match(source, /\/v1\/status-panels/);
  assert.doesNotMatch(source, /server:(save|kick|ban|shutdown)|bot:(start|stop|restart)/);
});

test('Android owner-test source enforces pinning, Keystore storage, cleartext blocking and screenshot blocking', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const network = read('android/app/src/main/res/xml/network_security_config.xml');
  const activity = read('android/app/src/main/java/com/khaosnexus/mobile/MainActivity.kt');
  const store = read('android/app/src/main/java/com/khaosnexus/mobile/data/SecureStore.kt');
  const client = read('android/app/src/main/java/com/khaosnexus/mobile/network/MobileGatewayClient.kt');
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(network, /cleartextTrafficPermitted="false"/);
  assert.match(activity, /FLAG_SECURE/);
  assert.match(store, /AndroidKeyStore/);
  assert.match(store, /AES\/GCM\/NoPadding/);
  assert.match(store, /secp256r1/);
  assert.match(client, /pinnedSslSocketFactory/);
  assert.match(client, /X-Khaos-Signature/);
  assert.match(client, /X-Khaos-Nonce/);
});
