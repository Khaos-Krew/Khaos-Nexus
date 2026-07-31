'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPOSITORY = 'Khaos-Krew/Khaos-Nexus-Diagnostics';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RUNTIME_API_VERSION = 1;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

function safeJsonRead(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function atomicJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  try { fs.renameSync(temporary, filePath); }
  catch { fs.rmSync(filePath, { force: true }); fs.renameSync(temporary, filePath); }
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid semantic version comparison: ${left} / ${right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function safeRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('../') || normalized === '..' || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe diagnostics runtime path: ${value}`);
  }
  return normalized;
}

function manifestCompatible(manifest, desktopVersion) {
  if (!manifest || manifest.format !== 'khaos-nexus-diagnostics-release' || manifest.formatVersion !== 1) return false;
  if (manifest.runtimeApiVersion !== RUNTIME_API_VERSION) return false;
  if (!parseVersion(manifest.version) || !parseVersion(desktopVersion)) return false;
  const compatibility = manifest.desktopCompatibility || {};
  if (!parseVersion(compatibility.minVersion) || !parseVersion(compatibility.maxExclusiveVersion)) return false;
  return compareVersions(desktopVersion, compatibility.minVersion) >= 0
    && compareVersions(desktopVersion, compatibility.maxExclusiveVersion) < 0;
}

function runtimeDirectories(dataDirectory) {
  const root = path.join(dataDirectory, 'diagnostics-runtime');
  return {
    root,
    versions: path.join(root, 'versions'),
    temporary: path.join(root, 'temporary'),
    current: path.join(root, 'current.json'),
    checkState: path.join(root, 'check-state.json')
  };
}

function verifyRuntime(runtimeRoot, manifest, desktopVersion) {
  if (!manifestCompatible(manifest, desktopVersion)) throw new Error('The diagnostics runtime is not compatible with this desktop build.');
  const listed = new Map();
  for (const file of Array.isArray(manifest.files) ? manifest.files : []) {
    const relativePath = safeRelativePath(file.path);
    if (listed.has(relativePath)) throw new Error(`Duplicate diagnostics runtime file: ${relativePath}`);
    if (!/^[a-f0-9]{64}$/i.test(String(file.sha256 || ''))) throw new Error(`Invalid diagnostics runtime hash: ${relativePath}`);
    listed.set(relativePath, file);
    const filePath = path.join(runtimeRoot, ...relativePath.split('/'));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Missing diagnostics runtime file: ${relativePath}`);
    const stat = fs.statSync(filePath);
    if (Number(file.size) !== stat.size) throw new Error(`Diagnostics runtime size mismatch: ${relativePath}`);
    if (sha256(filePath).toLowerCase() !== String(file.sha256).toLowerCase()) throw new Error(`Diagnostics runtime hash mismatch: ${relativePath}`);
  }
  if (!listed.size) throw new Error('The diagnostics runtime manifest contains no files.');
  for (const required of [manifest.entry, manifest.service, 'runtime.json']) {
    const relativePath = safeRelativePath(required);
    if (!listed.has(relativePath)) throw new Error(`Required diagnostics runtime file is not listed: ${relativePath}`);
  }
  const runtimeMetadata = safeJsonRead(path.join(runtimeRoot, 'runtime.json'), null);
  if (!runtimeMetadata || runtimeMetadata.version !== manifest.version || runtimeMetadata.runtimeApiVersion !== RUNTIME_API_VERSION) {
    throw new Error('Diagnostics runtime metadata does not match the release manifest.');
  }
  return { root: runtimeRoot, manifest, metadata: runtimeMetadata, version: manifest.version, source: 'downloaded' };
}

function resolveDataDirectory(options = {}) {
  if (options.dataDirectory) return path.resolve(options.dataDirectory);
  const electron = require('electron');
  return electron.app.getPath('userData');
}

function resolveDesktopVersion(options = {}) {
  if (options.desktopVersion) return String(options.desktopVersion);
  const electron = require('electron');
  return electron.app.getVersion();
}

function currentRuntime(options = {}) {
  const dataDirectory = resolveDataDirectory(options);
  const desktopVersion = resolveDesktopVersion(options);
  const directories = runtimeDirectories(dataDirectory);
  const pointer = safeJsonRead(directories.current, null);
  if (!pointer?.version) return null;
  const runtimeRoot = path.join(directories.versions, safeRelativePath(pointer.version));
  const manifest = safeJsonRead(path.join(runtimeRoot, 'manifest.json'), null);
  try { return verifyRuntime(runtimeRoot, manifest, desktopVersion); }
  catch (error) {
    atomicJsonWrite(directories.checkState, { checkedAt: new Date().toISOString(), status: 'cached-runtime-invalid', error: String(error.message || error), version: pointer.version });
    return null;
  }
}

