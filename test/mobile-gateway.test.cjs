'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultMobileGatewayConfig,
  normalizeMobileGatewayConfig,
  createPairingSession,
  pairingSessionActive,
  verifyPairingCode,
  consumePairingSession,
  issueDeviceCredential,
  verifyDeviceCredential,
  revokeDevice,
  publicDevice,
  publicMobileGatewayState,
  mobileRoleAllows
} = require('../shared/mobile-gateway.cjs');

test('mobile gateway defaults disabled with HTTPS required', () => {
  const config = defaultMobileGatewayConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.transport, 'https-required');
  assert.equal(config.remoteAccessMode, 'disabled');
  assert.equal(config.devices.length, 0);
});

test('gateway normalization clamps unsafe values and removes duplicate devices', () => {
  const config = normalizeMobileGatewayConfig({
    enabled: true,
    port: 80,
    transport: 'http',
    remoteAccessMode: 'public-port',
    devices: [
      { id: 'phone-1', name: 'Phone', role: 'operator' },
      { id: 'phone-1', name: 'Duplicate', role: 'owner' }
    ]
  });
  assert.equal(config.port, 43120);
  assert.equal(config.transport, 'https-required');
  assert.equal(config.remoteAccessMode, 'disabled');
  assert.equal(config.devices.length, 1);
  assert.equal(config.devices[0].role, 'operator');
});

test('pairing codes expire and are single use', () => {
  const now = new Date('2026-07-23T18:00:00.000Z');
  const session = createPairingSession({ now, ttlMs: 60000, requestedRole: 'operator' });
  assert.match(session.code, /^\d{6}$/);
  assert.equal(pairingSessionActive(session, now), true);
  assert.equal(verifyPairingCode(session, session.code, now), true);
  assert.equal(verifyPairingCode(session, '000000', now), session.code === '000000');
  assert.equal(pairingSessionActive(session, new Date(now.getTime() + 61000)), false);
  const consumed = consumePairingSession(session, new Date(now.getTime() + 1000));
  assert.equal(Boolean(consumed.usedAt), true);
  assert.equal(pairingSessionActive(consumed, new Date(now.getTime() + 2000)), false);
});

test('device credentials are hashed and can be revoked', () => {
  const issued = issueDeviceCredential({ name: 'Kirito Phone', role: 'owner', publicKeyFingerprint: 'AA:BB:CC' }, new Date('2026-07-23T18:00:00.000Z'));
  assert.ok(issued.credential.length > 30);
  assert.notEqual(issued.device.credentialHash, issued.credential);
  assert.equal(verifyDeviceCredential(issued.device, issued.credential), true);
  assert.equal(verifyDeviceCredential(issued.device, `${issued.credential}bad`), false);
  const revoked = revokeDevice(issued.device, new Date('2026-07-23T18:01:00.000Z'));
  assert.equal(verifyDeviceCredential(revoked, issued.credential), false);
  assert.equal(revoked.enabled, false);
  assert.ok(revoked.revokedAt);
});

test('public mobile state never exposes credential hashes, salts, or last address', () => {
  const issued = issueDeviceCredential({ name: 'Asuna Phone', role: 'operator' });
  issued.device.lastAddress = '192.168.1.99';
  const safe = publicDevice(issued.device);
  assert.equal('credentialHash' in safe, false);
  assert.equal('credentialSalt' in safe, false);
  assert.equal('lastAddress' in safe, false);
  const payload = publicMobileGatewayState({ enabled: false, devices: [issued.device] });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(issued.device.credentialHash), false);
  assert.equal(serialized.includes(issued.device.credentialSalt), false);
  assert.equal(serialized.includes('192.168.1.99'), false);
  assert.equal(payload.transportReady, false);
});

test('mobile roles preserve viewer, operator, and owner boundaries', () => {
  assert.equal(mobileRoleAllows('viewer', 'viewer'), true);
  assert.equal(mobileRoleAllows('viewer', 'operator'), false);
  assert.equal(mobileRoleAllows('operator', 'viewer'), true);
  assert.equal(mobileRoleAllows('operator', 'owner'), false);
  assert.equal(mobileRoleAllows('owner', 'operator'), true);
});
