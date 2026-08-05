'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { configureBundledAiResources } = require('../scripts/materialize-assets.cjs');
const { verifyPackagedAiRuntimes } = require('../scripts/verify-packaged-ai-runtimes.cjs');

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-ai-package-'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createRuntime(root, serviceId, entry = 'src/index.js') {
  const serviceRoot = path.join(root, serviceId);
  const entryPath = path.join(serviceRoot, entry);
  const content = Buffer.from(`module.exports = '${serviceId}';\n`);
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, content);
  writeJson(path.join(serviceRoot, 'bundle-manifest.json'), {
    schemaVersion: 1,
    id: serviceId,
    version: 'test',
    commit: '0123456789abcdef',
    entry,
    runtime: { electronRunAsNode: true },
    files: [{ path: entry, size: content.length, sha256: digest(content) }]
  });
}

test('asset preparation preserves unrelated resources and omits AI resources when bundles are absent', () => {
  const root = temporaryRoot();
  try {
    writeJson(path.join(root, 'package.json'), {
      build: { extraResources: [{ from: 'assets/help', to: 'help' }, { from: '.runtime/ai-services', to: 'ai-services' }] }
    });
    const result = configureBundledAiResources(root);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(result.status, 'absent');
    assert.deepEqual(pkg.build.extraResources, [{ from: 'assets/help', to: 'help' }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asset preparation automatically includes both complete bundled AI services', () => {
  const root = temporaryRoot();
  try {
    writeJson(path.join(root, 'package.json'), { build: {} });
    const runtimeRoot = path.join(root, '.runtime', 'ai-services');
    createRuntime(runtimeRoot, 'dnd-ai');
    createRuntime(runtimeRoot, 'ai-core', 'src/sidecar.js');
    const result = configureBundledAiResources(root);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(result.status, 'complete');
    assert.deepEqual(pkg.build.extraResources, [
      { from: '.runtime/ai-services', to: 'ai-services', filter: ['**/*'] }
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asset preparation fails instead of silently packaging an incomplete AI runtime directory', () => {
  const root = temporaryRoot();
  try {
    writeJson(path.join(root, 'package.json'), { build: {} });
    createRuntime(path.join(root, '.runtime', 'ai-services'), 'dnd-ai');
    assert.throws(
      () => configureBundledAiResources(root),
      /Bundled AI runtime directory is incomplete.*ai-core/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged AI verifier validates both manifests and every listed file', () => {
  const root = temporaryRoot();
  try {
    createRuntime(root, 'dnd-ai');
    createRuntime(root, 'ai-core', 'src/sidecar.js');
    const result = verifyPackagedAiRuntimes(root);
    assert.deepEqual(result.services.map((service) => service.id), ['dnd-ai', 'ai-core']);
    assert.equal(result.services.every((service) => service.files === 1), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('packaged AI verifier rejects installer contents that differ from the manifest', () => {
  const root = temporaryRoot();
  try {
    createRuntime(root, 'dnd-ai');
    createRuntime(root, 'ai-core', 'src/sidecar.js');
    fs.appendFileSync(path.join(root, 'ai-core', 'src', 'sidecar.js'), '// tampered\n');
    assert.throws(() => verifyPackagedAiRuntimes(root), /size mismatch|hash mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
