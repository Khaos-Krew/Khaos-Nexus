'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const electron = require('electron');
const {
  SENTINEL_CHANNEL,
  selectSentinelRelease,
  releaseSummary,
  parseChecksumManifest,
  digestForAsset
} = require('../shared/sentinel-update-policy.cjs');

const RELEASES_URL = 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus/releases?per_page=30';
const HEALTH_TIMEOUT_MS = 180000;
const refs = { autonomy: null, discordAuth: null, logger: null, updateService: null };
let installed = false;
let rollbackIpcInstalled = false;

function psQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function atomicJson(filePath, value, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fsImpl.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fsImpl.rmSync(filePath, { force: true });
  fsImpl.renameSync(temporary, filePath);
}

function readJson(filePath, fsImpl = fs) {
  try { return JSON.parse(fsImpl.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function updateDirectory(appAdapter = electron.app) {
  return path.join(appAdapter.getPath('userData'), 'sentinel-updates');
}

function markerFromArgs(argv = process.argv) {
  const index = argv.indexOf('--sentinel-update-health-check');
  return index >= 0 && argv[index + 1] ? path.resolve(argv[index + 1]) : null;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__nexusSentinelUpdateCapturePatched) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__nexusSentinelUpdateCapturePatched', { value: true });
  target[exportName] = Captured;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Nexus-Sentinel-Updater'
    }
  });
  if (!response.ok) throw new Error(`Sentinel release request failed with HTTP ${response.status}.`);
  return response.json();
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'Nexus-Sentinel-Updater' }
  });
  if (!response.ok) throw new Error(`Sentinel update manifest download failed with HTTP ${response.status}.`);
  return response.text();
}

async function downloadToFile({ fetchImpl, fsImpl, url, destination, expectedSha256, onProgress, expectedSize = null }) {
  const partial = `${destination}.partial`;
  fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
  fsImpl.rmSync(partial, { force: true });
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'Nexus-Sentinel-Updater' }
  });
  if (!response.ok) throw new Error(`Sentinel update download failed with HTTP ${response.status}.`);
  const hash = crypto.createHash('sha256');
  const handle = await fsImpl.promises.open(partial, 'w');
  let transferred = 0;
  try {
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        await handle.write(chunk);
        hash.update(chunk);
        transferred += chunk.length;
        onProgress?.(transferred, expectedSize);
      }
    } else {
      const chunk = Buffer.from(await response.arrayBuffer());
      await handle.write(chunk);
      hash.update(chunk);
      transferred = chunk.length;
      onProgress?.(transferred, expectedSize);
    }
  } finally {
    await handle.close();
  }
  const actual = hash.digest('hex');
  if (!expectedSha256 || actual !== expectedSha256) {
    fsImpl.rmSync(partial, { force: true });
    throw new Error(expectedSha256 ? 'The Sentinel update failed SHA-256 verification.' : 'The Sentinel update has no trusted SHA-256 digest.');
  }
  fsImpl.rmSync(destination, { force: true });
  fsImpl.renameSync(partial, destination);
  return { path: destination, transferred, sha256: actual };
}

