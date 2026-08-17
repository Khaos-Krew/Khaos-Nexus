'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('desktop installs the runtime boundary and unified host after AI connection privacy', () => {
  const entry = read('main/entry.cjs');
  const services = entry.indexOf("require('./ai-services-extension.cjs').install()");
  const privacy = entry.indexOf("require('./ai-services-privacy-extension.cjs').install()");
  const boundary = entry.indexOf("require('./ai-runtime-spawn-boundary.cjs').install()");
  const bundled = entry.indexOf("require('./bundled-ai-runtimes-extension.cjs').install()");
  const modules = entry.indexOf("require('./module-foundation-extension.cjs').install()");
  assert.ok(services >= 0 && privacy > services && boundary > privacy && bundled > boundary && modules > bundled);
});

test('Electron starts one Khaos Nexus AI Runtime host instead of two top-level sidecars', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /ai-runtime-host\.cjs/);
  assert.match(source, /spawn\(process\.execPath, \[hostEntry\]/);
  assert.match(source, /KHAOS_NEXUS_BUNDLED_SERVICE:\s*'1'/);
  assert.match(source, /ELECTRON_RUN_AS_NODE:\s*'1'/);
  assert.doesNotMatch(source, /spawn\(process\.execPath, \[bundle\.entry\]/);
  assert.doesNotMatch(source, /where node|npm ci|node\.exe|powershell/i);
});

