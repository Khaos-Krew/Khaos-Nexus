'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');

const PRODUCT = 'khaos-nexus';
const DEFAULT_REPOSITORY = 'Khaos-Krew/Khaos-Nexus';
const MANIFEST_ASSET = 'nexus-update-manifest.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;
const UPDATE_PHASES = new Set(['idle', 'checking', 'available', 'downloading', 'staging', 'ready', 'applying', 'failed']);

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function cleanMessage(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeChannel(value) {
  return String(value || '').toLowerCase() === 'stable' ? 'stable' : 'owner-test';
}

function parseVersion(value) {
  const text = String(value || '').trim().replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(text);
  if (!match) return null;
  return {
    text,
    parts: [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0)],
    prerelease: match[5] || ''
  };
}

function comparePrerelease(left, right) {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const a = left.split('.');
  const b = right.split('.');
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if (a[index] === undefined) return -1;
    if (b[index] === undefined) return 1;
    const an = /^\d+$/.test(a[index]) ? Number(a[index]) : null;
    const bn = /^\d+$/.test(b[index]) ? Number(b[index]) : null;
    if (an !== null && bn !== null && an !== bn) return an > bn ? 1 : -1;
    if (an !== null && bn === null) return -1;
    if (an === null && bn !== null) return 1;
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  if (!left || !right) throw new Error(`Cannot compare invalid versions: ${leftValue} and ${rightValue}`);
  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function isSafeAssetName(name) {
  const value = String(name || '');
  return Boolean(value && value === path.basename(value) && /^[A-Za-z0-9._ -]+\.zip$/i.test(value));
}

function validateManifest(manifest, { channel, currentVersion } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Update manifest is invalid.');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported update manifest schema.');
  if (manifest.product !== PRODUCT) throw new Error('Update manifest is for a different product.');
  const targetVersion = parseVersion(manifest.version);
  if (!targetVersion) throw new Error('Update manifest version is invalid.');
  const targetChannel = normalizeChannel(manifest.channel);
  if (channel && targetChannel !== normalizeChannel(channel)) throw new Error('Update manifest channel does not match this Nexus channel.');
  if (currentVersion && compareVersions(targetVersion.text, currentVersion) <= 0) throw new Error('Update manifest is not newer than the installed version.');
  if (!manifest.package || typeof manifest.package !== 'object') throw new Error('Update manifest package is missing.');
  if (!isSafeAssetName(manifest.package.name)) throw new Error('Update package name is unsafe.');
  const sha256 = String(manifest.package.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Update package SHA-256 is invalid.');
  const size = Number(manifest.package.size || 0);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PACKAGE_BYTES) throw new Error('Update package size is invalid.');
  if (manifest.installerRequired === true) throw new Error('Installer-based updates are not supported by the staged updater.');
  return {
    schemaVersion: 1,
    product: PRODUCT,
    version: targetVersion.text,
    channel: targetChannel,
    notes: cleanMessage(manifest.notes || '', 4000),
    package: { name: manifest.package.name, sha256, size },
    restartRequired: manifest.restartRequired !== false,
    installerRequired: false
  };
}

function selectRelease(releases, channel) {
  const wanted = normalizeChannel(channel);
  return (Array.isArray(releases) ? releases : []).find((release) => {
    if (!release || release.draft === true) return false;
    if (wanted === 'stable' && release.prerelease === true) return false;
    if (wanted === 'owner-test' && release.prerelease !== true) return false;
    return Array.isArray(release.assets) && release.assets.some((asset) => asset?.name === MANIFEST_ASSET);
  }) || null;
}

function safeUpdateState(value = {}) {
  const phase = UPDATE_PHASES.has(value.phase) ? value.phase : 'idle';
  return {
    phase,
    currentVersion: String(value.currentVersion || ''),
    channel: normalizeChannel(value.channel),
    availableVersion: String(value.availableVersion || ''),
    releaseName: cleanMessage(value.releaseName || '', 180),
    releaseUrl: String(value.releaseUrl || ''),
    notes: cleanMessage(value.notes || '', 4000),
    downloadedBytes: Number(value.downloadedBytes || 0),
    totalBytes: Number(value.totalBytes || 0),
    readyVersion: String(value.readyVersion || ''),
    lastError: cleanMessage(value.lastError || '', 500),
    lastCheckedAt: String(value.lastCheckedAt || ''),
    lastResult: value.lastResult && typeof value.lastResult === 'object' ? {
      status: cleanMessage(value.lastResult.status || '', 40),
      fromVersion: cleanMessage(value.lastResult.fromVersion || '', 50),
      toVersion: cleanMessage(value.lastResult.toVersion || '', 50),
      reason: cleanMessage(value.lastResult.reason || '', 300),
      at: cleanMessage(value.lastResult.at || '', 80)
    } : null
  };
}

