'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'src/renderer/admin-ops-ui.js'), 'utf8');

test('Discord Admin scan treats completed acceptance findings as audit results instead of operation errors', () => {
  assert.match(source, /allowFindings === true/);
  assert.match(source, /result\?\.sections && typeof result\.sections === 'object'/);
  assert.match(source, /api\.sentinalScan\(\), '', \{ allowFindings: true \}/);
  assert.match(source, /Scan completed — attention needed/);
  assert.match(source, /No repair was applied/);
});

test('Discord Admin renders hidden rank discovery and hosted provider acceptance sections', () => {
  assert.match(source, /sections\.rankDiscovery/);
  assert.match(source, /sections\.providerConfig/);
  assert.match(source, /Rank \/ SKU discovery/);
  assert.match(source, /Hosted provider configuration/);
  assert.match(source, /acceptanceFindings\(sections\)/);
});

test('Discord Admin still treats transport and mutation failures as errors', () => {
  assert.match(source, /if \(result\?\.ok === false && !completedAudit\) throw new Error/);
  assert.match(source, /api\.sentinalRepair\(\), 'Nexus repair sequence completed\.'/);
});
