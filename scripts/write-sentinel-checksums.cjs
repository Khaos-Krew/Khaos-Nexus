'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid package version: ${version}`);

const output = path.resolve(process.argv[2] || path.join(root, 'dist'));
const names = [
  `Khaos-Nexus-Sentinel-Setup-${version}-x64.exe`,
  `Khaos-Nexus-Sentinel-Portable-${version}-x64.exe`
];

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

const assets = {};
for (const name of names) {
  const filePath = path.join(output, name);
  if (!fs.existsSync(filePath)) throw new Error(`Sentinel release asset is missing: ${filePath}`);
  const stat = fs.statSync(filePath);
  assets[name] = { sha256: sha256(filePath), bytes: stat.size };
}

const manifest = {
  format: 'nexus-sentinel-release-checksums',
  formatVersion: 1,
  channel: 'sentinel',
  version,
  generatedAt: new Date().toISOString(),
  assets
};
const target = path.join(output, `Khaos-Nexus-Sentinel-${version}-sha256.json`);
fs.writeFileSync(target, JSON.stringify(manifest, null, 2), 'utf8');
console.log(target);
for (const [name, info] of Object.entries(assets)) console.log(`${info.sha256}  ${name}`);
