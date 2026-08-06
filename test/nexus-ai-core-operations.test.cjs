'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const readJson = (file) => JSON.parse(read(file));

test('AI Core is packaged from the pinned embedded source through the validated sidecar entrypoint', () => {
  const config = readJson('config/embedded-ai-sources.json');
  const service = config.services.find((candidate) => candidate.id === 'ai-core');
  assert.ok(service, 'AI Core must remain in the authoritative embedded source configuration.');
  assert.equal(service.repository, 'Khaos-Krew/Khaos-Nexus-AI-Core');
  assert.equal(service.commit, '300c653e5643e0ee2e15590f8cb53e30ee7a79ff');
  assert.equal(service.version, '0.7.0');
  assert.equal(service.entry, 'src/sidecar.js');
  assert.equal(service.directory, 'packages/ai/ai-core');

  const builder = read('scripts/build-bundled-ai-runtimes.cjs');
  assert.match(builder, /loadConfig/);
  assert.match(builder, /verifyEmbeddedAiSources/);
  assert.match(builder, /source:\s*safeTarget\(rootDirectory, service\.directory\)/);
  assert.match(builder, /entry:\s*assignment\.entry/);
  assert.match(builder, /mode:\s*'embedded'/);
  assert.doesNotMatch(builder, /\.ai-sources/);
});

test('Nexus Sentinel worker uses dynamic loopback port, per-launch secrets, and IPC shutdown', () => {
  const supervisor = read('main/bundled-ai-runtimes-extension.cjs');
  const host = read('main/ai-runtime-host.cjs');
  const contract = read('main/ai-runtime-contract.cjs');
  assert.match(contract, /PORT:\s*'0'/);
  assert.match(supervisor, /crypto\.randomBytes\(48\)/);
  assert.match(host, /NEXUS_AI_CORE_SERVICE_TOKEN/);
  assert.match(host, /NEXUS_AI_CORE_STARTUP_NONCE/);
  assert.match(host, /NEXUS_AI_CORE_PARENT_PID/);
  assert.match(host, /stdio:\s*\['ignore', descriptor, descriptor, 'ipc'\]/);
  assert.match(host, /closeDescriptor\(descriptor\)/);
  assert.match(host, /nexus-ai-core\.shutdown/);
  assert.doesNotMatch(host, /\/shutdown|http[^\n]*shutdown/i);
});

test('readiness enforces the exact pinned contract, authority boundaries, and D&D isolation', () => {
  const source = read('main/ai-runtime-contract.cjs');
  assert.match(source, /startupNonce !== nonce/);
  assert.match(source, /serviceVersion !== '0\.7\.0'/);
  assert.match(source, /apiVersion !== '1'/);
  assert.match(source, /targetService !== 'nexus-ai-core'/);
  assert.match(source, /directExecution !== false/);
  assert.match(source, /directDiscordConnection !== false/);
  assert.match(source, /directDndCallsAllowed !== false/);
  assert.match(source, /schedulerOwnedExternally !== true/);
});

test('operations use the pinned API envelope instead of obsolete identifiers', () => {
  const source = read('main/nexus-ai-core-operations-extension.cjs');
  assert.match(source, /apiVersion:\s*'1'/);
  assert.match(source, /targetService:\s*'nexus-ai-core'/);
  assert.match(source, /health\.apiVersion !== '1'/);
  assert.match(source, /health\.targetService !== 'nexus-ai-core'/);
  assert.doesNotMatch(source, /apiVersion:\s*'v1'/);
  assert.doesNotMatch(source, /targetService:\s*'khaos-nexus'/);
});

test('operational bridge keeps tokens in main process and maintenance advisory-only', () => {
  const source = read('main/nexus-ai-core-operations-extension.cjs');
  assert.match(source, /Authorization:\s*`Bearer \$\{serviceToken\}`/);
  assert.match(source, /visibility:\s*'ephemeral'/);
  assert.match(source, /executionAllowed:\s*false/);
  assert.match(source, /@everyone\|@here/);
  assert.doesNotMatch(source, /webContents\.send\([^\n]*serviceToken|return\s*\{[^\n]*serviceToken/);
});

test('entry installs operations only after the bundled runtime supervisor', () => {
  const entry = read('main/entry.cjs');
  const bundled = entry.indexOf("require('./bundled-ai-runtimes-extension.cjs').install()");
  const operations = entry.indexOf("require('./nexus-ai-core-operations-extension.cjs').install()");
  const modules = entry.indexOf("require('./module-foundation-extension.cjs').install()");
  assert.ok(bundled >= 0 && operations > bundled && modules > operations);
});