function defaultExtractArchive(archivePath, destinationPath) {
  if (process.platform !== 'win32') throw new Error('Update extraction is only supported on Windows installed builds.');
  ensureDirectory(destinationPath);
  const command = `Expand-Archive -LiteralPath '${String(archivePath).replace(/'/g, "''")}' -DestinationPath '${String(destinationPath).replace(/'/g, "''")}' -Force`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(cleanMessage(errorText || `Expand-Archive exited with ${code}.`))));
  });
}

class StagedUpdater {
  constructor(options = {}) {
    this.currentVersion = String(options.currentVersion || '0.0.0');
    this.userDataPath = path.resolve(options.userDataPath || process.cwd());
    this.installDir = path.resolve(options.installDir || path.dirname(process.execPath));
    this.executableName = path.basename(options.executableName || process.execPath);
    this.resourcesPath = path.resolve(options.resourcesPath || process.resourcesPath || this.installDir);
    this.repository = options.repository || DEFAULT_REPOSITORY;
    if (this.repository !== DEFAULT_REPOSITORY) throw new Error('Updater repository is not approved.');
    this.channel = normalizeChannel(options.channel);
    this.enabled = options.enabled !== false;
    this.autoDownload = options.autoDownload !== false;
    this.isPackaged = options.isPackaged !== false;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.extractArchive = options.extractArchive || defaultExtractArchive;
    this.spawnImpl = options.spawnImpl || spawn;
    this.updateRoot = path.join(this.userDataPath, 'updates');
    this.statePath = path.join(this.updateRoot, 'state.json');
    this.lastResultPath = path.join(this.updateRoot, 'last-result.json');
    ensureDirectory(this.updateRoot);
    const persisted = readJson(this.statePath, {});
    const lastResult = readJson(this.lastResultPath, null);
    this.state = {
      phase: persisted.phase === 'ready' && persisted.readyVersion && persisted.stagePath && fs.existsSync(persisted.stagePath) ? 'ready' : 'idle',
      currentVersion: this.currentVersion,
      channel: this.channel,
      availableVersion: persisted.availableVersion || '',
      releaseName: persisted.releaseName || '',
      releaseUrl: persisted.releaseUrl || '',
      notes: persisted.notes || '',
      packageUrl: persisted.packageUrl || '',
      packageName: persisted.packageName || '',
      sha256: persisted.sha256 || '',
      totalBytes: Number(persisted.totalBytes || 0),
      downloadedBytes: 0,
      readyVersion: persisted.readyVersion || '',
      stagePath: persisted.stagePath || '',
      lastError: '',
      lastCheckedAt: persisted.lastCheckedAt || '',
      lastResult
    };
    this.persist();
  }

  configure(options = {}) {
    this.enabled = options.enabled !== false;
    this.autoDownload = options.autoDownload !== false;
    this.channel = normalizeChannel(options.channel || this.channel);
    this.state.channel = this.channel;
    this.persist();
  }

  persist() {
    atomicWriteJson(this.statePath, this.state);
  }

  status() {
    return {
      enabled: this.enabled,
      autoDownload: this.autoDownload,
      packaged: this.isPackaged,
      repository: this.repository,
      ...safeUpdateState(this.state)
    };
  }

  setPhase(phase, patch = {}) {
    this.state = { ...this.state, ...patch, phase, currentVersion: this.currentVersion, channel: this.channel };
    this.persist();
    return this.status();
  }

