'use strict';

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const packageInfo = require('../../package.json');
const {
  normalizeReleaseList,
  expectedRollbackConfirmation,
  checksumForAsset,
  compareReleaseVersions
} = require('../../shared/release-labels.cjs');

const RELEASES_URL = 'https://api.github.com/repos/Khaos-Krew/Khaos-Nexus/releases?per_page=30';
const CACHE_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024;
const HISTORY_LIMIT = 50;

function trustedGithubUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'api.github.com' || host === 'github.com' || host.endsWith('.githubusercontent.com');
  } catch {
    return false;
  }
}

function requestBuffer(url, options = {}, redirects = 0) {
  if (!trustedGithubUrl(url)) return Promise.reject(new Error('The release URL was not trusted.'));
  if (redirects > 5) return Promise.reject(new Error('Too many release download redirects.'));
  const maxBytes = Number(options.maxBytes || MAX_RESPONSE_BYTES);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Khaos-Nexus-Desktop',
        Accept: options.accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        const next = new URL(location, url).toString();
        requestBuffer(next, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`GitHub release request failed with HTTP ${response.statusCode}.`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          request.destroy(new Error('The GitHub release response exceeded its safe size limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('The GitHub release request timed out.')));
    request.on('error', reject);
  });
}

async function requestJson(url) {
  const body = await requestBuffer(url, { maxBytes: MAX_RESPONSE_BYTES });
  try { return JSON.parse(body.toString('utf8')); }
  catch { throw new Error('GitHub returned invalid release metadata.'); }
}

async function requestText(url) {
  const body = await requestBuffer(url, { maxBytes: 1024 * 1024, accept: 'text/plain' });
  return body.toString('utf8');
}

function downloadFile(url, filePath, redirects = 0) {
  if (!trustedGithubUrl(url)) return Promise.reject(new Error('The release asset URL was not trusted.'));
  if (redirects > 5) return Promise.reject(new Error('Too many release asset redirects.'));
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.partial`;
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Khaos-Nexus-Desktop',
        Accept: 'application/octet-stream'
      }
    }, (response) => {
      const location = response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        const next = new URL(location, url).toString();
        downloadFile(next, filePath, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Release asset download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const output = fs.createWriteStream(temporaryPath, { flags: 'wx' });
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        output.destroy();
        try { fs.rmSync(temporaryPath, { force: true }); } catch {}
        reject(error);
      };

      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) {
          request.destroy(new Error('The release asset exceeded its safe size limit.'));
          return;
        }
        hash.update(chunk);
      });
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', () => {
        if (settled) return;
        settled = true;
        try {
          fs.renameSync(temporaryPath, filePath);
          resolve({ filePath, bytes, sha256: hash.digest('hex') });
        } catch (error) {
          try { fs.rmSync(temporaryPath, { force: true }); } catch {}
          reject(error);
        }
      });
      response.pipe(output);
    });
    request.setTimeout(120_000, () => request.destroy(new Error('The release asset download timed out.')));
    request.on('error', (error) => {
      try { fs.rmSync(`${filePath}.partial`, { force: true }); } catch {}
      reject(error);
    });
  });
}

function publicRelease(release) {
  return {
    id: release.id,
    tagName: release.tagName,
    label: release.label,
    internalVersion: release.internalVersion,
    channel: release.channel,
    legacyLabel: release.legacyLabel,
    publishedAt: release.publishedAt,
    notes: release.notes,
    compatible: release.compatible,
    digestAvailable: release.digestAvailable,
    isCurrent: release.isCurrent,
    isNewer: release.isNewer,
    isOlder: release.isOlder,
    meetsDataFloor: release.meetsDataFloor,
    canRollback: release.canRollback,
    blockedReason: release.blockedReason
  };
}

function safeHistoryEntry(entry) {
  return {
    id: String(entry.id || ''),
    operation: 'rollback',
    status: String(entry.status || 'unknown'),
    previousVersion: String(entry.previousVersion || ''),
    targetVersion: String(entry.targetVersion || ''),
    targetTag: String(entry.targetTag || ''),
    assetName: String(entry.assetName || ''),
    assetSha256: String(entry.assetSha256 || ''),
    backupName: String(entry.backupName || ''),
    startedAt: String(entry.startedAt || ''),
    finishedAt: String(entry.finishedAt || ''),
    error: String(entry.error || '').slice(0, 1200)
  };
}

class ReleaseHistoryService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = options.app;
    this.logger = options.logger || null;
    this.getAutonomy = options.getAutonomy || (() => null);
    this.getDiscordAuth = options.getDiscordAuth || (() => null);
    this.requestJson = options.requestJson || requestJson;
    this.requestText = options.requestText || requestText;
    this.downloadFile = options.downloadFile || downloadFile;
    this.spawn = options.spawn || spawn;
    this.clock = options.clock || (() => new Date());
    this.quitDelayMs = Number.isFinite(options.quitDelayMs) ? options.quitDelayMs : 700;
    this.mode = options.mode || (process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : 'installed');
    this.currentVersion = String(options.currentVersion || this.app?.getVersion?.() || packageInfo.version || '0.0.0');
    this.currentLabel = String(options.currentLabel || packageInfo.khaosRelease?.displayVersion || this.currentVersion);
    this.channel = String(options.channel || packageInfo.khaosRelease?.channel || 'stable');
    this.dataCompatibilityFloor = String(options.dataCompatibilityFloor || packageInfo.khaosRelease?.dataCompatibilityFloor || '0.26.0');
    this.cache = { at: 0, releases: [] };
    this.state = {
      status: 'idle',
      error: null,
      refreshedAt: null,
      currentVersion: this.currentVersion,
      currentLabel: this.currentLabel,
      channel: this.channel,
      mode: this.mode,
      dataCompatibilityFloor: this.dataCompatibilityFloor,
      releases: [],
      rollbackHistory: this.readHistory()
    };
  }

  historyPath() {
    return path.join(this.app.getPath('userData'), 'update-rollback-history.json');
  }

  readHistory() {
    try {
      const value = JSON.parse(fs.readFileSync(this.historyPath(), 'utf8'));
      return (Array.isArray(value) ? value : []).map(safeHistoryEntry).slice(0, HISTORY_LIMIT);
    } catch {
      return [];
    }
  }

  writeHistory(entries) {
    const normalized = (Array.isArray(entries) ? entries : []).map(safeHistoryEntry).slice(0, HISTORY_LIMIT);
    const filePath = this.historyPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, filePath);
    this.state.rollbackHistory = normalized;
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  getState() {
    return {
      ...this.state,
      releases: this.state.releases.map((release) => ({ ...release })),
      rollbackHistory: this.state.rollbackHistory.map((entry) => ({ ...entry }))
    };
  }

  assertOwner(action) {
    const autonomy = this.getAutonomy();
    const auth = this.getDiscordAuth();
    if (!autonomy?.assertAccess) throw new Error('The Owner access service is not ready.');
    autonomy.assertAccess(auth?.getState?.(), 'owner', action);
  }

  async refresh(force = false) {
    this.assertOwner('Review Khaos Nexus update history');
    const now = Date.now();
    if (!force && this.cache.releases.length && now - this.cache.at < CACHE_MS) {
      this.updateState({ status: 'ready', error: null, releases: this.cache.releases.map(publicRelease) });
      return this.getState();
    }

    this.updateState({ status: 'loading', error: null });
    try {
      const raw = await this.requestJson(RELEASES_URL);
      if (!Array.isArray(raw)) throw new Error('GitHub did not return a release list.');
      const releases = normalizeReleaseList(raw, {
        mode: this.mode,
        currentVersion: this.currentVersion,
        dataCompatibilityFloor: this.dataCompatibilityFloor
      });
      this.cache = { at: now, releases };
      this.updateState({
        status: 'ready',
        error: null,
        refreshedAt: this.clock().toISOString(),
        releases: releases.map(publicRelease)
      });
      return this.getState();
    } catch (error) {
      const message = String(error?.message || error || 'Release history refresh failed.');
      this.updateState({ status: 'error', error: message });
      throw new Error(message);
    }
  }

  async expectedHash(release, asset) {
    if (asset?.digest) return asset.digest.replace(/^sha256:/i, '').toLowerCase();
    const checksumAsset = release?.assets?.checksums;
    if (!checksumAsset?.url) throw new Error('This release does not provide a trusted SHA-256 digest.');
    const text = await this.requestText(checksumAsset.url);
    const hash = checksumForAsset(text, asset.name);
    if (!hash) throw new Error(`The checksum file does not contain ${asset.name}.`);
    return hash;
  }

  async rollback(payload = {}) {
    this.assertOwner('Rollback Khaos Nexus');
    const tagName = String(payload.tagName || '').trim();
    if (!tagName) throw new Error('Choose a release to roll back to.');
    const confirmation = String(payload.confirmation || '');
    const releases = (await this.refresh(true), this.cache.releases);
    const release = releases.find((item) => item.tagName === tagName);
    if (!release) throw new Error('The selected release is no longer available in the trusted release history.');
    const expected = expectedRollbackConfirmation(release.label);
    if (confirmation !== expected) throw new Error(`Type ${expected} exactly to confirm the rollback.`);
    if (!release.canRollback) throw new Error(release.blockedReason || 'This release cannot be used for rollback.');
    if (compareReleaseVersions(release.internalVersion, this.dataCompatibilityFloor) < 0) {
      throw new Error(`Rollback below the data compatibility floor ${this.dataCompatibilityFloor} is blocked.`);
    }

    const asset = this.mode === 'portable' ? release.assets.portable : release.assets.installer;
    if (!asset?.url || !asset?.name) throw new Error('The selected release is missing its Windows rollback asset.');
    const startedAt = this.clock().toISOString();
    const record = safeHistoryEntry({
      id: crypto.randomUUID(),
      status: 'starting',
      previousVersion: this.currentVersion,
      targetVersion: release.internalVersion,
      targetTag: release.tagName,
      assetName: asset.name,
      startedAt
    });
    this.writeHistory([record, ...this.state.rollbackHistory]);
    this.updateState({ status: 'backing-up', error: null });

    try {
      const autonomy = this.getAutonomy();
      if (!autonomy?.createAutomaticBackup || !autonomy?.verifyBackup) {
        throw new Error('The verified backup service is not ready.');
      }
      const backup = autonomy.createAutomaticBackup('pre-rollback');
      if (!backup?.valid || !backup.filePath) throw new Error('The backup service did not return a verified backup file.');
      autonomy.verifyBackup(backup.filePath);
      record.backupName = path.basename(backup.filePath);
      record.status = 'downloading';
      this.writeHistory([record, ...this.state.rollbackHistory.filter((entry) => entry.id !== record.id)]);
      this.updateState({ status: 'downloading', error: null });

      const expectedSha256 = await this.expectedHash(release, asset);
      const destination = path.join(this.app.getPath('userData'), 'updates', 'rollback', asset.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
      try { fs.rmSync(destination, { force: true }); } catch {}
      const downloaded = await this.downloadFile(asset.url, destination);
      if (downloaded.sha256.toLowerCase() !== expectedSha256) {
        try { fs.rmSync(destination, { force: true }); } catch {}
        throw new Error('The downloaded rollback asset failed SHA-256 verification.');
      }

      record.assetSha256 = downloaded.sha256.toLowerCase();
      record.status = 'launching';
      this.writeHistory([record, ...this.state.rollbackHistory.filter((entry) => entry.id !== record.id)]);
      this.updateState({ status: 'launching', error: null });

      const child = this.spawn(destination, [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref?.();
      record.status = 'launched';
      record.finishedAt = this.clock().toISOString();
      this.writeHistory([record, ...this.state.rollbackHistory.filter((entry) => entry.id !== record.id)]);
      this.updateState({ status: 'launched', error: null });
      this.logger?.warn?.('Verified Khaos Nexus rollback installer launched.', {
        previousVersion: this.currentVersion,
        targetVersion: release.internalVersion,
        targetTag: release.tagName,
        assetName: asset.name,
        sha256: downloaded.sha256
      });
      setTimeout(() => this.app.quit(), this.quitDelayMs).unref?.();
      return {
        launched: true,
        targetTag: release.tagName,
        targetVersion: release.internalVersion,
        assetName: asset.name,
        assetSha256: downloaded.sha256,
        backupName: record.backupName
      };
    } catch (error) {
      const message = String(error?.message || error || 'Rollback failed.');
      record.status = 'failed';
      record.finishedAt = this.clock().toISOString();
      record.error = message;
      this.writeHistory([record, ...this.state.rollbackHistory.filter((entry) => entry.id !== record.id)]);
      this.updateState({ status: 'error', error: message });
      this.logger?.error?.('Khaos Nexus rollback stopped safely.', {
        targetTag: release.tagName,
        message
      });
      throw new Error(`${message} The current version remains active and the verified backup was preserved.`);
    }
  }
}

module.exports = {
  RELEASES_URL,
  CACHE_MS,
  trustedGithubUrl,
  requestBuffer,
  requestJson,
  requestText,
  downloadFile,
  publicRelease,
  safeHistoryEntry,
  ReleaseHistoryService
};