function helperScript(marker) {
  const mode = marker.mode;
  const rollbackPath = marker.rollbackPath;
  const installDirectory = path.dirname(marker.targetPath);
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    `$marker = ${psQuote(marker.markerPath)}`,
    `$source = ${psQuote(marker.stagedPath)}`,
    `$target = ${psQuote(marker.targetPath)}`,
    `$rollback = ${psQuote(rollbackPath)}`,
    `$mode = ${psQuote(mode)}`,
    `$oldPid = ${Number(marker.oldPid)}`,
    `$healthTimeoutSeconds = ${Math.ceil(HEALTH_TIMEOUT_MS / 1000)}`,
    'function Set-Marker([string]$status, [string]$detail = "") {',
    '  try { $data = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { $data = [pscustomobject]@{} }',
    '  $data | Add-Member -NotePropertyName status -NotePropertyValue $status -Force',
    '  $data | Add-Member -NotePropertyName detail -NotePropertyValue $detail -Force',
    '  $data | Add-Member -NotePropertyName updatedAt -NotePropertyValue ([DateTime]::UtcNow.ToString("o")) -Force',
    '  $data | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $marker -Encoding UTF8',
    '}',
    'function Wait-Health([System.Diagnostics.Process]$process) {',
    '  $deadline = (Get-Date).AddSeconds($healthTimeoutSeconds)',
    '  while ((Get-Date) -lt $deadline) {',
    '    Start-Sleep -Milliseconds 750',
    '    if ($process.HasExited) { return $false }',
    '    try { $state = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json } catch { continue }',
    '    if ($state.status -eq "healthy") { return $true }',
    '    if ($state.status -eq "failed") { return $false }',
    '  }',
    '  return $false',
    '}',
    'function Restore-Rollback {',
    '  Set-Marker "rolling-back" "New Sentinel build did not pass startup health."',
    '  if ($mode -eq "portable") {',
    '    Copy-Item -LiteralPath $rollback -Destination $target -Force',
    '  } else {',
    `    $installDir = ${psQuote(installDirectory)}`,
    '    $null = robocopy $rollback $installDir /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NP',
    '    if ($LASTEXITCODE -gt 7) { throw "Rollback restore failed with robocopy exit code $LASTEXITCODE." }',
    '  }',
    '  Set-Marker "rolled-back" "Previous Sentinel build restored automatically."',
    '  Start-Process -FilePath $target -ArgumentList "--sentinel-rollback-recovered" | Out-Null',
    '}',
    'try {',
    '  try { Wait-Process -Id $oldPid -Timeout 120 -ErrorAction SilentlyContinue } catch {}',
    '  Start-Sleep -Seconds 1',
    '  Set-Marker "snapshotting"',
    '  if ($mode -eq "portable") {',
    '    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $rollback) | Out-Null',
    '    Copy-Item -LiteralPath $target -Destination $rollback -Force',
    '    Copy-Item -LiteralPath $source -Destination $target -Force',
    '  } else {',
    `    $installDir = ${psQuote(installDirectory)}`,
    '    Remove-Item -LiteralPath $rollback -Recurse -Force -ErrorAction SilentlyContinue',
    '    New-Item -ItemType Directory -Force -Path $rollback | Out-Null',
    '    Copy-Item -Path (Join-Path $installDir "*") -Destination $rollback -Recurse -Force',
    '    Set-Marker "installing"',
    '    $setup = Start-Process -FilePath $source -ArgumentList "/S" -Wait -PassThru',
    '    if ($setup.ExitCode -ne 0) { throw "Sentinel installer exited with code $($setup.ExitCode)." }',
    '  }',
    '  Set-Marker "launching"',
    '  $newProcess = Start-Process -FilePath $target -ArgumentList "--sentinel-update-health-check", $marker -PassThru',
    '  if (Wait-Health $newProcess) {',
    '    Set-Marker "complete" "New Sentinel build passed startup health."',
    '    Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue',
    '    exit 0',
    '  }',
    '  if (-not $newProcess.HasExited) { Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue }',
    '  Restore-Rollback',
    '} catch {',
    '  Set-Marker "failed" $_.Exception.Message',
    '  try { Restore-Rollback } catch { Set-Marker "rollback-failed" $_.Exception.Message }',
    '}',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
  ];
  return lines.join('\r\n');
}

function latestRollbackMarker(appAdapter = electron.app, fsImpl = fs) {
  const directory = updateDirectory(appAdapter);
  if (!fsImpl.existsSync(directory)) return null;
  const files = fsImpl.readdirSync(directory)
    .filter((name) => /^update-.*\.json$/i.test(name))
    .map((name) => path.join(directory, name))
    .sort((a, b) => fsImpl.statSync(b).mtimeMs - fsImpl.statSync(a).mtimeMs);
  for (const file of files) {
    const marker = readJson(file, fsImpl);
    if (marker && ['complete', 'healthy'].includes(marker.status) && marker.rollbackPath && fsImpl.existsSync(marker.rollbackPath)) return marker;
  }
  return null;
}

class SentinelUpdateService extends (require('./services/update-service.cjs').UpdateService) {
  bindInstalledUpdater() {}

  constructor(input = {}) {
    super(input);
    refs.updateService = this;
    this.fetchImpl = input?.fetchImpl || global.fetch;
    this.fs = input?.fsImpl || fs;
    this.spawnImpl = input?.spawnImpl || spawn;
    this.processId = input?.processId || process.pid;
    this.executablePath = input?.executablePath || process.execPath;
    this.selectedRelease = null;
    this.stagedPath = null;
    this.state = {
      ...this.state,
      channel: SENTINEL_CHANNEL,
      releaseIdentity: 'nexus-sentinel',
      rollbackAvailable: Boolean(latestRollbackMarker(this.app, this.fs)),
      rollbackVersion: latestRollbackMarker(this.app, this.fs)?.oldVersion || null,
      preUpdateBackup: null,
      verified: false
    };
  }

