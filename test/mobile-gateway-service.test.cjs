'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const { MobileGatewayService } = require('../main/services/mobile-gateway-service.cjs');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function requestJson(port, route) {
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: '127.0.0.1', port, path: route, method: 'GET', rejectUnauthorized: false, timeout: 5000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

test('Mobile Gateway generates TLS, serves HTTPS health, creates QR pairing, and shuts down cleanly', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-mobile-gateway-'));
  const port = await unusedPort();
  const config = {
    enabled: true,
    port,
    transport: 'https',
    remoteAccessMode: 'private-network',
    allowLanPairing: true,
    requireBiometricForOwnerActions: true,
    devices: []
  };
  const configStore = {
    getMobileGateway: () => JSON.parse(JSON.stringify(config)),
    getRuntimeBootstrap: () => ({ config: { moduleRuntime: { 'mobile-gateway': { effectiveEnabled: true } }, servers: [] } }),
    getSecretValues: () => ['desktop-secret-that-must-never-leak'],
    getConfig: () => ({ general: { moduleMigration: {} } }),
    getStatusPanels: () => ({ panels: [] })
  };
  const service = new MobileGatewayService({
    dataDirectory: directory,
    configStore,
    logger: { info() {}, warn() {}, error() {}, recent: () => [] },
    supervisor: { getState: () => ({ status: 'online', ready: { username: 'Nexus Bot' } }) },
    updateService: { getState: () => ({ status: 'idle', currentVersion: '0.22.0' }) },
    autonomy: { getState: () => ({ serverHealth: {}, attention: [] }) },
    appVersion: '0.22.0-test',
    osModule: { networkInterfaces: () => ({ Ethernet: [{ family: 'IPv4', internal: false, address: '192.0.2.10' }] }) }
  });
  t.after(async () => {
    await service.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const state = await service.start();
  assert.equal(state.transportReady, true);
  assert.match(state.certificateFingerprint, /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.ok(fs.statSync(path.join(directory, 'mobile-gateway', 'tls', 'certificate.pem')).size > 500);
  assert.ok(fs.statSync(path.join(directory, 'mobile-gateway', 'tls', 'private-key.pem')).size > 500);

  const health = await requestJson(port, '/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.service, 'Khaos Nexus Mobile Gateway');
  assert.equal(health.body.certificateFingerprint, state.certificateFingerprint);

  const paired = await service.createPairing('viewer');
  assert.match(paired.pairingSession.code, /^\d{6}$/);
  assert.match(paired.pairingUri, /^khaosnexus:\/\/pair\?/);
  assert.match(paired.qrDataUrl, /^data:image\/png;base64,/);
  const serialized = JSON.stringify(paired);
  assert.equal(serialized.includes('desktop-secret-that-must-never-leak'), false);

  await service.stop('test-complete');
  assert.equal(service.publicState().transportReady, false);
  await assert.rejects(() => requestJson(port, '/v1/health'));
});
