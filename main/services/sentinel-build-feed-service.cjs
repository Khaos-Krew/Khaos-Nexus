'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const GITHUB_REPOSITORY = 'Khaos-Krew/Khaos-Nexus';
const CATEGORY_NAME = 'KHAOS NEXUS';
const CHANNEL_NAME = 'nexus-builds';
const CHANNEL_TOPIC = 'Nexus Sentinel test candidates, trusted download artifacts, beta announcements, and released Khaos Nexus versions.';
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const TEST_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const MAX_TRACKED_TEST_PACKAGES = 100;
const MAX_TRACKED_RELEASES = 100;

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1,
  channelId: '',
  categoryId: '',
  announcedTestPackages: Object.freeze([]),
  announcedReleaseIds: Object.freeze([]),
  releasesSeeded: false,
  lastPollAt: null,
  lastSuccessAt: null,
  lastError: null
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function truncate(value, limit) {
  const text = String(value ?? '');
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function snowflake(value) {
  const text = String(value || '').trim();
  return /^\d{5,25}$/.test(text) ? text : '';
}

function normalizeState(input = {}) {
  return {
    schemaVersion: 1,
    channelId: snowflake(input.channelId),
    categoryId: snowflake(input.categoryId),
    announcedTestPackages: [...new Set((Array.isArray(input.announcedTestPackages) ? input.announcedTestPackages : []).map(String).filter(Boolean))].slice(-MAX_TRACKED_TEST_PACKAGES),
    announcedReleaseIds: [...new Set((Array.isArray(input.announcedReleaseIds) ? input.announcedReleaseIds : []).map(String).filter(Boolean))].slice(-MAX_TRACKED_RELEASES),
    releasesSeeded: Boolean(input.releasesSeeded),
    lastPollAt: input.lastPollAt ? String(input.lastPollAt) : null,
    lastSuccessAt: input.lastSuccessAt ? String(input.lastSuccessAt) : null,
    lastError: input.lastError ? truncate(input.lastError, 800) : null
  };
}

function isManualTestWorkflow(run = {}) {
  const name = String(run.name || run.workflow_name || '');
  const branch = String(run.head_branch || '');
  const workflowMatch = /Windows Build|Android Owner Test|Android Build|Beta Build|Release Candidate/i.test(name);
  const branchMatch = /owner-test|beta|release-candidate|(?:^|[/_.-])rc(?:$|[/_.-])|candidate/i.test(branch);
  return workflowMatch && (branchMatch || /Owner Test|Beta Build|Release Candidate/i.test(name));
}

function artifactLooksTestable(artifact = {}) {
  const name = String(artifact.name || '');
  if (!name || artifact.expired === true) return false;
  if (/test-output|smoke-output|diagnostic|audit|checksums?|manifest/i.test(name)) return false;
  return /Khaos[- ]Nexus|Android|Mobile|Windows|APK|Setup|Portable/i.test(name);
}

function artifactDownloadUrl(runId, artifactId) {
  const run = String(runId || '').replace(/[^0-9]/g, '');
  const artifact = String(artifactId || '').replace(/[^0-9]/g, '');
  if (!run || !artifact) return '';
  return `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${run}/artifacts/${artifact}`;
}

function versionFromBuild(group = {}, artifacts = []) {
  const source = [
    group.branch,
    ...artifacts.map((artifact) => artifact.name)
  ].join(' ');
  const match = source.match(/\b\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?/);
  return match ? match[0] : `commit ${String(group.sha || '').slice(0, 7) || 'unknown'}`;
}

function platformSet(artifacts = []) {
  const names = artifacts.map((artifact) => String(artifact.name || '')).join(' ');
  const platforms = [];
  if (/Android|Mobile|APK/i.test(names)) platforms.push('Android');
  if (/Windows|Setup|Portable/i.test(names)) platforms.push('Windows');
  return platforms.length ? platforms : ['General'];
}

function testChecklist(platforms = [], branch = '') {
  const steps = [];
  if (platforms.includes('Windows')) {
    steps.push('Install or update the Windows build and confirm Khaos Nexus opens normally.');
    steps.push('Check the main navigation, scrolling, Discord sign-in, and Nexus Sentinel runtime for hangs or blank/black UI states.');
    steps.push('Exercise the feature or regression area named by the test branch and confirm existing core controls still work.');
  }
  if (platforms.includes('Android')) {
    steps.push('Install the APK, launch it, and verify the mobile UI remains responsive after background/resume.');
    steps.push('Verify pairing/login, secure connection state, current functions/status, and navigation without crashes or unexpected permission prompts.');
  }
  if (platforms.includes('Windows') && platforms.includes('Android')) {
    steps.push('Pair Android to the matching Windows owner-test build and verify the Mobile Gateway handshake and live status path end to end.');
  }
  if (platforms.includes('General')) {
    steps.push('Install or launch the candidate and perform a normal smoke test of startup, navigation, and the feature changed on this branch.');
  }
  if (/owner-test|beta|release-candidate|candidate/i.test(String(branch || ''))) {
    steps.push('Reply with ✅ PASS or ❌ FAIL and include the failed step plus a screenshot/log when available.');
  }
  return steps.slice(0, 7);
}

function markdownList(values, limit = 1024) {
  const lines = (Array.isArray(values) ? values : []).map((value) => `• ${String(value)}`);
  return truncate(lines.join('\n') || 'No checklist was generated.', limit);
}

function buildTestPayload(group, artifacts) {
  const platforms = platformSet(artifacts);
  const version = versionFromBuild(group, artifacts);
  const downloads = artifacts.slice(0, 8).map((artifact) => {
    const url = artifactDownloadUrl(artifact.runId, artifact.id);
    return url ? `[${truncate(artifact.name, 80)}](${url})` : truncate(artifact.name, 100);
  });
  const workflowNames = [...new Set((group.runs || []).map((run) => String(run.name || 'Build')))].join(', ');
  return {
    content: '',
    embeds: [{
      title: `🧪 Testing Needed • Khaos Nexus ${truncate(version, 90)}`,
      description: 'Nexus Sentinel detected a successful owner-test/beta candidate with downloadable GitHub artifacts. Test the items below before promotion.',
      color: 0xf1b94f,
      fields: [
        { name: 'Platforms', value: platforms.join(' + '), inline: true },
        { name: 'Branch', value: `\`${truncate(group.branch || 'unknown', 80)}\``, inline: true },
        { name: 'Commit', value: `\`${truncate(String(group.sha || '').slice(0, 12) || 'unknown', 20)}\``, inline: true },
        { name: 'Build workflows', value: truncate(workflowNames || 'Build', 1024), inline: false },
        { name: 'What to test', value: markdownList(testChecklist(platforms, group.branch)), inline: false },
        { name: 'Download and test', value: truncate(downloads.join('\n') || 'No downloadable artifact was found.', 1024), inline: false },
        { name: 'CI evidence', value: group.runUrl ? `[Open successful workflow run](${group.runUrl})` : 'Workflow link unavailable', inline: false }
      ],
      footer: { text: 'Nexus Sentinel • Owner testing queue' },
      timestamp: group.updatedAt || new Date().toISOString()
    }],
    allowed_mentions: { parse: [] }
  };
}

function releaseKind(release = {}) {
  const tag = String(release.tag_name || release.name || '');
  return release.prerelease === true || /(?:beta|alpha|\brc\b|-B(?:$|[.-]))/i.test(tag) ? 'beta' : 'release';
}

function releasePayload(release = {}) {
  const kind = releaseKind(release);
  const tag = String(release.tag_name || release.name || 'Unknown');
  const assets = (Array.isArray(release.assets) ? release.assets : [])
    .filter((asset) => asset?.browser_download_url)
    .slice(0, 6)
    .map((asset) => `[${truncate(asset.name || 'Download', 80)}](${asset.browser_download_url})`);
  return {
    content: '',
    embeds: [{
      title: kind === 'beta' ? `🧪 New Beta • ${truncate(tag, 120)}` : `🚀 New Release • ${truncate(tag, 120)}`,
      description: truncate(release.body || (kind === 'beta' ? 'A Khaos Nexus beta has passed its publication gates and is available.' : 'A Khaos Nexus version has passed its publication gates and is released.'), 3500),
      color: kind === 'beta' ? 0xf1b94f : 0x4bd89c,
      fields: [
        { name: 'Channel', value: kind === 'beta' ? 'Beta / prerelease' : 'Stable release', inline: true },
        { name: 'Published', value: release.published_at ? `<t:${Math.floor(new Date(release.published_at).getTime() / 1000)}:R>` : 'Just now', inline: true },
        { name: 'Downloads', value: truncate(assets.join('\n') || (release.html_url ? `[Open release page](${release.html_url})` : 'No release assets listed.'), 1024), inline: false },
        ...(release.html_url ? [{ name: 'Release notes', value: `[Open the GitHub release](${release.html_url})`, inline: false }] : [])
      ],
      footer: { text: 'Nexus Sentinel • Published build feed' },
      timestamp: release.published_at || new Date().toISOString()
    }],
    allowed_mentions: { parse: [] }
  };
}

class SentinelBuildFeedService {
  constructor({
    configStore,
    logger,
    dataDirectory,
    restFactory,
    fetchImpl = global.fetch,
    now = () => new Date(),
    setIntervalFactory = setInterval,
    clearIntervalFactory = clearInterval,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fsImpl = fs
  } = {}) {
    this.configStore = configStore;
    this.logger = logger || { info() {}, warn() {}, error() {} };
    this.dataDirectory = dataDirectory;
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.setIntervalFactory = setIntervalFactory;
    this.clearIntervalFactory = clearIntervalFactory;
    this.pollIntervalMs = Math.max(60_000, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
    this.fs = fsImpl;
    this.statePath = path.join(dataDirectory, 'sentinel-build-feed.json');
    this.state = this.loadState();
    this.timer = null;
    this.polling = false;
  }

  loadState() {
    try {
      return normalizeState(JSON.parse(this.fs.readFileSync(this.statePath, 'utf8')));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        try { this.fs.renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`); } catch {}
      }
      return normalizeState(DEFAULT_STATE);
    }
  }

  saveState() {
    this.fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    this.fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    this.fs.renameSync(temporary, this.statePath);
  }

  bootstrap() {
    return this.configStore?.getRuntimeBootstrap?.() || { discordToken: '', config: {} };
  }

  guildId() {
    return snowflake(this.bootstrap().config?.discord?.guildId);
  }

  discordToken() {
    return String(this.bootstrap().discordToken || '').trim();
  }

  rest() {
    const token = this.discordToken();
    if (!token) throw new Error('Nexus Sentinel build feed is waiting for the Discord bot token.');
    return this.restFactory(token);
  }

  githubHeaders() {
    const token = String(this.configStore?.getGithubToken?.() || '').trim();
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Khaos-Nexus-Sentinel-Build-Feed',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async github(endpoint) {
    if (typeof this.fetchImpl !== 'function') throw new Error('GitHub polling is unavailable in this build.');
    const response = await this.fetchImpl(`https://api.github.com/repos/${GITHUB_REPOSITORY}${endpoint}`, { headers: this.githubHeaders() });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) throw new Error(payload?.message || `GitHub build-feed request failed with status ${response.status}.`);
    return payload;
  }

  async ensureChannel() {
    const guildId = this.guildId();
    if (!guildId || !this.discordToken()) return { ready: false, reason: 'discord-not-configured' };
    const rest = this.rest();
    const channels = await rest.get(Routes.guildChannels(guildId));
    const list = Array.isArray(channels) ? channels : [];
    let category = list.find((channel) => Number(channel.type) === 4 && String(channel.name || '').trim().toLowerCase() === CATEGORY_NAME.toLowerCase());
    if (!category) {
      category = await rest.post(Routes.guildChannels(guildId), { body: { name: CATEGORY_NAME, type: 4 } });
      this.logger.info('Nexus Sentinel created the KHAOS NEXUS Discord category for the build feed.');
    }
    let channel = list.find((item) => Number(item.type) === 0 && String(item.parent_id || '') === String(category.id) && String(item.name || '').trim().toLowerCase() === CHANNEL_NAME);
    if (!channel) {
      channel = await rest.post(Routes.guildChannels(guildId), {
        body: { name: CHANNEL_NAME, type: 0, parent_id: String(category.id), topic: CHANNEL_TOPIC, nsfw: false }
      });
      this.logger.info('Nexus Sentinel created the Discord build testing channel.', { channel: CHANNEL_NAME });
    }
    this.state.categoryId = String(category.id || '');
    this.state.channelId = String(channel.id || '');
    this.saveState();
    return { ready: Boolean(this.state.channelId), guildId, categoryId: this.state.categoryId, channelId: this.state.channelId };
  }

  async post(payload) {
    if (!this.state.channelId) await this.ensureChannel();
    if (!this.state.channelId) throw new Error('Nexus Sentinel build channel is not ready.');
    return this.rest().post(Routes.channelMessages(this.state.channelId), { body: payload });
  }

  async fetchArtifacts(run) {
    const payload = await this.github(`/actions/runs/${run.id}/artifacts?per_page=100`);
    return (Array.isArray(payload?.artifacts) ? payload.artifacts : [])
      .filter(artifactLooksTestable)
      .map((artifact) => ({ ...artifact, runId: run.id }));
  }

  async processTestRuns(runs = []) {
    const cutoff = this.now().getTime() - TEST_LOOKBACK_MS;
    const candidates = runs.filter((run) => {
      const created = new Date(run.created_at || run.run_started_at || 0).getTime();
      return isManualTestWorkflow(run) && Number.isFinite(created) && created >= cutoff;
    });
    const groups = new Map();
    for (const run of candidates) {
      const key = String(run.head_sha || run.head_branch || run.id || 'unknown');
      const group = groups.get(key) || { sha: String(run.head_sha || ''), branch: String(run.head_branch || ''), runs: [] };
      group.runs.push(run);
      if (!group.branch) group.branch = String(run.head_branch || '');
      if (!group.sha) group.sha = String(run.head_sha || '');
      groups.set(key, group);
    }

    for (const group of [...groups.values()].slice(0, 10)) {
      if (group.runs.some((run) => String(run.status || '') !== 'completed')) continue;
      const successful = group.runs.filter((run) => String(run.conclusion || '') === 'success');
      if (!successful.length) continue;
      const artifacts = [];
      for (const run of successful) {
        try { artifacts.push(...await this.fetchArtifacts(run)); }
        catch (error) { this.logger.warn('Could not inspect one successful build artifact set.', { runId: run.id, message: error.message }); }
      }
      if (!artifacts.length) continue;
      const ids = [...new Set(artifacts.map((artifact) => String(artifact.id)))].sort();
      const packageKey = `${group.sha || group.branch}:${ids.join(',')}`;
      if (this.state.announcedTestPackages.includes(packageKey)) continue;
      const newest = successful.slice().sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
      group.runUrl = String(newest?.html_url || '');
      group.updatedAt = newest?.updated_at || newest?.created_at || this.now().toISOString();
      await this.post(buildTestPayload(group, artifacts));
      this.state.announcedTestPackages = [...this.state.announcedTestPackages, packageKey].slice(-MAX_TRACKED_TEST_PACKAGES);
      this.saveState();
      this.logger.info('Nexus Sentinel posted a manual testing package.', { branch: group.branch, artifacts: artifacts.length });
    }
  }

  async processReleases(releases = []) {
    const published = (Array.isArray(releases) ? releases : []).filter((release) => !release.draft && release.id);
    if (!this.state.releasesSeeded) {
      this.state.announcedReleaseIds = published.map((release) => String(release.id)).slice(0, MAX_TRACKED_RELEASES);
      this.state.releasesSeeded = true;
      this.saveState();
      return;
    }
    for (const release of published.slice().reverse()) {
      const id = String(release.id);
      if (this.state.announcedReleaseIds.includes(id)) continue;
      await this.post(releasePayload(release));
      this.state.announcedReleaseIds = [...this.state.announcedReleaseIds, id].slice(-MAX_TRACKED_RELEASES);
      this.saveState();
      this.logger.info('Nexus Sentinel posted a beta/release announcement.', { tag: release.tag_name, prerelease: Boolean(release.prerelease) });
    }
  }

  async poll() {
    if (this.polling) return { skipped: true, reason: 'poll-in-progress' };
    this.polling = true;
    this.state.lastPollAt = this.now().toISOString();
    this.saveState();
    try {
      const channel = await this.ensureChannel();
      if (!channel.ready) return { skipped: true, reason: channel.reason || 'channel-not-ready' };
      const [runPayload, releases] = await Promise.all([
        this.github('/actions/runs?per_page=40'),
        this.github('/releases?per_page=20')
      ]);
      await this.processTestRuns(Array.isArray(runPayload?.workflow_runs) ? runPayload.workflow_runs : []);
      await this.processReleases(releases);
      this.state.lastSuccessAt = this.now().toISOString();
      this.state.lastError = null;
      this.saveState();
      return { ok: true, channelId: this.state.channelId };
    } catch (error) {
      this.state.lastError = truncate(error.message || String(error), 800);
      this.saveState();
      this.logger.warn('Nexus Sentinel build feed poll failed.', { message: this.state.lastError });
      return { ok: false, error: this.state.lastError };
    } finally {
      this.polling = false;
    }
  }

  start() {
    if (this.timer) return;
    this.poll().catch(() => {});
    this.timer = this.setIntervalFactory(() => this.poll().catch(() => {}), this.pollIntervalMs);
    this.timer?.unref?.();
  }

  stop() {
    if (this.timer) this.clearIntervalFactory(this.timer);
    this.timer = null;
  }

  getState() {
    return clone(this.state);
  }
}

module.exports = {
  GITHUB_REPOSITORY,
  CATEGORY_NAME,
  CHANNEL_NAME,
  CHANNEL_TOPIC,
  DEFAULT_STATE,
  normalizeState,
  isManualTestWorkflow,
  artifactLooksTestable,
  artifactDownloadUrl,
  versionFromBuild,
  platformSet,
  testChecklist,
  buildTestPayload,
  releaseKind,
  releasePayload,
  SentinelBuildFeedService
};
