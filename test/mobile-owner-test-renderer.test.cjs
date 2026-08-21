'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('ADR-009 owner-test policy visibly wires the Mobile Companion renderer', () => {
  const entry = read('main/entry.cjs');
  const registryExtension = read('main/mobile-module-registry-extension.cjs');
  const hold = read('main/mobile-production-hold-extension.cjs');
  const companion = read('renderer/mobile-companion.js');
  const badge = read('renderer/mobile-owner-test-badge.js');

  // Stable/public builds must still cross the exact Mobile Gateway policy gate.
  assert.match(entry, /mobileGatewayEnabled\s*=\s*mobileHold\.mobileGatewayPolicyEnabled\(\)/);
  assert.match(entry, /if \(mobileGatewayEnabled\) require\('\.\/mobile-module-registry-extension\.cjs'\)\.install\(\)/);
  assert.match(entry, /else mobileHold\.install\(\)/);
  assert.match(hold, /KHAOS_NEXUS_MOBILE_GATEWAY_ENABLED/);
  assert.match(hold, /OWNER_TEST_MARKER/);
  assert.match(hold, /architectureDecision\s*===\s*'ADR-009'/);
  assert.match(hold, /trackingIssue\s*===\s*276/);
  assert.match(hold, /desktopBaseline\s*===\s*'v0\.41\.2-B'/);

  // A green owner-test build is invalid unless the existing companion assets are registered.
  assert.match(registryExtension, /registerRendererBundle/);
  assert.match(registryExtension, /mobile-companion-owner-test/);
  assert.match(registryExtension, /mobile-companion\.css/);
  assert.match(registryExtension, /mobile-companion\.js/);
  assert.match(registryExtension, /mobile-owner-test-badge\.js/);
  assert.match(registryExtension, /registerMobileRenderer\(\)/);

  // The registered renderer must actually expose the Mobile Companion navigation and pairing surface.
  assert.doesNotThrow(() => new Function(companion));
  assert.match(companion, /mobile-companion/);
  assert.match(companion, /view-mobile-companion/);
  assert.match(companion, /Pair Android Device/i);
  assert.match(companion, /Mobile Gateway/i);

  // Human-visible provenance prevents an owner-test installer from silently looking like stable 0.41.2.
  assert.doesNotThrow(() => new Function(badge));
  assert.match(badge, /MOBILE OWNER TEST • ADR-009/);
  assert.match(badge, /khaosMobileOwnerTestBadge/);
});