test('runtime host supervises Veyra and Nexus Sentinel as separate worker processes', () => {
  const host = read('main/ai-runtime-host.cjs');
  const contract = read('main/ai-runtime-contract.cjs');
  assert.match(contract, /name:\s*'Veyra'/);
  assert.match(contract, /title:\s*'D&D Lorewarden and Co-DM'/);
  assert.match(contract, /name:\s*'Nexus Sentinel'/);
  assert.match(contract, /title:\s*'System Health and Assistance AI'/);
  assert.match(host, /spawn\(process\.execPath, \[launcherPath, key, config\.entry\]/);
  assert.match(host, /Object\.keys\(AGENTS\)/);
  assert.match(host, /waitForVeyra/);
  assert.match(host, /validateCoreReadiness/);
  assert.match(host, /restartAgent/);
});

test('agent workers retain separate endpoint, data, environment, and authority contracts', () => {
  const contract = read('main/ai-runtime-contract.cjs');
  const host = read('main/ai-runtime-host.cjs');
  const supervisor = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(contract, /endpoint:\s*'http:\/\/127\.0\.0\.1:8787'/);
  assert.match(contract, /PORT:\s*'0'/);
  assert.match(contract, /AI_PROVIDER:\s*'mock'/);
  assert.match(contract, /AI_PROVIDER:\s*'deterministic-local'/);
  assert.match(contract, /CAMPAIGN_STORE:\s*'json'/);
  assert.match(contract, /AUTH_REQUIRED:\s*'false'/);
  assert.match(supervisor, /path\.join\(dataRoot\(\), AGENTS\.core\.id\)/);
  assert.match(supervisor, /path\.join\(dataRoot\(\), AGENTS\.dnd\.id\)/);
  assert.match(host, /nodeEnv:\s*key === 'dnd' \? 'development' : 'production'/);
  assert.match(contract, /directDndCallsAllowed !== false/);
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

test('v0.33 freeze retains updater-compatible resources and rollback metadata', (t) => {
  const freezePath = path.join(root, 'scripts', 'freeze-v0.33-bundled-ai.cjs');
  if (!fs.existsSync(freezePath)) {
    t.skip('Historical v0.33 Nexus freeze script is not part of the standalone product branch.');
    return;
  }
  const source = read('scripts/freeze-v0.33-bundled-ai.cjs');
  assert.match(source, /pkg\.version = '0\.33\.0'/);
  assert.match(source, /publicTag:\s*'v0\.33\.0-B'/);
  assert.match(source, /rollbackTag:\s*'v0\.32\.0-B'/);
  assert.match(source, /extraResources/);
  assert.match(source, /\.runtime\/ai-services/);
});

test('host and workers use exact-child exit promises with forced termination fallbacks', () => {
  const supervisor = read('main/bundled-ai-runtimes-extension.cjs');
  const host = read('main/ai-runtime-host.cjs');
  assert.match(supervisor, /hostExitPromise/);
  assert.match(supervisor, /child\.kill\('SIGKILL'\)/);
  assert.match(supervisor, /AI_RUNTIME_STOP_TIMEOUT/);
  assert.match(host, /value\.exitPromise/);
  assert.match(host, /childAlive\(value, child\)/);
  assert.match(host, /child\.kill\('SIGKILL'\)/);
  assert.match(host, /AI_AGENT_STOP_TIMEOUT/);
  assert.doesNotMatch(supervisor, /child\.killed/);
  assert.doesNotMatch(host, /child\.killed/);
});

test('Veyra readiness is launch-scoped and cannot be satisfied by a stale process on port 8787', () => {
  const host = read('main/ai-runtime-host.cjs');
  assert.match(host, /logStartOffset:\s*fileSize\(config\.logPath\)/);
  assert.match(host, /launchLogEvents\(value\.config\.logPath, value\.logStartOffset \|\| 0\)/);
  assert.match(host, /event\?\.event === 'service\.listening'/);
  assert.match(host, /Veyra has not emitted a launch-scoped listening event/);
});

test('runtime startup closes parent log descriptors and bounds both agent readiness checks', () => {
  const supervisor = read('main/bundled-ai-runtimes-extension.cjs');
  const host = read('main/ai-runtime-host.cjs');
  assert.match(supervisor, /fs\.closeSync\(descriptor\)/);
  assert.match(host, /fs\.closeSync\(descriptor\)/);
  assert.match(host, /READY_TIMEOUT_MS = 15000/);
  assert.match(host, /Veyra did not report readiness before the startup timeout/);
  assert.match(host, /Nexus Sentinel did not report readiness before the startup timeout/);
  assert.match(host, /readyTimer\.unref/);
});

test('manual lifecycle controls require Owner access and preserve compatibility channels', () => {
  const source = read('main/bundled-ai-runtimes-extension.cjs');
  assert.match(source, /assertAccess\(refs\.discordAuth\?\.getState\?\.\(\), 'owner', action\)/);
  assert.match(source, /appendAiServiceAudit/);
  assert.match(source, /runtime\.\$\{action\}/);
  for (const channel of ['ai:runtimes-status', 'ai:runtimes-start', 'ai:runtimes-stop', 'ai:runtimes-restart']) {
    assert.match(source, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('bulk worker operations isolate failures inside the unified host', () => {
  const source = read('main/ai-runtime-host.cjs');
  assert.match(source, /function startAll\(\)[\s\S]*?try \{ return startAgent\(key\); \}[\s\S]*?catch \(error\)/);
  assert.match(source, /async function stopAll\(options = \{\}\)/);
  assert.match(source, /async function restartAll\(\)/);
  assert.match(source, /return recordFailure\(key, error\)/);
});

test('Nexus operations consume the private supervised connection without exporting its token', () => {
  const operations = read('main/nexus-ai-core-operations-extension.cjs');
  const supervisor = read('main/bundled-ai-runtimes-extension.cjs');
  const bot = read('bot/nexus-ai-index.cjs');
  const renderer = read('renderer/nexus-ai-operations.js');
  assert.match(operations, /runtimes\.coreConnection\(\)/);
  assert.match(operations, /Authorization:\s*`Bearer \$\{serviceToken\}`/);
  assert.match(supervisor, /coreServiceToken/);
  assert.doesNotMatch(bot, /serviceToken|NEXUS_AI_CORE_SERVICE_TOKEN|Authorization:\s*`Bearer/);
  assert.doesNotMatch(renderer, /serviceToken|NEXUS_AI_CORE_SERVICE_TOKEN|Authorization:\s*`Bearer/);
});