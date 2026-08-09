'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.khaosRelease?.artifactVersion || pkg.build?.extraMetadata?.version || pkg.version || '').trim();
const arch = String(process.env.KHAOS_RELEASE_ARCH || 'x64').trim();
const requireUpdaterMetadata = process.env.KHAOS_REQUIRE_UPDATER_METADATA === '1';

if (!version) throw new Error('Unable to resolve release artifact version from package.json.');
if (!fs.existsSync(dist)) throw new Error(`Missing dist directory: ${dist}`);

const expected = [
  { name: `Khaos-Nexus-Setup-${version}-${arch}.exe`, required: true, minBytes: 1024 * 1024 },
  { name: `Khaos-Nexus-Portable-${version}-${arch}.exe`, required: true, minBytes: 1024 * 1024 },
  { name: `Khaos-Nexus-Setup-${version}-${arch}.exe.blockmap`, required: requireUpdaterMetadata, minBytes: 1 },
  { name: 'latest.yml', required: requireUpdaterMetadata, minBytes: 1 }
];

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

const files = [];
for (const item of expected) {
  const filePath = path.join(dist, item.name);
  if (!fs.existsSync(filePath)) {
    if (item.required) throw new Error(`Missing required release artifact: ${item.name}`);
    continue;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error(`Release artifact is not a file: ${item.name}`);
  if (stat.size < item.minBytes) throw new Error(`Release artifact is unexpectedly small: ${item.name} (${stat.size} bytes)`);
  files.push({ name: item.name, bytes: stat.size, sha256: sha256(filePath) });
}

if (requireUpdaterMetadata) {
  const latestPath = path.join(dist, 'latest.yml');
  const latest = fs.readFileSync(latestPath, 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`(?m)^version:\\s*${escaped}\\s*$`).test(latest)) {
    throw new Error(`latest.yml does not advertise version ${version}.`);
  }
  if (!latest.includes(`Khaos-Nexus-Setup-${version}-${arch}.exe`)) {
    throw new Error('latest.yml does not reference the expected installer artifact.');
  }
}

const manifest = {
  schemaVersion: 1,
  product: 'Khaos Nexus',
  version,
  arch,
  sourceCommit: process.env.GITHUB_SHA || null,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
  signingRequired: process.env.KHAOS_REQUIRE_SIGNING === '1',
  updaterMetadataRequired: requireUpdaterMetadata,
  files
};

const manifestPath = path.join(dist, 'release-manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
for (const file of files) console.log(`${file.name} | ${file.bytes} bytes | SHA256 ${file.sha256}`);
console.log(`Release manifest written: ${path.relative(root, manifestPath)}`);
