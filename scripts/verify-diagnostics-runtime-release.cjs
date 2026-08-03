'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const updater = require('../main/diagnostic-runtime-updater.cjs');
const packageJson = require('../package.json');

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchResponse(url, accept) {
  const response = await fetch(url, {
    headers: {
      accept,
      'user-agent': 'Khaos-Nexus-Diagnostics-Integration/1'
    },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response;
}

function asset(release, name) {
  return (Array.isArray(release.assets) ? release.assets : []).find((item) => item?.name === name);
}

function unzip(argumentsList) {
  const result = spawnSync('unzip', argumentsList, { encoding: null, timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`unzip ${argumentsList.join(' ')} failed: ${Buffer.from(result.stderr || result.stdout || '').toString('utf8').slice(0, 1200)}`);
  }
  return Buffer.from(result.stdout || Buffer.alloc(0));
}

async function main() {
  const releaseResponse = await fetchResponse(updater.RELEASE_API, 'application/vnd.github+json');
  const release = await releaseResponse.json();
  assert(!release.draft && !release.prerelease, 'Latest diagnostics release must be stable and published.');

  const manifestAsset = asset(release, 'manifest.json');
  assert(manifestAsset?.browser_download_url, 'Latest diagnostics release is missing manifest.json.');
  const manifestResponse = await fetchResponse(manifestAsset.browser_download_url, 'application/json');
  const manifest = await manifestResponse.json();
  assert(typeof manifest.version === 'string' && manifest.version.length > 0, 'Diagnostics manifest is missing a runtime version.');
  assert(manifest.runtimeApiVersion === updater.RUNTIME_API_VERSION, 'Diagnostics runtime API version does not match the desktop contract.');
  assert(typeof manifest.entry === 'string' && typeof manifest.service === 'string', 'Diagnostics manifest is missing entry or service paths.');

  const compatibleWithDesktop = updater.manifestCompatible(manifest, packageJson.version);
  const archiveAsset = asset(release, manifest.archive?.name);
  assert(archiveAsset?.browser_download_url, `Latest diagnostics release is missing ${manifest.archive?.name || 'its runtime archive'}.`);
  const archiveResponse = await fetchResponse(archiveAsset.browser_download_url, 'application/octet-stream');
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  assert(archive.length > 0 && archive.length <= MAX_ARCHIVE_BYTES, 'Diagnostics runtime archive has an invalid size.');
  assert(archive.length === Number(manifest.archive.size), 'Diagnostics runtime archive size does not match manifest.json.');
  assert(sha256Buffer(archive) === String(manifest.archive.sha256).toLowerCase(), 'Diagnostics runtime archive SHA-256 does not match manifest.json.');

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-diagnostics-release-'));
  const archivePath = path.join(temporaryDirectory, manifest.archive.name);
  const extractedRoot = path.join(temporaryDirectory, 'extracted-runtime');
  fs.writeFileSync(archivePath, archive);
  try {
    unzip(['-t', archivePath]);
    const archiveEntries = new Set(unzip(['-Z1', archivePath]).toString('utf8').split(/\r?\n/).map((item) => item.replace(/^\.\//, '')).filter((item) => item && !item.endsWith('/')));
    const listedFiles = new Set();
    for (const file of manifest.files || []) {
      const relativePath = updater.safeRelativePath(file.path);
      assert(!listedFiles.has(relativePath), `Duplicate manifest path: ${relativePath}`);
      listedFiles.add(relativePath);
      assert(archiveEntries.has(relativePath), `Runtime archive is missing ${relativePath}.`);
      const contents = unzip(['-p', archivePath, relativePath]);
      assert(contents.length === Number(file.size), `${relativePath} size does not match manifest.json.`);
      assert(sha256Buffer(contents) === String(file.sha256).toLowerCase(), `${relativePath} SHA-256 does not match manifest.json.`);
    }
    for (const relativePath of archiveEntries) assert(listedFiles.has(relativePath), `Runtime archive contains an unlisted file: ${relativePath}`);

    fs.mkdirSync(extractedRoot, { recursive: true });
    unzip(['-q', archivePath, '-d', extractedRoot]);
    const servicePath = path.join(extractedRoot, ...updater.safeRelativePath(manifest.service).split('/'));
    const runtimeServiceModule = require(servicePath);
    assert(typeof runtimeServiceModule.DiagnosticSuite === 'function', 'Published diagnostics runtime service is missing DiagnosticSuite.');

    if (compatibleWithDesktop) {
      updater.verifyRuntime(extractedRoot, manifest, packageJson.version);
    } else {
      let incompatibilityRejected = false;
      try { updater.verifyRuntime(extractedRoot, manifest, packageJson.version); }
      catch (error) { incompatibilityRejected = /not compatible/i.test(String(error.message || error)); }
      assert(incompatibilityRejected, `Runtime ${manifest.version} must be rejected for desktop ${packageJson.version}.`);

      const fallbackData = path.join(temporaryDirectory, 'fallback-data');
      const fallback = updater.runtimeService({ dataDirectory: fallbackData, desktopVersion: packageJson.version });
      assert(fallback.source === 'embedded', 'An incompatible published runtime must fall back to the embedded diagnostics suite.');
      assert(fallback.version === 'embedded', 'Embedded diagnostics fallback must report the embedded version identity.');
      assert(fallback.runtime === null, 'Embedded diagnostics fallback must not expose an incompatible downloaded runtime.');
      assert(typeof fallback.DiagnosticSuite === 'function', 'Embedded diagnostics fallback is missing DiagnosticSuite.');
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({
    verified: true,
    repository: updater.REPOSITORY,
    runtimeVersion: manifest.version,
    runtimeApiVersion: manifest.runtimeApiVersion,
    desktopVersion: packageJson.version,
    compatibleWithDesktop,
    activationMode: compatibleWithDesktop ? 'downloaded-runtime-eligible' : 'embedded-fallback-required',
    files: manifest.files.length,
    archiveBytes: archive.length
  })}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