  async check() {
    if (this.mode === 'development') {
      this.set({ status: 'development', lastCheckedAt: new Date().toISOString(), channel: SENTINEL_CHANNEL, error: null });
      return this.getState();
    }
    if (typeof this.fetchImpl !== 'function') throw new Error('Network access is unavailable for Sentinel update checks.');
    this.set({ status: 'checking', error: null, canDownload: false, canInstall: false, progress: null });
    try {
      const releases = await fetchJson(this.fetchImpl, RELEASES_URL);
      const selected = selectSentinelRelease(releases, { currentVersion: this.state.currentVersion });
      if (!selected) {
        this.selectedRelease = null;
        this.set({
          status: 'current', version: this.state.currentVersion, lastCheckedAt: new Date().toISOString(),
          releaseName: 'Nexus Sentinel production channel', releaseNotes: 'No newer stable Sentinel release is published.',
          canDownload: false, canInstall: false, verified: false, error: null
        });
        return this.getState();
      }
      const summary = releaseSummary(selected, this.mode);
      if (!summary?.asset?.browser_download_url) throw new Error(`Sentinel ${summary?.version || 'release'} does not contain the required ${this.mode} Windows asset.`);
      this.selectedRelease = summary;
      this.set({
        status: 'available', version: summary.version, releaseName: summary.name, releaseNotes: summary.notes,
        releaseUrl: summary.releaseUrl, publishedAt: summary.publishedAt, lastCheckedAt: new Date().toISOString(),
        canDownload: true, canInstall: false, verified: false, progress: null, error: null
      });
      return this.getState();
    } catch (error) {
      this.handleError(error, 'Sentinel update check failed');
      throw error;
    }
  }

  async trustedDigest(summary) {
    let digest = digestForAsset(summary.asset);
    if (digest) return digest;
    if (!summary.manifestAsset?.browser_download_url) throw new Error('The Sentinel release is missing both an asset digest and the signed-build checksum manifest.');
    const manifestText = await fetchText(this.fetchImpl, summary.manifestAsset.browser_download_url);
    const manifest = parseChecksumManifest(manifestText, summary.version);
    digest = digestForAsset(summary.asset, manifest);
    if (!digest) throw new Error(`The Sentinel checksum manifest does not contain ${summary.asset.name}.`);
    return digest;
  }

  async download() {
    if (this.state.status !== 'available' || !this.selectedRelease) throw new Error('Check the Sentinel production channel before downloading an update.');
    const summary = this.selectedRelease;
    const digest = await this.trustedDigest(summary);
    const directory = updateDirectory(this.app);
    const destination = path.join(directory, 'staged', summary.asset.name);
    this.set({ status: 'downloading', progress: 0, transferred: 0, total: Number(summary.asset.size) || null, error: null });
    try {
      const result = await downloadToFile({
        fetchImpl: this.fetchImpl,
        fsImpl: this.fs,
        url: summary.asset.browser_download_url,
        destination,
        expectedSha256: digest,
        expectedSize: Number(summary.asset.size) || null,
        onProgress: (transferred, total) => this.set({
          status: 'downloading', transferred, total: total || null,
          progress: total ? Math.max(0, Math.min(100, Math.round((transferred / total) * 100))) : null
        })
      });
      this.stagedPath = result.path;
      this.set({ status: 'downloaded', progress: 100, transferred: result.transferred, canDownload: false, canInstall: true, verified: true, error: null });
      refs.logger?.info?.('Sentinel update downloaded and SHA-256 verified.', { version: summary.version, sha256: result.sha256 });
      return this.getState();
    } catch (error) {
      this.handleError(error, 'Sentinel update download failed');
      throw error;
    }
  }

