'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  sanitizeBundledAiEnvironment,
  fileSize,
  readLatestSidecarDiagnostic
} = require('../main/ai-runtime-environment.cjs');
const {
  bundledAiEntry,
  coreAiEntry,
  guardSpawnOptions,
  attachCoreDiagnostic
} = require('../main/ai-runtime-spawn-boundary.cjs');

test('bundled AI environment drops parent injection and unapproved sidecar overrides', () => {
  const result = sanitizeBundledAiEnvironment({
    SystemRoot: 'C:\\Windows',
    Path: 'C:\\Windows\\System32',
    TEMP: 'C:\\Temp',
    NODE_OPTIONS: '--require C:\\malicious.cjs',
    NODE_PATH: 'C:\\unexpected-modules',
    NEXUS_AI_CORE_PARENT_CHECK_INTERVAL_MS: 'not-a-number',
    RATE_LIMIT_PER_MINUTE: 'broken',
    OPENAI_API_KEY: 'must-not-leak',
    HOST: '127.0.0.1',
    PORT: '0',
    AI_PROVIDER: 'deterministic-local',
    DATA_DIR: 'C:\\Users\\Owner\\AppData\\Roaming\\Khaos Nexus\\ai-services\\ai-core',
    KHAOS_NEXUS_BUNDLED_SERVICE: '1',
    NEXUS_AI_CORE_SERVICE_TOKEN: '0123456789abcdefghijklmnopqrstuvwxyz',
    NEXUS_AI_CORE_STARTUP_NONCE: 'safe-nonce',
    NEXUS_AI_CORE_PARENT_PID: '1234'
  });

  assert.equal(result.SystemRoot, 'C:\\Windows');
  assert.equal(result.Path, 'C:\\Windows\\System32');
  assert.equal(result.HOST, '127.0.0.1');
  assert.equal(result.PORT, '0');
  assert.equal(result.AI_PROVIDER, 'deterministic-local');
  assert.equal(result.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.KHAOS_NEXUS_BUNDLED_SERVICE, '1');
  assert.equal(result.NODE_OPTIONS, undefined);
  assert.equal(result.NODE_PATH, undefined);
  assert.equal(result.NEXUS_AI_CORE_PARENT_CHECK_INTERVAL_MS, undefined);
  assert.equal(result.RATE_LIMIT_PER_MINUTE, undefined);
  assert.equal(result.OPENAI_API_KEY, undefined);
});

test('spawn boundary only rewrites Electron embedded AI sidecars', () => {
  const entry = 'C:\\Program Files\\Khaos Nexus\\resources\\ai-services\\ai-core\\src\\sidecar.js';
  const options = {
    env: {
      KHAOS_NEXUS_BUNDLED_SERVICE: '1',
      DATA_DIR: 'C:\\Temp\\ai-core',
      NODE_OPTIONS: '--inspect',
      HOST: '127.0.0.1',
      PORT: '0'
    }
  };

  assert.equal(bundledAiEntry([entry], options), true);
  assert.equal(coreAiEntry([entry], options), true);
  const guarded = guardSpawnOptions(process.execPath, [entry], options);
  assert.notEqual(guarded, options);
  assert.equal(guarded.env.NODE_OPTIONS, undefined);
  assert.equal(guarded.env.NODE_ENV, 'production');

  const ordinary = { env: { NODE_OPTIONS: '--inspect' } };
  assert.equal(guardSpawnOptions('other.exe', ['script.js'], ordinary), ordinary);
});

test('diagnostic reader ignores stale launches and returns the current structured failure', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-ai-diagnostic-'));
  const logPath = path.join(directory, 'service.log');
  fs.writeFileSync(logPath, '{"event":"nexus-ai-core.sidecar-startup-error","code":"STALE","exitCode":70}\n');
  const offset = fileSize(logPath);
  fs.appendFileSync(logPath, '{"event":"nexus-ai-core.sidecar-startup-error","code":"SIDECAR_SERVICE_TOKEN_REQUIRED","exitCode":64}\n');

  assert.deepEqual(readLatestSidecarDiagnostic(logPath, offset), {
    event: 'nexus-ai-core.sidecar-startup-error',
    code: 'SIDECAR_SERVICE_TOKEN_REQUIRED',
    exitCode: 64
  });
  fs.rmSync(directory, { recursive: true, force: true });
});

test('AI Core close converts the current structured diagnostic into the runtime error channel', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-ai-close-'));
  const logPath = path.join(directory, 'service.log');
  fs.writeFileSync(logPath, 'previous run\n');
  const context = { logPath, startOffset: fileSize(logPath) };
  fs.appendFileSync(logPath, '{"event":"nexus-ai-core.sidecar-startup-error","code":"SIDECAR_PORT_INVALID","exitCode":64}\n');

  const child = new EventEmitter();
  let observed = null;
  child.once('error', (error) => { observed = error; });
  attachCoreDiagnostic(child, context);
  child.emit('close', 64);

  assert.ok(observed);
  assert.equal(observed.code, 'SIDECAR_PORT_INVALID');
  assert.equal(observed.exitCode, 64);
  assert.match(observed.message, /Nexus AI Core startup failed/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('entry installs the spawn boundary before loading the bundled runtime supervisor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  const boundary = source.indexOf("require('./ai-runtime-spawn-boundary.cjs').install()");
  const runtime = source.indexOf("require('./bundled-ai-runtimes-extension.cjs').install()");
  assert.ok(boundary >= 0 && runtime > boundary);
});
