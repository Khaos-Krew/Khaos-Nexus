'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { verifyEmbeddedAiSources } = require('../scripts/verify-embedded-ai-sources.cjs');

const root = path.join(__dirname, '..');

test('repository owns complete hash-locked embedded AI source snapshots', () => {
  const verified = verifyEmbeddedAiSources(root);
  assert.deepEqual(verified.map((service) => service.id), ['dnd-ai', 'ai-core']);
  for (const service of verified) {
    assert.ok(service.fileCount > 0);
    assert.ok(service.totalBytes > 0);
    assert.match(service.snapshotSha256, /^[a-f0-9]{64}$/);
  }
});

test('production build paths do not depend on external AI checkouts', () => {
  const builder = fs.readFileSync(path.join(root, 'scripts', 'build-bundled-ai-runtimes.cjs'), 'utf8');
  const materializer = fs.readFileSync(path.join(root, 'scripts', 'materialize-assets.cjs'), 'utf8');
  assert.match(builder, /verifyEmbeddedAiSources/);
  assert.match(builder, /mode:\s*'embedded'/);
  assert.doesNotMatch(builder, /\.ai-sources/);
  assert.match(materializer, /buildBundledAiRuntimes/);
  assert.match(materializer, /prepareApplicationAssets/);
});