  install() {
    if (this.state.status !== 'downloaded' || !this.state.canInstall || !this.stagedPath) throw new Error('Download and verify the Sentinel update before installing it.');
    if (!refs.autonomy?.createAutomaticBackup) throw new Error('Sentinel backup service is not ready. The update was not installed.');
    const backup = refs.autonomy.createAutomaticBackup('pre-update');
    if (!backup?.valid || !backup.filePath) throw new Error('The pre-update backup could not be verified. The update was not installed.');

    const directory = updateDirectory(this.app);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const markerPath = path.join(directory, `update-${stamp}.json`);
    const rollbackPath = this.mode === 'portable'
      ? path.join(directory, 'rollback', `Khaos-Nexus-Sentinel-${this.state.currentVersion}-x64.exe`)
      : path.join(directory, 'rollback', `install-${this.state.currentVersion}-${stamp}`);
    const marker = {
      format: 'nexus-sentinel-update', formatVersion: 1, channel: SENTINEL_CHANNEL,
      markerPath, status: 'prepared', oldVersion: this.state.currentVersion, newVersion: this.state.version,
      mode: this.mode, oldPid: this.processId, stagedPath: this.stagedPath,
      targetPath: this.mode === 'portable' ? this.portableExecutable : this.executablePath,
      rollbackPath, backupPath: backup.filePath, preparedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    if (!marker.targetPath) throw new Error('The current Sentinel executable path is unavailable.');
    atomicJson(markerPath, marker, this.fs);
    const scriptPath = path.join(directory, `apply-sentinel-update-${Date.now()}.ps1`);
    this.fs.writeFileSync(scriptPath, helperScript(marker), 'utf8');
    const child = this.spawnImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    child?.unref?.();
    this.set({ status: 'installing', canInstall: false, preUpdateBackup: backup.filePath, rollbackAvailable: true, rollbackVersion: this.state.currentVersion, error: null });
    refs.logger?.warn?.('Sentinel staged update helper started.', { from: marker.oldVersion, to: marker.newVersion, backup: backup.filePath });
    this.setTimeoutImpl(() => this.app.quit(), 650);
    return this.getState();
  }

  configureAutomaticChecks(enabled, intervalMs = 6 * 60 * 60 * 1000) {
    if (this.automaticTimer) this.clearIntervalImpl(this.automaticTimer);
    this.automaticTimer = null;
    const active = Boolean(enabled && this.mode !== 'development');
    this.set({ automaticChecks: active });
    if (!active) return this.getState();
    this.automaticTimer = this.setIntervalImpl(() => this.check().catch((error) => refs.logger?.warn?.('Scheduled Sentinel update check failed.', { message: error.message })), Math.max(15 * 60 * 1000, Number(intervalMs) || 6 * 60 * 60 * 1000));
    this.automaticTimer?.unref?.();
    return this.getState();
  }
}

function patchUpdateService() {
  const target = require('./services/update-service.cjs');
  if (target.UpdateService?.__nexusSentinelProductionUpdatePatched) return;
  Object.defineProperty(SentinelUpdateService, '__nexusSentinelProductionUpdatePatched', { value: true });
  target.UpdateService = SentinelUpdateService;
}

function reportUpdateHealth() {
  const markerPath = markerFromArgs();
  if (!markerPath) return;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS - 5000;
  const timer = setInterval(() => {
    const marker = readJson(markerPath);
    if (!marker) return;
    const startupHealth = require('./startup-health-extension.cjs').publicState();
    if (!startupHealth?.completed && Date.now() < deadline) return;
    const criticalFailures = (startupHealth?.checks || []).filter((check) => check.critical && check.status === 'fail');
    const healthy = Boolean(startupHealth?.completed && ['healthy', 'warning'].includes(startupHealth.overall) && criticalFailures.length === 0);
    atomicJson(markerPath, {
      ...marker,
      status: healthy ? 'healthy' : 'failed',
      detail: healthy ? 'Sentinel startup health accepted the new build.' : `Sentinel startup health rejected the new build: ${criticalFailures.map((item) => `${item.id}: ${item.detail}`).join('; ') || startupHealth?.overall || 'timeout'}`,
      health: { overall: startupHealth?.overall || null, phase: startupHealth?.phase || null, criticalFailures },
      updatedAt: new Date().toISOString()
    });
    clearInterval(timer);
  }, 500);
  timer.unref?.();
}

function registerRollbackIpc() {
  if (rollbackIpcInstalled) return;
  rollbackIpcInstalled = true;
  electron.ipcMain.handle('update:rollback-status', () => {
    const marker = latestRollbackMarker();
    return marker ? { available: true, version: marker.oldVersion, createdAt: marker.preparedAt, backupPath: marker.backupPath } : { available: false };
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchUpdateService();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(() => {
    reportUpdateHealth();
    registerRollbackIpc();
  });
}

module.exports = {
  install,
  SentinelUpdateService,
  patchUpdateService,
  markerFromArgs,
  latestRollbackMarker,
  helperScript,
  downloadToFile,
  atomicJson,
  readJson,
  refs
};