'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('desktop installs the bundled runtime supervisor after AI connection privacy', () => {
  const entry = read('main/entry.cjs');
  const services = entry.indexOf("require('./ai-services-extension.cjs').install()");
  const privacy = entry.indexOf("require('./ai-services-privacy-extension.cjs').install()");
  const bundled = entry.indexOf("require('./bundled-ai-runtimes-extension.cjs').install()");
  const modules = entry.indexOf("require('./module-foundation-extension.cjs').install()");
  assert.ok(services >= 0 && privacy > services && bundled > privacy && modules > bundled);
});

test('bundled services use Electron embedded Node and never require global node or npm', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*'1'/);
  assert.doesNotMatch(source, /where node|npm ci|node\.exe|powershell/i);
  assert.match(source, /windowsHide:\s*true/);
});

test('D&D and AI Core runtimes remain separately addressed and isolated', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /endpoint:\s*'http:\/\/127\.0\.0\.1:8787'/);
  assert.match(source, /core:\s*\{[\s\S]*?endpoint:\s*''[\s\S]*?PORT:\s*'0'/);
  assert.match(source, /return `http:\/\/127\.0\.0\.1:\$\{readiness\.port\}`/);
  assert.match(source, /readiness\.host !== '127\.0\.0\.1'/);
  assert.match(source, /AI_PROVIDER:\s*'mock'/);
  assert.match(source, /AI_PROVIDER:\s*'deterministic-local'/);
  assert.match(source, /CAMPAIGN_STORE:\s*'json'/);
  assert.match(source, /AUTH_REQUIRED:\s*'false'/);
});

test('bundle builder pins exact repositories and snapshots and records file hashes', () => {
  const source = read('scripts/build-bundled-ai-runtimes.cjs');
  assert.match(source, /19c718917377d6148f9baaee8ac8dcb937692f32/);
  assert.match(source, /300c653e5643e0ee2e15590f8cb53e30ee7a79ff/);
  assert.match(source, /bundle-manifest\.json/);
  assert.match(source, /sha256/);
  assert.match(source, /electronRunAsNode:\s*true/);
  assert.match(source, /const excluded = new Set\(\[[^\]]*'\.env'[^\]]*'\.env\.local'[^\]]*\]\)/);
  assert.match(source, /if \(excluded\.has\(entry\.name\)\) continue;/);
  assert.doesNotMatch(source, /copyFileSync\([^\n]*['"]\.env(?:\.local)?['"]/);
});

test('v0.33 freeze adds updater-compatible resources and rollback metadata', () => {
  const source = read('scripts/freeze-v0.33-bundled-ai.cjs');
  assert.match(source, /pkg\.version = '0\.33\.0'/);
  assert.match(source, /publicTag:\s*'v0\.33\.0-B'/);
  assert.match(source, /rollbackTag:\s*'v0\.32\.0-B'/);
  assert.match(source, /extraResources/);
  assert.match(source, /\.runtime\/ai-services/);
});
