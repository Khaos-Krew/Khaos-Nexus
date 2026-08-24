'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function normalizeAsarEntry(value) {
  const raw = String(value || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  return `/${raw.replace(/^\/+/, '')}`;
}

function parseAsarList(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map(normalizeAsarEntry)
    .filter(Boolean);
}

const REQUIRED_ENTRIES = Object.freeze([
  '/package.json',
  '/config.example.json',
  '/src/main-entry.cjs',
  '/src/main.cjs',
  '/src/preload.cjs',
  '/src/renderer/index.html'
]);

const FORBIDDEN_PREFIXES = Object.freeze([
  '/.github',
  '/tests',
  '/scripts',
  '/node_modules/electron/',
  '/node_modules/electron-builder/'
]);

function looksSecretBearing(entry) {
  const lower = normalizeAsarEntry(entry).toLowerCase();
  if (!lower) return false;
  const base = path.posix.basename(lower);
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (base === 'secrets.bin' || base === 'credentials.json' || base === 'credentials.bin') return true;
  if (base === 'config.json' || base === 'config.local.json') return true;
  return /\/(secret|credential|token)s?\.(json|txt|bin|pem|pfx|p12)$/.test(lower);
}

function auditAsarEntries(entries = []) {
  const normalized = [...new Set(entries.map(normalizeAsarEntry).filter(Boolean))].sort();
  const set = new Set(normalized);
  const missingRequired = REQUIRED_ENTRIES.filter((entry) => !set.has(entry));
  const forbidden = normalized.filter((entry) => FORBIDDEN_PREFIXES.some((prefix) => entry === prefix || entry.startsWith(prefix)));
  const secretBearing = normalized.filter(looksSecretBearing);
  const topLevelNodeModules = [...new Set(normalized
    .filter((entry) => entry.startsWith('/node_modules/'))
    .map((entry) => {
      const parts = entry.split('/').filter(Boolean);
      if (parts[1]?.startsWith('@')) return `${parts[1]}/${parts[2] || ''}`;
      return parts[1] || '';
    })
    .filter(Boolean))].sort();
  return {
    ok: missingRequired.length === 0 && forbidden.length === 0 && secretBearing.length === 0,
    fileCount: normalized.length,
    missingRequired,
    forbidden,
    secretBearing,
    topLevelNodeModules
  };
}

function auditWindowsPackage({ root = process.cwd(), distDir = 'dist' } = {}) {
  const dist = path.resolve(root, distDir);
  const asarPath = path.join(dist, 'win-unpacked', 'resources', 'app.asar');
  const exePath = path.join(dist, 'win-unpacked', 'Khaos Nexus.exe');
  const updaterPath = path.join(dist, 'win-unpacked', 'resources', 'updater', 'apply-update.ps1');
  const asarBin = path.join(root, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  for (const required of [asarPath, exePath, updaterPath, asarBin]) {
    if (!fs.existsSync(required)) throw new Error(`Package audit prerequisite missing: ${required}`);
  }

  const listOutput = execFileSync(process.execPath, [asarBin, 'list', asarPath], { cwd: root, encoding: 'utf8' });
  const entries = parseAsarList(listOutput);
  const audit = auditAsarEntries(entries);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const report = {
    schemaVersion: 1,
    product: 'khaos-nexus',
    version: String(pkg.version || ''),
    ok: audit.ok,
    asar: {
      sha256: sha256(asarPath),
      size: fs.statSync(asarPath).size,
      fileCount: audit.fileCount,
      missingRequired: audit.missingRequired,
      forbidden: audit.forbidden,
      secretBearing: audit.secretBearing,
      topLevelNodeModules: audit.topLevelNodeModules
    },
    packagedRuntime: {
      executablePresent: true,
      updaterHelperPresent: true
    },
    generatedAt: new Date().toISOString()
  };
  const reportPath = path.join(dist, 'nexus-package-audit.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  if (!audit.ok) {
    throw new Error(`Windows package audit failed: missing=${audit.missingRequired.length} forbidden=${audit.forbidden.length} secretBearing=${audit.secretBearing.length}`);
  }
  return { report, reportPath };
}

if (require.main === module) {
  const result = auditWindowsPackage({ distDir: process.argv[2] || 'dist' });
  console.log(`Windows package audit passed: ${result.reportPath}`);
}

module.exports = {
  REQUIRED_ENTRIES,
  FORBIDDEN_PREFIXES,
  normalizeAsarEntry,
  parseAsarList,
  looksSecretBearing,
  auditAsarEntries,
  auditWindowsPackage
};