  async fetchJson(url, timeoutMs = 30000) {
    const response = await this.fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `Khaos-Nexus-Updater/${this.currentVersion}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Update service returned HTTP ${response.status}.`);
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('Update metadata exceeded the allowed size.');
    return JSON.parse(text);
  }

  async check() {
    if (!this.enabled) return this.setPhase('idle', { lastError: '' });
    if (!this.isPackaged) return this.setPhase('idle', { lastError: '', lastCheckedAt: new Date().toISOString() });
    if (this.state.phase === 'ready' && this.state.readyVersion && compareVersions(this.state.readyVersion, this.currentVersion) > 0) return this.status();
    this.setPhase('checking', { lastError: '' });
    try {
      const releases = await this.fetchJson(`https://api.github.com/repos/${this.repository}/releases?per_page=20`);
      const release = selectRelease(releases, this.channel);
      if (!release) return this.setPhase('idle', { availableVersion: '', lastCheckedAt: new Date().toISOString(), lastError: '' });
      const manifestAsset = release.assets.find((asset) => asset?.name === MANIFEST_ASSET);
      const manifestRaw = await this.fetchJson(manifestAsset.browser_download_url);
      let manifest;
      try {
        manifest = validateManifest(manifestRaw, { channel: this.channel, currentVersion: this.currentVersion });
      } catch (error) {
        if (/not newer/i.test(String(error.message))) return this.setPhase('idle', { availableVersion: '', lastCheckedAt: new Date().toISOString(), lastError: '' });
        throw error;
      }
      const packageAsset = release.assets.find((asset) => asset?.name === manifest.package.name);
      if (!packageAsset?.browser_download_url) throw new Error('The release is missing the update package declared by its manifest.');
      const digest = String(packageAsset.digest || '').toLowerCase();
      if (digest.startsWith('sha256:') && digest.slice(7) !== manifest.package.sha256) throw new Error('GitHub asset digest does not match the update manifest.');
      return this.setPhase('available', {
        availableVersion: manifest.version,
        releaseName: cleanMessage(release.name || release.tag_name || manifest.version, 180),
        releaseUrl: String(release.html_url || ''),
        notes: manifest.notes || cleanMessage(release.body || '', 4000),
        packageUrl: packageAsset.browser_download_url,
        packageName: manifest.package.name,
        sha256: manifest.package.sha256,
        totalBytes: manifest.package.size,
        downloadedBytes: 0,
        lastCheckedAt: new Date().toISOString(),
        lastError: ''
      });
    } catch (error) {
      return this.setPhase('failed', { lastError: cleanMessage(error.message || error), lastCheckedAt: new Date().toISOString() });
    }
  }

  assertWritableInstall() {
    if (!this.isPackaged) throw new Error('Updates can only be applied to an installed Nexus build.');
    try { fs.accessSync(this.installDir, fs.constants.W_OK); }
    catch { throw new Error('The Nexus install directory is not writable without running another installer. Reinstall Nexus once to a per-user location, then staged updates can take over.'); }
  }

  async downloadPackage(url, destinationPath, expectedSha, expectedSize) {
    const response = await this.fetchImpl(url, {
      headers: { 'user-agent': `Khaos-Nexus-Updater/${this.currentVersion}` },
      signal: AbortSignal.timeout(20 * 60 * 1000)
    });
    if (!response.ok || !response.body) throw new Error(`Update package download returned HTTP ${response.status}.`);
    const advertised = Number(response.headers.get('content-length') || 0);
    if (advertised > MAX_PACKAGE_BYTES) throw new Error('Update package is larger than the allowed limit.');
    ensureDirectory(path.dirname(destinationPath));
    const temporary = `${destinationPath}.partial`;
    try { fs.rmSync(temporary, { force: true }); } catch {}
    const output = fs.createWriteStream(temporary, { flags: 'wx' });
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body)) {
        bytes += chunk.length;
        if (bytes > MAX_PACKAGE_BYTES) throw new Error('Update package exceeded the allowed size.');
        hash.update(chunk);
        if (!output.write(chunk)) await new Promise((resolve) => output.once('drain', resolve));
        this.state.downloadedBytes = bytes;
        this.persist();
      }
      await new Promise((resolve, reject) => output.end((error) => error ? reject(error) : resolve()));
    } catch (error) {
      output.destroy();
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
    const digest = hash.digest('hex');
    if (expectedSize && bytes !== Number(expectedSize)) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`Update package size mismatch: expected ${expectedSize}, received ${bytes}.`);
    }
    if (digest !== String(expectedSha).toLowerCase()) {
      fs.rmSync(temporary, { force: true });
      throw new Error('Update package SHA-256 verification failed.');
    }
    fs.renameSync(temporary, destinationPath);
    return { bytes, sha256: digest };
  }

  validateStagedPayload(payloadPath) {
    const executablePath = path.join(payloadPath, this.executableName);
    const asarPath = path.join(payloadPath, 'resources', 'app.asar');
    if (!fs.existsSync(executablePath)) throw new Error(`Staged update is missing ${this.executableName}.`);
    if (!fs.existsSync(asarPath)) throw new Error('Staged update is missing resources/app.asar.');
    return { executablePath, asarPath };
  }

  async prepare() {
    try {
      this.assertWritableInstall();
      if (this.state.phase !== 'available') {
        const checked = await this.check();
        if (checked.phase !== 'available') return checked;
      }
      const version = this.state.availableVersion;
      const root = path.join(this.updateRoot, 'staging', version);
      const archivePath = path.join(root, this.state.packageName || `Khaos-Nexus-${version}-update.zip`);
      const payloadPath = path.join(root, 'payload');
      fs.rmSync(root, { recursive: true, force: true });
      ensureDirectory(root);
      this.setPhase('downloading', { downloadedBytes: 0, lastError: '' });
      await this.downloadPackage(this.state.packageUrl, archivePath, this.state.sha256, this.state.totalBytes);
      this.setPhase('staging');
      fs.rmSync(payloadPath, { recursive: true, force: true });
      await this.extractArchive(archivePath, payloadPath);
      this.validateStagedPayload(payloadPath);
      return this.setPhase('ready', {
        readyVersion: version,
        stagePath: payloadPath,
        downloadedBytes: this.state.totalBytes,
        lastError: ''
      });
    } catch (error) {
      return this.setPhase('failed', { lastError: cleanMessage(error.message || error) });
    }
  }

  createTransaction({ pid, helperScriptPath } = {}) {
    if (this.state.phase !== 'ready' || !this.state.stagePath || !this.state.readyVersion) throw new Error('No prepared Nexus update is ready to apply.');
    this.assertWritableInstall();
    const helperSource = helperScriptPath || path.join(this.resourcesPath, 'updater', 'apply-update.ps1');
    if (!fs.existsSync(helperSource)) throw new Error('The staged updater helper is missing from this Nexus build.');
    const helperCopy = path.join(this.updateRoot, 'apply-update.ps1');
    fs.copyFileSync(helperSource, helperCopy);
    const transactionDirectory = path.join(this.updateRoot, 'transactions', this.state.readyVersion);
    ensureDirectory(transactionDirectory);
    const markerPath = path.join(transactionDirectory, 'startup-ok.json');
    const transactionPath = path.join(transactionDirectory, 'transaction.json');
    const transaction = {
      schemaVersion: 1,
      pid: Number(pid || process.pid),
      currentVersion: this.currentVersion,
      targetVersion: this.state.readyVersion,
      targetDir: this.installDir,
      stagedDir: path.resolve(this.state.stagePath),
      backupDir: path.join(this.updateRoot, 'rollback', this.currentVersion),
      executableName: this.executableName,
      markerPath,
      resultPath: this.lastResultPath,
      startupTimeoutSeconds: 60
    };
    fs.rmSync(markerPath, { force: true });
    atomicWriteJson(transactionPath, transaction);
    return { transactionPath, helperCopy, transaction };
  }

  beginApply(options = {}) {
    if (process.platform !== 'win32' && !options.allowNonWindowsForTest) throw new Error('Staged update application is only supported on Windows.');
    const { transactionPath, helperCopy, transaction } = this.createTransaction(options);
    const child = this.spawnImpl('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperCopy, '-Transaction', transactionPath
    ], { detached: true, windowsHide: true, stdio: 'ignore' });
    child.unref?.();
    this.setPhase('applying', { lastError: '' });
    return { applying: true, targetVersion: transaction.targetVersion, transactionPath };
  }

  confirmPostUpdateFromArgs(args = process.argv) {
    const index = args.indexOf('--nexus-post-update');
    if (index < 0 || !args[index + 1]) return false;
    const transactionPath = path.resolve(args[index + 1]);
    const transactionRoot = path.join(this.updateRoot, 'transactions');
    if (!(transactionPath === transactionRoot || transactionPath.startsWith(`${transactionRoot}${path.sep}`))) return false;
    const transaction = readJson(transactionPath, null);
    if (!transaction || transaction.targetVersion !== this.currentVersion) return false;
    const markerPath = path.resolve(transaction.markerPath || '');
    if (!(markerPath.startsWith(`${transactionRoot}${path.sep}`))) return false;
    atomicWriteJson(markerPath, { ok: true, version: this.currentVersion, at: new Date().toISOString() });
    this.state = {
      ...this.state,
      phase: 'idle',
      currentVersion: this.currentVersion,
      availableVersion: '',
      readyVersion: '',
      stagePath: '',
      lastError: '',
      downloadedBytes: 0,
      totalBytes: 0
    };
    this.persist();
    return true;
  }

  async autoCheck() {
    const checked = await this.check();
    if (checked.phase === 'available' && this.autoDownload) return this.prepare();
    return checked;
  }
}

module.exports = {
  DEFAULT_REPOSITORY,
  MANIFEST_ASSET,
  PRODUCT,
  StagedUpdater,
  compareVersions,
  normalizeChannel,
  parseVersion,
  safeUpdateState,
  selectRelease,
  validateManifest
};