function runtimeService(options = {}) {
  const runtime = currentRuntime(options);
  if (runtime) {
    const servicePath = path.join(runtime.root, ...safeRelativePath(runtime.manifest.service).split('/'));
    try {
      const loaded = require(servicePath);
      if (typeof loaded.DiagnosticSuite !== 'function') throw new Error('Downloaded diagnostics service is missing DiagnosticSuite.');
      return { DiagnosticSuite: loaded.DiagnosticSuite, version: runtime.version, source: runtime.source, runtime };
    } catch (error) {
      const dataDirectory = resolveDataDirectory(options);
      atomicJsonWrite(runtimeDirectories(dataDirectory).checkState, { checkedAt: new Date().toISOString(), status: 'cached-service-load-failed', error: String(error.message || error), version: runtime.version });
    }
  }
  const embedded = require('./services/diagnostic-suite.cjs');
  return { DiagnosticSuite: embedded.DiagnosticSuite, version: 'embedded', source: 'embedded', runtime: null };
}

function releaseAsset(release, name) {
  return (Array.isArray(release?.assets) ? release.assets : []).find((asset) => asset?.name === name && /^https:\/\/github\.com\//i.test(String(asset.browser_download_url || '')));
}

async function fetchJson(url, options = {}) {
  const response = await (options.fetchImpl || globalThis.fetch)(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Khaos-Nexus-Diagnostics-Updater/1' },
    signal: AbortSignal.timeout(options.timeoutMs || 15000)
  });
  if (!response.ok) throw new Error(`Diagnostics repository returned HTTP ${response.status}.`);
  return response.json();
}

