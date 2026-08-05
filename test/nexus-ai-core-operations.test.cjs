'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('AI Core is packaged through the validated sidecar entrypoint', () => {
  const source = read('scripts/build-bundled-ai-runtimes.cjs');
  assert.match(source, /id:\s*'ai-core'[\s\S]*entry:\s*'src\/sidecar\.js'/);
  assert.match(source, /300c653e5643e0ee2e15590f8cb53e30ee7a79ff/);
});

test('AI Core sidecar uses dynamic loopback port, per-launch secrets, and IPC shutdown', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /PORT:\s*'0'/);
  assert.match(source, /crypto\.randomBytes\(48\)/);
  assert.match(source, /NEXUS_AI_CORE_SERVICE_TOKEN/);
  assert.match(source, /NEXUS_AI_CORE_STARTUP_NONCE/);
  assert.match(source, /NEXUS_AI_CORE_PARENT_PID/);
  assert.match(source, /stdio:\s*key === 'core' \? \['ignore', descriptor, descriptor, 'ipc'\]/);
  assert.match(source, /closeDescriptor\(descriptor\)/);
  assert.match(source, /nexus-ai-core\.shutdown/);
  assert.doesNotMatch(source, /\/shutdown|http[^\n]*shutdown/i);
});

test('readiness enforces contracts, authority boundaries, and D&D isolation', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /startupNonce !== nonce/);
  assert.match(source, /serviceVersion !== '0\.7\.0'/);
  assert.match(source, /apiVersion !== 'v1'/);
  assert.match(source, /directExecution !== false/);
  assert.match(source, /directDiscordConnection !== false/);
  assert.match(source, /directDndCallsAllowed !== false/);
  assert.match(source, /schedulerOwnedExternally !== true/);
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
