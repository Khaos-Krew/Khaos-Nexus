'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY = 'Khaos-Krew/Khaos-Nexus';
const CHECKLIST = Object.freeze([
  { id: 'startup', label: 'Nexus starts cleanly and the local backend becomes healthy.' },
  { id: 'navigation', label: 'Admin Control Center navigation and layout work normally.' },
  { id: 'accounts', label: 'Accounts & Access loads and Discord-linked household accounts remain intact.' },
  { id: 'sentinal-health', label: 'Nexus Sentinal health/status is reachable from the desktop.' },
  { id: 'discord-permissions', label: 'Discord permission and role-hierarchy checks report correctly.' },
  { id: 'roles', label: 'Rank/entitlement reconciliation produces the expected Discord role plan.' },
  { id: 'channels', label: 'Channel/category reconcile preserves existing channels and restores only missing layout.' },
  { id: 'panels', label: 'Permanent Sentinal module panels refresh in the correct channels.' },
  { id: 'commands', label: 'Sentinal command synchronization preserves unrelated Discord commands.' },
  { id: 'updater', label: 'Updater detects/stages the correct channel and only applies after Restart & Apply.' },
  { id: 'thora', label: 'Private Thora bridge still launches correctly when configured.' }
]);

function ensureDirectory(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) {
  ensureDirectory(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
function clean(value, max = 4000) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function safeStatus(value) { return ['not-tested', 'working', 'failed'].includes(value) ? value : 'not-tested'; }

class OwnerTestService {
  constructor(options = {}) {
    this.currentVersion = String(options.currentVersion || '0.0.0');
    this.userDataPath = path.resolve(options.userDataPath || process.cwd());
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.filePath = path.join(this.userDataPath, 'owner-test', 'feedback.json');
    this.repository = REPOSITORY;
  }

  read() {
    const data = readJson(this.filePath, { version: 1, builds: {} });
    data.version = 1;
    data.builds ||= {};
    return data;
  }

  write(data) { writeJson(this.filePath, data); }

  feedback(version = this.currentVersion) {
    const state = this.read();
    const build = state.builds[version] || { items: {}, updatedAt: '' };
    const items = CHECKLIST.map((item) => ({
      ...item,
      status: safeStatus(build.items?.[item.id]?.status),
      note: clean(build.items?.[item.id]?.note || '', 500),
      updatedAt: String(build.items?.[item.id]?.updatedAt || '')
    }));
    const counts = {
      working: items.filter((item) => item.status === 'working').length,
      failed: items.filter((item) => item.status === 'failed').length,
      notTested: items.filter((item) => item.status === 'not-tested').length
    };
    return { version, items, counts, updatedAt: build.updatedAt || '' };
  }

  setFeedback(version, itemId, status, note = '') {
    version = clean(version, 60) || this.currentVersion;
    itemId = clean(itemId, 60);
    if (!CHECKLIST.some((item) => item.id === itemId)) throw new Error('Unknown Owner Test checklist item.');
    status = safeStatus(status);
    const state = this.read();
    state.builds[version] ||= { items: {}, updatedAt: '' };
    const now = new Date().toISOString();
    state.builds[version].items[itemId] = { status, note: clean(note, 500), updatedAt: now };
    state.builds[version].updatedAt = now;
    this.write(state);
    return this.feedback(version);
  }

  async json(url, timeoutMs = 12000) {
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': `Khaos-Nexus-Owner-Test/${this.currentVersion}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);
    return response.json();
  }

  async releaseBuilds(limit = 8) {
    try {
      const releases = await this.json(`https://api.github.com/repos/${this.repository}/releases?per_page=20`);
      const selected = (Array.isArray(releases) ? releases : [])
        .filter((release) => release && release.draft !== true && release.prerelease === true)
        .filter((release) => (release.assets || []).some((asset) => asset.name === 'nexus-update-manifest.json'))
        .slice(0, Math.max(1, Math.min(Number(limit) || 8, 12)));
      const builds = [];
      for (const release of selected) {
        const manifestAsset = release.assets.find((asset) => asset.name === 'nexus-update-manifest.json');
        let manifest = null;
        try { manifest = await this.json(manifestAsset.browser_download_url); } catch {}
        const version = clean(manifest?.version || release.tag_name || '', 60).replace(/^v/i, '');
        builds.push({
          version,
          name: clean(release.name || release.tag_name || version, 160),
          publishedAt: String(release.published_at || release.created_at || ''),
          url: String(release.html_url || ''),
          commitSha: /^[0-9a-f]{40}$/i.test(String(manifest?.commitSha || '')) ? String(manifest.commitSha) : '',
          notes: clean(manifest?.notes || release.body || '', 2000),
          packageName: clean(manifest?.package?.name || '', 180),
          packageSize: Number(manifest?.package?.size || 0),
          validation: manifest?.validation && typeof manifest.validation === 'object' ? manifest.validation : null,
          feedback: this.feedback(version)
        });
      }
      return { ok: true, builds };
    } catch (error) {
      return { ok: false, builds: [], message: clean(error?.message || error, 240) };
    }
  }

  async workflowStatus(commitSha) {
    if (!/^[0-9a-f]{40}$/i.test(String(commitSha || ''))) return { ok: false, state: 'unknown', runs: [] };
    try {
      const value = await this.json(`https://api.github.com/repos/${this.repository}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=20`);
      const runs = (value.workflow_runs || []).map((run) => ({
        id: Number(run.id || 0),
        name: clean(run.name || '', 120),
        status: clean(run.status || '', 40),
        conclusion: clean(run.conclusion || '', 40),
        url: String(run.html_url || '')
      }));
      const failed = runs.some((run) => run.conclusion && run.conclusion !== 'success' && run.conclusion !== 'skipped' && run.conclusion !== 'neutral');
      const active = runs.some((run) => run.status && run.status !== 'completed');
      return { ok: !failed, state: failed ? 'failed' : active ? 'running' : runs.length ? 'passed' : 'unknown', runs };
    } catch (error) {
      return { ok: false, state: 'unknown', runs: [], message: clean(error?.message || error, 240) };
    }
  }

  async snapshot() {
    const releases = await this.releaseBuilds();
    const currentFeedback = this.feedback(this.currentVersion);
    const currentRelease = releases.builds.find((build) => build.version === this.currentVersion) || releases.builds[0] || null;
    const ci = currentRelease?.commitSha ? await this.workflowStatus(currentRelease.commitSha) : { ok: false, state: 'unknown', runs: [] };
    return {
      ok: true,
      currentVersion: this.currentVersion,
      checklist: currentFeedback,
      currentRelease,
      ci,
      builds: releases.builds,
      releaseLookupOk: releases.ok,
      releaseLookupMessage: releases.message || ''
    };
  }
}

module.exports = { CHECKLIST, OwnerTestService, REPOSITORY, safeStatus };
