'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  defaultMobileGatewayConfig, normalizeMobileGatewayConfig, createPairingSession, pairingSessionActive,
  verifyPairingCode, consumePairingSession, issueDeviceCredential, verifyDeviceCredential, revokeDevice,
  publicDevice, publicMobileGatewayState, mobileRoleAllows, publicKeyDetails, createPairingRequest,
  verifyClaimSecret, canonicalMobileRequest, verifyMobileRequestSignature
} = require('../shared/mobile-gateway.cjs');

function ecPair() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey: pair.privateKey, publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

test('mobile gateway defaults disabled with HTTPS enforced', () => {
  const config = defaultMobileGatewayConfig();
  assert.equal(config.enabled, false); assert.equal(config.transport, 'https'); assert.equal(config.remoteAccessMode, 'disabled'); assert.equal(config.devices.length, 0);
});

test('gateway normalization clamps unsafe values and removes duplicate devices', () => {
  const config = normalizeMobileGatewayConfig({ enabled: true, port: 80, transport: 'http', remoteAccessMode: 'public-port', devices: [{ id: 'phone-1', name: 'Phone', role: 'operator' }, { id: 'phone-1', name: 'Duplicate', role: 'owner' }] });
  assert.equal(config.port, 43120); assert.equal(config.transport, 'https'); assert.equal(config.remoteAccessMode, 'disabled'); assert.equal(config.devices.length, 1); assert.equal(config.devices[0].role, 'operator');
});

test('pairing codes expire, accept the legacy consume signature, and are single use', () => {
  const now = new Date('2026-07-23T18:00:00.000Z'); const session = createPairingSession({ now, ttlMs: 60000, requestedRole: 'operator' });
  assert.match(session.code, /^\d{6}$/); assert.equal(pairingSessionActive(session, now), true); assert.equal(verifyPairingCode(session, session.code, now), true); assert.equal(pairingSessionActive(session, new Date(now.getTime() + 61000)), false);
  const consumed = consumePairingSession(session, new Date(now.getTime() + 1000)); assert.equal(Boolean(consumed.usedAt), true); assert.equal(pairingSessionActive(consumed, new Date(now.getTime() + 2000)), false);
});

test('P-256 device pairing stores hashed credentials and public state excludes secrets', () => {
  const key = ecPair(); const details = publicKeyDetails(key.publicKeyPem); assert.equal(details.keyAlgorithm, 'EC-P256');
  const issued = issueDeviceCredential({ name: 'Kirito Phone', role: 'owner', publicKeyPem: key.publicKeyPem }, new Date('2026-07-23T18:00:00.000Z'));
  assert.ok(issued.credential.length > 30); assert.notEqual(issued.device.credentialHash, issued.credential); assert.equal(verifyDeviceCredential(issued.device, issued.credential), true); assert.equal(verifyDeviceCredential(issued.device, `${issued.credential}bad`), false);
  issued.device.lastAddress = '192.168.1.99'; const safe = publicDevice(issued.device);
  for (const keyName of ['credentialHash', 'credentialSalt', 'lastAddress', 'publicKeyPem']) assert.equal(keyName in safe, false);
  const payload = publicMobileGatewayState({ enabled: true, devices: [issued.device] }, null, { transportReady: true, certificateFingerprint: 'AA:BB' }); const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes(issued.credential), false); assert.equal(serialized.includes(issued.device.credentialHash), false); assert.equal(serialized.includes('192.168.1.99'), false); assert.equal(payload.transportReady, true);
});

test('pairing claim secret is hashed and request consumes the code', () => {
  const key = ecPair(); const now = new Date('2026-07-23T18:00:00.000Z'); const session = createPairingSession({ now, requestedRole: 'viewer' });
  const created = createPairingRequest(session, { code: session.code, name: 'Asuna Phone', publicKeyPem: key.publicKeyPem }, { now, address: '192.168.1.5' });
  assert.equal(verifyClaimSecret(created.request, created.claimSecret), true); assert.equal(verifyClaimSecret(created.request, `${created.claimSecret}bad`), false); assert.equal(created.consumedSession.pendingRequestId, created.request.id); assert.equal(created.request.address, '192.168.1.5');
});

test('signed mobile requests verify P-256 signatures, timestamps, and exact paths', () => {
  const pair = ecPair(); const issued = issueDeviceCredential({ name: 'Phone', role: 'viewer', publicKeyPem: pair.publicKeyPem }); const timestamp = '1785360000000';
  const input = { method: 'GET', path: '/v1/servers?refresh=1', timestamp, nonce: 'abcdefghijklmnop', body: Buffer.alloc(0) };
  const signature = crypto.sign('sha256', Buffer.from(canonicalMobileRequest(input)), pair.privateKey).toString('base64url');
  assert.equal(verifyMobileRequestSignature(issued.device, { ...input, signature }, Number(timestamp)).ok, true); assert.equal(verifyMobileRequestSignature(issued.device, { ...input, path: '/v1/modules', signature }, Number(timestamp)).ok, false); assert.equal(verifyMobileRequestSignature(issued.device, { ...input, signature }, Number(timestamp) + 10 * 60 * 1000).code, 'TIMESTAMP_INVALID');
});

test('revocation and role boundaries remain immediate', () => {
  const key = ecPair(); const issued = issueDeviceCredential({ name: 'Phone', role: 'operator', publicKeyPem: key.publicKeyPem }); const revoked = revokeDevice(issued.device, new Date('2026-07-23T18:01:00.000Z'));
  assert.equal(verifyDeviceCredential(revoked, issued.credential), false); assert.equal(revoked.enabled, false); assert.equal(mobileRoleAllows('viewer', 'operator'), false); assert.equal(mobileRoleAllows('operator', 'viewer'), true); assert.equal(mobileRoleAllows('operator', 'owner'), false); assert.equal(mobileRoleAllows('owner', 'operator'), true);
});
