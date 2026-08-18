'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { helperScript } = require('../main/sentinel-production-update-extension.cjs');

if (process.platform !== 'win32') {
  console.log('Sentinel update helper integration test is Windows-only; skipped.');
  process.exit(0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function waitFor(predicate, timeoutMs = 7000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (predicate()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return false;
}

function runHelper({ root, oldBody, newBody, expectedStatus, expectRollback, recoveredFile }) {
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, 'Khaos Nexus Test.cmd');
  const staged = path.join(root, 'staged Sentinel.cmd');
  const rollback = path.join(root, 'rollback', 'previous Sentinel.cmd');
  const markerPath = path.join(root, 'update state.json');
  const helperPath = path.join(root, 'apply update.ps1');

  fs.writeFileSync(target, oldBody, 'utf8');
  fs.writeFileSync(staged, newBody, 'utf8');
  const marker = {
    format: 'nexus-sentinel-update',
    formatVersion: 1,
    markerPath,
    status: 'prepared',
    oldVersion: '0.33.0',
    newVersion: '0.34.0',
    mode: 'portable',
    oldPid: 999999,
    stagedPath: staged,
    targetPath: target,
    rollbackPath: rollback,
    backupPath: path.join(root, 'pre-update.knbackup'),
    preparedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeJson(markerPath, marker);
  fs.writeFileSync(helperPath, helperScript(marker), 'utf8');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true
  });
  assert(!result.error, `PowerShell helper failed to launch: ${result.error?.message || ''}`);
  assert(result.status === 0, `PowerShell helper exited ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);

  const finalMarker = readJson(markerPath);
  assert(finalMarker.status === expectedStatus, `Expected update marker ${expectedStatus}, got ${finalMarker.status}: ${finalMarker.detail || ''}`);
  assert(fs.existsSync(rollback), 'Rollback snapshot was not created before replacement.');
  const targetBody = fs.readFileSync(target, 'utf8');
  if (expectRollback) {
    assert(targetBody.includes('OLD_SENTINEL_TEST'), 'Failed update did not restore the previous portable executable.');
    assert(waitFor(() => fs.existsSync(recoveredFile)), 'Restored Sentinel target was not relaunched after rollback.');
  } else {
    assert(targetBody.includes('NEW_SENTINEL_HEALTHY'), 'Healthy staged build was not retained after startup acceptance.');
  }
  assert(!fs.existsSync(helperPath), 'Update helper did not remove itself after completion.');
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'Nexus Sentinel Update Integration '));
try {
  const healthyRoot = path.join(base, 'healthy path with spaces');
  const healthyMarkerLiteral = path.join(healthyRoot, 'update state.json').replace(/'/g, "''");
  const healthyNew = `@echo off\r\nrem NEW_SENTINEL_HEALTHY\r\npowershell.exe -NoProfile -Command "$p='${healthyMarkerLiteral}'; $m=Get-Content -LiteralPath $p -Raw ^| ConvertFrom-Json; $m.status='healthy'; $m.updatedAt=[DateTime]::UtcNow.ToString('o'); $m ^| ConvertTo-Json -Depth 12 ^| Set-Content -LiteralPath $p -Encoding UTF8; Start-Sleep -Seconds 4"\r\nexit /b 0\r\n`;
  runHelper({
    root: healthyRoot,
    oldBody: '@echo off\r\nrem OLD_SENTINEL_TEST\r\nexit /b 0\r\n',
    newBody: healthyNew,
    expectedStatus: 'complete',
    expectRollback: false,
    recoveredFile: path.join(healthyRoot, 'unused.txt')
  });

  const failedRoot = path.join(base, 'failed path with spaces');
  const failedMarkerLiteral = path.join(failedRoot, 'update state.json').replace(/'/g, "''");
  const recoveredFile = path.join(failedRoot, 'recovered.txt');
  const recoveredLiteral = recoveredFile.replace(/'/g, "''");
  const oldBody = `@echo off\r\nrem OLD_SENTINEL_TEST\r\npowershell.exe -NoProfile -Command "Set-Content -LiteralPath '${recoveredLiteral}' -Value 'recovered' -Encoding UTF8"\r\nexit /b 0\r\n`;
  const failedNew = `@echo off\r\nrem NEW_SENTINEL_FAILED\r\npowershell.exe -NoProfile -Command "$p='${failedMarkerLiteral}'; $m=Get-Content -LiteralPath $p -Raw ^| ConvertFrom-Json; $m.status='failed'; $m.detail='simulated startup failure'; $m.updatedAt=[DateTime]::UtcNow.ToString('o'); $m ^| ConvertTo-Json -Depth 12 ^| Set-Content -LiteralPath $p -Encoding UTF8"\r\nexit /b 1\r\n`;
  runHelper({
    root: failedRoot,
    oldBody,
    newBody: failedNew,
    expectedStatus: 'rolled-back',
    expectRollback: true,
    recoveredFile
  });

  console.log('Sentinel Windows update helper integration: healthy acceptance PASS');
  console.log('Sentinel Windows update helper integration: automatic rollback PASS');
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
}
