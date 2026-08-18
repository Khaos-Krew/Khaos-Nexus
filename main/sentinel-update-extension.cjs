'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electron = require('electron');
const {
  selectSentinelRelease,
  sentinelPortableAsset,
  sentinelSetupAsset,
  sentinelUpdateMetadataAsset,
  digestFromAsset,
  digestSidecarAsset,
  startupAccepted
} = require('../shared/sentinel-update-policy.cjs');

const RELEASES_URL = 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus/releases?per_page=50';
const RELEASE_DOWNLOAD_ROOT = 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/download';
const ROLLBACK_TIMEOUT_SECONDS = 150;

let installed = false;

function psQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function safeSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 80);
}

function pendingMarkerPath(appAdapter = electron.app) {
  return path.join(appAdapter.getPath('userData'), 'sentinel-update-pending.json');
}

function acceptanceMarkerPath(appAdapter = electron.app) {
  return path.join(appAdapter.getPath('userData'), 'sentinel-update-accepted.json');
}

function writeJsonAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
  fs.rmSync(filePath, { force: true });
  fs.renameSync(temporary, filePath);
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true, errorOnExist: false });
}

function buildRollbackWatchdog(marker) {
  const markerPath = marker.markerPath;
  const acceptancePath = marker.acceptancePath;
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$markerPath = ${psQuote(markerPath)}`,
    `$acceptancePath = ${psQuote(acceptancePath)}`,
    `$targetExe = ${psQuote(marker.targetExe)}`,
    `$targetVersion = ${psQuote(marker.targetVersion)}`,
    `$deadline = (Get-Date).AddSeconds(${ROLLBACK_TIMEOUT_SECONDS})`,
    'while ((Get-Date) -lt $deadline) {',
    '  if (Test-Path -LiteralPath $acceptancePath) {',
    '    try {',
    '      $accepted = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json',
    '      if ([string]$accepted.version -eq $targetVersion -and [bool]$accepted.accepted) {',
    `        Remove-Item -LiteralPath ${psQuote(marker.rollbackRoot)} -Recurse -Force -ErrorAction SilentlyContinue`,
    '        Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue',
    '        Remove-Item -LiteralPath $acceptancePath -Force -ErrorAction SilentlyContinue',
    '        Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
    '        exit 0',
    '      }',
    '    } catch {}',
    '  }',
    '  Start-Sleep -Seconds 2',
    '}',
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $targetExe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    'Start-Sleep -Seconds 3'
  ];

  if (marker.mode === 'portable') {
    lines.push(
      `Copy-Item -LiteralPath ${psQuote(marker.rollbackPath)} -Destination $targetExe -Force`,
      'Start-Process -FilePath $targetExe'
    );
  } else {
    lines.push(
      `$targetDir = ${psQuote(marker.targetDir)}`,
      `$snapshotDir = ${psQuote(marker.rollbackPath)}`,
      'if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force -ErrorAction SilentlyContinue }',
      'New-Item -ItemType Directory -Path $targetDir -Force | Out-Null',
      'Copy-Item -LiteralPath (Join-Path $snapshotDir "*") -Destination $targetDir -Recurse -Force',
      'Start-Process -FilePath $targetExe'
    );
  }

  lines.push(
    'Remove-Item -LiteralPath $acceptancePath -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue'
  );
  return lines.join('\r\n');
}

function startRollbackWatchdog(marker, spawnImpl = spawn) {
  const scriptPath = path.join(path.dirname(marker.markerPath), `sentinel-update-watchdog-${Date.now()}.ps1`);
  fs.writeFileSync(scriptPath, buildRollbackWatchdog(marker), 'utf8');
  const child = spawnImpl('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  });
  child?.unref?.();
  return scriptPath;
}

function prepareRollbackSnapshot(service, targetVersion) {
  const appAdapter = service.app || electron.app;
  const currentVersion = service.state?.currentVersion || appAdapter.getVersion();
  const rollbackRoot = path.join(appAdapter.getPath('userData'), 'update-rollback', `${safeSegment(currentVersion)}-to-${safeSegment(targetVersion)}-${Date.now()}`);
  const targetExe = service.portableExecutable || process.execPath;
  const markerPath = pendingMarkerPath(appAdapter);
  const acceptancePath = acceptanceMarkerPath(appAdapter);
  fs.rmSync(acceptancePath, { force: true });
  fs.mkdirSync(rollbackRoot, { recursive: true });

  let rollbackPath;
  let targetDir = null;
  if (service.mode === 'portable') {
    if (!targetExe || !fs.existsSync(targetExe)) throw new Error('The current portable executable is unavailable for rollback protection.');
    rollbackPath = path.join(rollbackRoot, path.basename(targetExe));
    fs.copyFileSync(targetExe, rollbackPath);
  } else if (service.mode === 'installed') {
    targetDir = path.dirname(process.execPath);
    if (!targetDir || !fs.existsSync(targetDir)) throw new Error('The current Sentinel installation directory is unavailable for rollback protection.');
    rollbackPath = path.join(rollbackRoot, 'app');
    copyDirectory(targetDir, rollbackPath);
  } else {
    throw new Error('Rollback snapshots are only available in packaged Sentinel builds.');
  }

  const marker = {
    product: 'nexus-sentinel',
    mode: service.mode,
    previousVersion: String(currentVersion),
    targetVersion: String(targetVersion),
    createdAt: new Date().toISOString(),
    rollbackRoot,
    rollbackPath,
    targetDir,
    targetExe,
    markerPath,
    acceptancePath
  };
  writeJsonAtomic(markerPath, marker);
  startRollbackWatchdog(marker, service.spawnImpl || spawn);
  return marker;
}

async function resolvePortableDigest(service, release, asset) {
  const direct = digestFromAsset(asset);
  if (direct) return direct;
  const sidecar = digestSidecarAsset(release, asset.name);
  if (!sidecar?.browser_download_url) throw new Error(`Sentinel release ${release.tag_name} is missing a SHA-256 digest for ${asset.name}.`);
  const response = await service.fetchImpl(sidecar.browser_download_url, { headers: { 'User-Agent': `Nexus-Sentinel/${service.state.currentVersion}` } });
  if (!response.ok) throw new Error(`Sentinel SHA-256 sidecar download failed with status ${response.status}.`);
  const text = await response.text();
  const match = String(text).match(/[a-f0-9]{64}/i);
  if (!match) throw new Error('The Sentinel SHA-256 sidecar did not contain a valid digest.');
  return match[0].toLowerCase();
}

function patchUpdateService() {
  const target = require('./services/update-service.cjs');
  const Original = target.UpdateService;
  if (!Original || Original.__nexusSentinelUpdatePatched) return;

  class SentinelUpdateService extends Original {
    constructor(...args) {
      super(...args);
      this.sentinelRelease = null;
      this.rollbackMarker = null;
      this.set({
        product: 'nexus-sentinel',
        updateScope: 'sentinel-only',
        rollbackProtected: true,
        rollbackStatus: 'idle'
      });
    }

    async findRelease() {
      if (typeof this.fetchImpl !== 'function') throw new Error('Network access is unavailable for Sentinel update checks.');
      const response = await this.fetchImpl(RELEASES_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': `Nexus-Sentinel/${this.state.currentVersion}`
        }
      });
      if (!response.ok) throw new Error(`Sentinel release check failed with status ${response.status}.`);
      const releases = await response.json();
      return selectSentinelRelease(releases, this.state.currentVersion, this.updateChannel || 'stable');
    }

    async performCheck() {
      if (this.mode === 'development') {
        this.set({ status: 'development', error: null, lastCheckedAt: new Date().toISOString(), updateScope: 'sentinel-only' });
        return this.getState();
      }
      this.set({ status: 'checking', error: null, progress: null, canDownload: false, canInstall: false, updateScope: 'sentinel-only' });
      try {
        const selected = await this.findRelease();
        if (!selected) {
          this.sentinelRelease = null;
          this.releaseAsset = null;
          this.set({
            status: 'current',
            version: this.state.currentVersion,
            releaseName: 'Nexus Sentinel is current',
            releaseNotes: '',
            releaseUrl: null,
            publishedAt: null,
            lastCheckedAt: new Date().toISOString(),
            canDownload: false,
            canInstall: false,
            verified: false,
            error: null
          });
          return this.getState();
        }

        const release = selected.release;
        this.sentinelRelease = release;
        if (this.mode === 'portable') {
          const asset = sentinelPortableAsset(release);
          if (!asset?.browser_download_url) throw new Error(`Sentinel release ${release.tag_name} is missing its portable Windows asset.`);
          const digest = await resolvePortableDigest(this, release, asset);
          this.releaseAsset = {
            name: asset.name,
            url: asset.browser_download_url,
            size: Number(asset.size) || null,
            digest,
            version: selected.version
          };
          this.set({
            status: 'available',
            version: selected.version,
            releaseName: release.name || `Nexus Sentinel ${selected.version}`,
            releaseNotes: target.normalizeReleaseNotes(release.body),
            releaseUrl: release.html_url || null,
            publishedAt: release.published_at || null,
            lastCheckedAt: new Date().toISOString(),
            canDownload: true,
            canInstall: false,
            verified: false,
            error: null,
            releaseTag: release.tag_name
          });
          return this.getState();
        }

        const setup = sentinelSetupAsset(release);
        const metadata = sentinelUpdateMetadataAsset(release);
        if (!setup || !metadata) throw new Error(`Sentinel release ${release.tag_name} must include its Setup executable and latest.yml before installed builds can update.`);
        const feedUrl = `${RELEASE_DOWNLOAD_ROOT}/${encodeURIComponent(release.tag_name)}`;
        this.updater.setFeedURL({ provider: 'generic', url: feedUrl });
        this.updater.allowPrerelease = Boolean(release.prerelease);
        this.updater.allowDowngrade = false;
        const result = await this.updater.checkForUpdates();
        const info = result?.updateInfo || {};
        this.set({
          releaseName: release.name || `Nexus Sentinel ${selected.version}`,
          releaseNotes: target.normalizeReleaseNotes(release.body),
          releaseUrl: release.html_url || null,
          publishedAt: release.published_at || null,
          lastCheckedAt: new Date().toISOString(),
          version: selected.version,
          releaseTag: release.tag_name,
          updateScope: 'sentinel-only',
          feedVerified: true,
          ...(this.state.status === 'checking' ? { status: 'available', canDownload: true, canInstall: false } : {})
        });
        if (info.version && target.compareVersions(info.version, this.state.currentVersion) <= 0) {
          this.set({ status: 'current', canDownload: false, canInstall: false });
        }
        return this.getState();
      } catch (error) {
        this.handleError(error, 'Nexus Sentinel update check failed');
        throw error;
      }
    }

    async install() {
      const state = this.getState();
      if (state.status !== 'downloaded' || !state.canInstall || !state.verified) {
        throw new Error('A verified Sentinel update must be downloaded before installation.');
      }
      this.set({ rollbackStatus: 'snapshotting' });
      try {
        this.rollbackMarker = prepareRollbackSnapshot(this, state.version);
        this.set({ rollbackStatus: 'armed', rollbackFromVersion: state.currentVersion, rollbackToVersion: state.version });
      } catch (error) {
        this.set({ rollbackStatus: 'failed', error: `Rollback snapshot failed: ${error.message || error}` });
        throw new Error(`Sentinel update was cancelled because rollback protection could not be prepared: ${error.message || error}`);
      }
      return super.install();
    }
  }

  Object.defineProperty(SentinelUpdateService, '__nexusSentinelUpdatePatched', { value: true });
  target.UpdateService = SentinelUpdateService;
}

function monitorPostUpdateAcceptance() {
  electron.app.whenReady().then(() => {
    const markerPath = pendingMarkerPath(electron.app);
    if (!fs.existsSync(markerPath)) return;
    let marker;
    try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); }
    catch { return; }
    if (String(marker?.product || '') !== 'nexus-sentinel') return;
    if (String(marker.targetVersion || '') !== String(electron.app.getVersion())) return;

    const deadline = Date.now() + ((ROLLBACK_TIMEOUT_SECONDS - 20) * 1000);
    const timer = setInterval(() => {
      try {
        const startup = require('./startup-health-extension.cjs').publicState();
        if (startupAccepted(startup)) {
          writeJsonAtomic(marker.acceptancePath || acceptanceMarkerPath(electron.app), {
            accepted: true,
            version: electron.app.getVersion(),
            acceptedAt: new Date().toISOString(),
            startupOverall: startup.overall
          });
          clearInterval(timer);
        } else if (Date.now() >= deadline) {
          clearInterval(timer);
        }
      } catch {
        if (Date.now() >= deadline) clearInterval(timer);
      }
    }, 1000);
    timer.unref?.();
  }).catch(() => {});
}

function install() {
  if (installed) return;
  installed = true;
  patchUpdateService();
  monitorPostUpdateAcceptance();
}

module.exports = {
  install,
  patchUpdateService,
  pendingMarkerPath,
  acceptanceMarkerPath,
  buildRollbackWatchdog,
  prepareRollbackSnapshot,
  resolvePortableDigest
};