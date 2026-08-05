'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sourceFor, syncEmbeddedAiSources } = require('../scripts/sync-embedded-ai-sources.cjs');
const { verifyEmbeddedAiSources } = require('../scripts/verify-embedded-ai-sources.cjs');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function createSource(root, id, version, entry) {
  const source = path.join(root, '.vendor', id);
  writeJson(path.join(source, 'package.json'), { name: id, version, type: 'module' });
  const entryPath = path.join(source, entry);
  fs.mkdirSync(path.dirname(entryPath), { recursive: true });
  fs.writeFileSync(entryPath, `export const id = '${id}';\n`);
  fs.mkdirSync(path.join(source, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(source, 'tests', 'ignored.test.js'), 'throw new Error("must not be copied");\n');
  return source;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-embedded-ai-'));
  writeJson(path.join(root, 'config', 'embedded-ai-sources.json'), {
    schemaVersion: 1,
    services: [
      {
        id: 'dnd-ai',
        directory: 'packages/ai/dnd-ai',
        repository: 'Khaos-Krew/Khaos-Nexus-AI',
        commit: '1111111111111111111111111111111111111111',
        version: '1.2.3',
        entry: 'src/index.js',
        sourceEnvironment: 'KHAOS_DND_AI_SOURCE'
      },
      {
        id: 'ai-core',
        directory: 'packages/ai/ai-core',
        repository: 'Khaos-Krew/Khaos-Nexus-AI-Core',
        commit: '2222222222222222222222222222222222222222',
        version: '4.5.6',
        entry: 'src/sidecar.js',
        sourceEnvironment: 'KHAOS_AI_CORE_SOURCE'
      }
    ]
  });
  createSource(root, 'dnd-ai', '1.2.3', 'src/index.js');
  createSource(root, 'ai-core', '4.5.6', 'src/sidecar.js');
  return root;
}

test('synchronization creates deterministic verified source snapshots without isolated test trees', () => {
  const root = createFixture();
  try {
    const lock = syncEmbeddedAiSources(root, {});
    assert.equal(lock.services.length, 2);
    assert.equal(fs.existsSync(path.join(root, 'packages', 'ai', 'dnd-ai', 'tests')), false);
    assert.equal(fs.existsSync(path.join(root, 'packages', 'ai', 'ai-core', 'tests')), false);
    const verified = verifyEmbeddedAiSources(root);
    assert.deepEqual(verified.map((service) => service.id), ['dnd-ai', 'ai-core']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verification rejects source drift after synchronization', () => {
  const root = createFixture();
  try {
    syncEmbeddedAiSources(root, {});
    fs.appendFileSync(path.join(root, 'packages', 'ai', 'dnd-ai', 'src', 'index.js'), '// tampered\n');
    assert.throws(() => verifyEmbeddedAiSources(root), /snapshot integrity mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('external source overrides require an explicit isolated-test gate', () => {
  const root = createFixture();
  try {
    const service = {
      id: 'dnd-ai',
      sourceEnvironment: 'KHAOS_DND_AI_SOURCE'
    };
    assert.throws(
      () => sourceFor(root, service, { KHAOS_DND_AI_SOURCE: '/tmp/example' }),
      /KHAOS_ALLOW_EXTERNAL_AI_SOURCE=1/
    );
    assert.equal(
      sourceFor(root, service, {
        KHAOS_DND_AI_SOURCE: '/tmp/example',
        KHAOS_ALLOW_EXTERNAL_AI_SOURCE: '1'
      }),
      path.resolve('/tmp/example')
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