async function downloadFile(url, destination, options = {}) {
  const response = await (options.fetchImpl || globalThis.fetch)(url, {
    headers: { accept: 'application/octet-stream', 'user-agent': 'Khaos-Nexus-Diagnostics-Updater/1' },
    signal: AbortSignal.timeout(options.timeoutMs || 60000)
  });
  if (!response.ok) throw new Error(`Diagnostics runtime download returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_ARCHIVE_BYTES) throw new Error('Diagnostics runtime archive exceeds the maximum allowed size.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Diagnostics runtime archive exceeds the maximum allowed size.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  return buffer.length;
}

function extractArchive(archivePath, destination) {
  if (process.platform !== 'win32') throw new Error('Diagnostics runtime extraction is currently supported on Windows only.');
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const source = archivePath.replace(/'/g, "''");
  const target = destination.replace(/'/g, "''");
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath '${source}' -DestinationPath '${target}' -Force`
  ], { windowsHide: true, timeout: 120000, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Diagnostics runtime extraction failed: ${String(result.stderr || result.stdout || '').trim().slice(0, 1000)}`);
}

function activateRuntime(directories, stagingRoot, manifest, desktopVersion) {
  verifyRuntime(stagingRoot, manifest, desktopVersion);
  const destination = path.join(directories.versions, safeRelativePath(manifest.version));
  fs.mkdirSync(directories.versions, { recursive: true });
  fs.rmSync(destination, { recursive: true, force: true });
  try { fs.renameSync(stagingRoot, destination); }
  catch {
    fs.cpSync(stagingRoot, destination, { recursive: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  atomicJsonWrite(path.join(destination, 'manifest.json'), manifest);
  const verified = verifyRuntime(destination, manifest, desktopVersion);
  atomicJsonWrite(directories.current, { version: manifest.version, activatedAt: new Date().toISOString(), runtimeApiVersion: manifest.runtimeApiVersion });
  const retained = fs.readdirSync(directories.versions, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && parseVersion(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => compareVersions(b, a));
  for (const oldVersion of retained.slice(0, 2).includes(manifest.version) ? retained.slice(2) : retained.slice(1)) {
    fs.rmSync(path.join(directories.versions, oldVersion), { recursive: true, force: true });
  }
  return verified;
}

async function checkForUpdate(options = {}) {
  if (process.env.KHAOS_NEXUS_DIAGNOSTICS_UPDATES === 'off') return { skipped: true, reason: 'disabled-by-environment' };
  if (typeof (options.fetchImpl || globalThis.fetch) !== 'function') return { skipped: true, reason: 'fetch-unavailable' };
  const dataDirectory = resolveDataDirectory(options);
  const desktopVersion = resolveDesktopVersion(options);
  const directories = runtimeDirectories(dataDirectory);
  fs.mkdirSync(directories.root, { recursive: true });
  const lastState = safeJsonRead(directories.checkState, {});
  const lastChecked = Date.parse(lastState.checkedAt || '') || 0;
  if (!options.force && Date.now() - lastChecked < CHECK_INTERVAL_MS) return { skipped: true, reason: 'recently-checked', state: lastState };

  try {
    const release = await fetchJson(RELEASE_API, options);
    if (release.draft || release.prerelease) throw new Error('The latest diagnostics release is not a stable published release.');
    const manifestAsset = releaseAsset(release, 'manifest.json');
    if (!manifestAsset) throw new Error('The diagnostics release does not contain manifest.json.');
    const manifest = await fetchJson(manifestAsset.browser_download_url, options);
    if (!manifestCompatible(manifest, desktopVersion)) throw new Error(`Diagnostics runtime ${manifest.version || 'unknown'} is not compatible with desktop ${desktopVersion}.`);
    const archiveName = String(manifest.archive?.name || '');
    const archiveAsset = releaseAsset(release, archiveName);
    if (!archiveAsset) throw new Error(`The diagnostics release does not contain ${archiveName || 'the declared archive'}.`);
    if (!/^[a-f0-9]{64}$/i.test(String(manifest.archive?.sha256 || ''))) throw new Error('The diagnostics release archive hash is invalid.');
    if (Number(manifest.archive?.size) < 1 || Number(manifest.archive.size) > MAX_ARCHIVE_BYTES) throw new Error('The diagnostics release archive size is invalid.');

    const installed = currentRuntime({ dataDirectory, desktopVersion });
    if (installed && compareVersions(installed.version, manifest.version) >= 0) {
      const state = { checkedAt: new Date().toISOString(), status: 'current', version: installed.version, release: release.tag_name || null };
      atomicJsonWrite(directories.checkState, state);
      return { updated: false, current: true, runtime: installed, state };
    }

    const operationId = `${safeRelativePath(manifest.version)}-${process.pid}-${Date.now()}`;
    const operationDirectory = path.join(directories.temporary, operationId);
    const archivePath = path.join(operationDirectory, archiveName);
    const stagingRoot = path.join(operationDirectory, 'runtime');
    fs.rmSync(operationDirectory, { recursive: true, force: true });
    fs.mkdirSync(operationDirectory, { recursive: true });
    await downloadFile(archiveAsset.browser_download_url, archivePath, options);
    const stat = fs.statSync(archivePath);
    if (stat.size !== Number(manifest.archive.size)) throw new Error('Downloaded diagnostics archive size does not match the release manifest.');
    if (sha256(archivePath).toLowerCase() !== String(manifest.archive.sha256).toLowerCase()) throw new Error('Downloaded diagnostics archive hash does not match the release manifest.');
    (options.extractArchive || extractArchive)(archivePath, stagingRoot);
    const runtime = activateRuntime(directories, stagingRoot, manifest, desktopVersion);
    fs.rmSync(operationDirectory, { recursive: true, force: true });
    const state = { checkedAt: new Date().toISOString(), status: 'updated', version: runtime.version, release: release.tag_name || null };
    atomicJsonWrite(directories.checkState, state);
    return { updated: true, runtime, state };
  } catch (error) {
    const state = { checkedAt: new Date().toISOString(), status: 'failed', error: String(error.message || error).slice(0, 1200) };
    atomicJsonWrite(directories.checkState, state);
    return { updated: false, error: state.error, state, runtime: currentRuntime({ dataDirectory, desktopVersion }) };
  }
}

function scheduleBackgroundUpdate(options = {}) {
  const electron = require('electron');
  electron.app.whenReady().then(() => {
    const timer = setTimeout(() => checkForUpdate(options).catch(() => {}), options.delayMs ?? 15000);
    timer.unref?.();
  }).catch(() => {});
}

function runDiagnosticTool(options = {}) {
  const electron = require('electron');
  electron.app.whenReady().then(async () => {
    const desktopVersion = electron.app.getVersion();
    const updatePromise = checkForUpdate({ ...options, desktopVersion, force: true });
    await Promise.race([updatePromise, new Promise((resolve) => setTimeout(resolve, options.startupUpdateBudgetMs ?? 5000))]).catch(() => {});
    const runtime = currentRuntime({ ...options, desktopVersion });
    if (runtime) {
      try {
        const entryPath = path.join(runtime.root, ...safeRelativePath(runtime.manifest.entry).split('/'));
        const module = require(entryPath);
        if (typeof module.run !== 'function') throw new Error('Downloaded diagnostics runtime entry is missing run().');
        module.run({ desktopVersion, runtimeVersion: runtime.version, runtimeRoot: runtime.root });
        return;
      } catch (error) {
        const directories = runtimeDirectories(resolveDataDirectory(options));
        atomicJsonWrite(directories.checkState, { checkedAt: new Date().toISOString(), status: 'runtime-entry-failed', error: String(error.message || error), version: runtime.version });
      }
    }
    require('./diagnostic-tool.cjs').run({ desktopVersion, runtimeVersion: 'embedded' });
  }).catch((error) => {
    electron.dialog.showErrorBox('Khaos Nexus Diagnostics', error.message || String(error));
    electron.app.quit();
  });
}

module.exports = {
  REPOSITORY,
  RELEASE_API,
  RUNTIME_API_VERSION,
  compareVersions,
  manifestCompatible,
  safeRelativePath,
  runtimeDirectories,
  verifyRuntime,
  currentRuntime,
  runtimeService,
  checkForUpdate,
  scheduleBackgroundUpdate,
  runDiagnosticTool,
  sha256,
  safeJsonRead,
  atomicJsonWrite
};
