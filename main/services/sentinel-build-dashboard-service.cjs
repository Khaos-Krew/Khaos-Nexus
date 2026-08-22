'use strict';

const path = require('node:path');
const { Routes } = require('discord.js');
const {
  SentinelBuildFeedService,
  isManualTestWorkflow,
  buildTestPayload
} = require('./sentinel-build-feed-service.cjs');

const TEST_REACTION_PASS = '✅';
const TEST_REACTION_FAIL = '❌';
const TEST_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const DASHBOARD_STATE_VERSION = 1;

function snowflake(value) {
  const text = String(value || '').trim();
  return /^\d{5,25}$/.test(text) ? text : '';
}

function emptyVerdict() {
  return { status: 'pending', pass: [], fail: [], conflicts: [], fingerprint: 'pass:|fail:|conflict:' };
}

function testerName(user = {}) {
  return String(user.global_name || user.username || user.id || 'Unknown tester').slice(0, 40);
}

function buildVerdict(passUsers = [], failUsers = []) {
  const human = (users) => (Array.isArray(users) ? users : []).filter((user) => user?.id && !user.bot);
  const passById = new Map(human(passUsers).map((user) => [String(user.id), user]));
  const failById = new Map(human(failUsers).map((user) => [String(user.id), user]));
  const conflictIds = [...passById.keys()].filter((id) => failById.has(id)).sort();
  const conflictSet = new Set(conflictIds);
  const pass = [...passById.entries()].filter(([id]) => !conflictSet.has(id)).map(([, user]) => user);
  const fail = [...failById.entries()].filter(([id]) => !conflictSet.has(id)).map(([, user]) => user);
  const conflicts = conflictIds.map((id) => passById.get(id) || failById.get(id));
  return {
    status: fail.length ? 'failed' : pass.length ? 'working' : conflicts.length ? 'conflict' : 'pending',
    pass,
    fail,
    conflicts,
    fingerprint: [
      `pass:${pass.map((user) => user.id).sort().join(',')}`,
      `fail:${fail.map((user) => user.id).sort().join(',')}`,
      `conflict:${conflicts.map((user) => user.id).sort().join(',')}`
    ].join('|')
  };
}

function verdictText(verdict = emptyVerdict()) {
  const lines = [];
  if (verdict.status === 'failed') lines.push('❌ **FAILED** — at least one tester reported a failure.');
  else if (verdict.status === 'working') lines.push('✅ **WORKING** — at least one tester passed this candidate.');
  else if (verdict.status === 'conflict') lines.push('⚠️ **CHECK REACTIONS** — one or more testers selected both results.');
  else lines.push('⏳ **WAITING FOR TEST RESULT**');
  if (verdict.pass.length) lines.push(`✅ Pass: ${verdict.pass.map(testerName).join(', ')}`);
  if (verdict.fail.length) lines.push(`❌ Fail: ${verdict.fail.map(testerName).join(', ')}`);
  if (verdict.conflicts.length) lines.push(`⚠️ Both selected: ${verdict.conflicts.map(testerName).join(', ')}`);
  lines.push('React ✅ for working or ❌ for failed. Sentinel updates this card automatically.');
  return lines.join('\n').slice(0, 1024);
}

function dashboardPayload(group, artifacts, verdict = emptyVerdict()) {
  const payload = buildTestPayload(group, artifacts);
  const embed = payload.embeds?.[0];
  if (!embed) return payload;
  const prefix = verdict.status === 'failed' ? '❌ Failed' : verdict.status === 'working' ? '✅ Working' : '🧪 Testing Needed';
  embed.title = String(embed.title || '').replace(/^.*?•/, `${prefix} •`);
  embed.color = verdict.status === 'failed' ? 0xed4245 : verdict.status === 'working' ? 0x57f287 : 0xf1b94f;
  embed.description = 'Nexus Sentinel keeps one live owner-testing card. New candidate builds replace this card instead of creating repeated build posts.';
  const checklist = embed.fields?.find((field) => field.name === 'What to test');
  if (checklist) {
    checklist.value = String(checklist.value || '').replace(
      /• Reply with ✅ PASS or ❌ FAIL[^\n]*/i,
      '• React ✅ if the candidate works or ❌ if it fails. If it fails, reply with the failed step plus a screenshot/log when available.'
    );
  }
  const fields = Array.isArray(embed.fields) ? embed.fields : [];
  const existing = fields.find((field) => field.name === 'Tester verdict');
  if (existing) existing.value = verdictText(verdict);
  else fields.splice(Math.min(4, fields.length), 0, { name: 'Tester verdict', value: verdictText(verdict), inline: false });
  embed.fields = fields;
  embed.footer = { text: 'Nexus Sentinel • Live owner testing queue' };
  return payload;
}

class SentinelBuildDashboardService extends SentinelBuildFeedService {
  constructor(options = {}) {
    super(options);
    this.dashboardStatePath = path.join(this.dataDirectory, 'sentinel-build-dashboard.json');
    this.dashboard = this.loadDashboardState();
  }

  loadDashboardState() {
    try {
      const input = JSON.parse(this.fs.readFileSync(this.dashboardStatePath, 'utf8'));
      return {
        schemaVersion: DASHBOARD_STATE_VERSION,
        messageId: snowflake(input.messageId),
        packageKey: String(input.packageKey || ''),
        verdictFingerprint: String(input.verdictFingerprint || ''),
        lastVerdictSyncAt: input.lastVerdictSyncAt ? String(input.lastVerdictSyncAt) : null
      };
    } catch {
      return { schemaVersion: DASHBOARD_STATE_VERSION, messageId: '', packageKey: '', verdictFingerprint: '', lastVerdictSyncAt: null };
    }
  }

  saveDashboardState() {
    this.fs.mkdirSync(path.dirname(this.dashboardStatePath), { recursive: true });
    const temporary = `${this.dashboardStatePath}.tmp`;
    this.fs.writeFileSync(temporary, JSON.stringify(this.dashboard, null, 2), 'utf8');
    this.fs.renameSync(temporary, this.dashboardStatePath);
  }

  isMissingMessageError(error) {
    return Number(error?.status || error?.statusCode) === 404 || Number(error?.code || error?.rawError?.code) === 10008;
  }

  isPermissionError(error) {
    return Number(error?.status || error?.statusCode) === 403 || Number(error?.code || error?.rawError?.code) === 50013;
  }

  async seedVerdictReactions(messageId) {
    for (const emoji of [TEST_REACTION_PASS, TEST_REACTION_FAIL]) {
      try {
        await this.rest().put(Routes.channelMessageOwnReaction(this.state.channelId, messageId, encodeURIComponent(emoji)));
      } catch (error) {
        this.logger.warn('Could not seed one Sentinel verdict reaction.', { messageId, emoji, message: error.message });
      }
    }
  }

  async reactionUsers(messageId, emoji) {
    const users = await this.rest().get(
      Routes.channelMessageReaction(this.state.channelId, messageId, encodeURIComponent(emoji)),
      { query: new URLSearchParams({ limit: '100' }) }
    );
    return Array.isArray(users) ? users : [];
  }

  async readVerdict(messageId) {
    if (!messageId) return emptyVerdict();
    try {
      const [passUsers, failUsers] = await Promise.all([
        this.reactionUsers(messageId, TEST_REACTION_PASS),
        this.reactionUsers(messageId, TEST_REACTION_FAIL)
      ]);
      this.dashboard.lastVerdictSyncAt = this.now().toISOString();
      this.saveDashboardState();
      return buildVerdict(passUsers, failUsers);
    } catch (error) {
      if (this.isMissingMessageError(error)) {
        this.dashboard.messageId = '';
        this.dashboard.packageKey = '';
        this.dashboard.verdictFingerprint = '';
        this.saveDashboardState();
      } else {
        this.logger.warn('Could not read Sentinel verdict reactions.', { messageId, message: error.message });
      }
      return emptyVerdict();
    }
  }

  async replaceCandidate(messageId, payload) {
    try {
      await this.rest().delete(Routes.channelMessageAllReactions(this.state.channelId, messageId));
      await this.rest().patch(Routes.channelMessage(this.state.channelId, messageId), { body: payload });
      await this.seedVerdictReactions(messageId);
      return messageId;
    } catch (error) {
      if (!this.isMissingMessageError(error) && !this.isPermissionError(error)) throw error;
      if (!this.isMissingMessageError(error)) {
        try {
          await this.rest().delete(Routes.channelMessage(this.state.channelId, messageId));
        } catch (deleteError) {
          if (!this.isMissingMessageError(deleteError)) throw deleteError;
        }
      }
      const replacement = await this.post(payload);
      const replacementId = snowflake(replacement?.id);
      if (!replacementId) throw new Error('Discord did not return an id for the replacement Sentinel test card.');
      await this.seedVerdictReactions(replacementId);
      return replacementId;
    }
  }

  newestGroupTime(group) {
    return Math.max(0, ...(group.runs || []).map((run) => new Date(run.updated_at || run.created_at || 0).getTime()).filter(Number.isFinite));
  }

  async processTestRuns(runs = []) {
    const cutoff = this.now().getTime() - TEST_LOOKBACK_MS;
    const groups = new Map();
    for (const run of Array.isArray(runs) ? runs : []) {
      const created = new Date(run.created_at || run.run_started_at || 0).getTime();
      if (!isManualTestWorkflow(run) || !Number.isFinite(created) || created < cutoff) continue;
      const key = String(run.head_sha || run.head_branch || run.id || 'unknown');
      const group = groups.get(key) || { sha: String(run.head_sha || ''), branch: String(run.head_branch || ''), runs: [] };
      group.runs.push(run);
      groups.set(key, group);
    }

    const ordered = [...groups.values()].sort((a, b) => this.newestGroupTime(b) - this.newestGroupTime(a)).slice(0, 10);
    for (const group of ordered) {
      if (group.runs.some((run) => String(run.status || '') !== 'completed')) continue;
      const successful = group.runs.filter((run) => String(run.conclusion || '') === 'success');
      if (!successful.length) continue;
      const artifacts = [];
      for (const run of successful) {
        try { artifacts.push(...await this.fetchArtifacts(run)); }
        catch (error) { this.logger.warn('Could not inspect one successful build artifact set.', { runId: run.id, message: error.message }); }
      }
      if (!artifacts.length) continue;

      const artifactIds = [...new Set(artifacts.map((artifact) => String(artifact.id)))].sort();
      const packageKey = `${group.sha || group.branch}:${artifactIds.join(',')}`;
      const newest = successful.slice().sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))[0];
      group.runUrl = String(newest?.html_url || '');
      group.updatedAt = newest?.updated_at || newest?.created_at || this.now().toISOString();

      const sameCandidate = this.dashboard.messageId && this.dashboard.packageKey === packageKey;
      const verdict = sameCandidate ? await this.readVerdict(this.dashboard.messageId) : emptyVerdict();
      const payload = dashboardPayload(group, artifacts, verdict);

      if (!this.dashboard.messageId) {
        const message = await this.post(payload);
        this.dashboard.messageId = snowflake(message?.id);
        if (!this.dashboard.messageId) throw new Error('Discord did not return an id for the Sentinel live test card.');
        await this.seedVerdictReactions(this.dashboard.messageId);
      } else if (!sameCandidate) {
        this.dashboard.messageId = await this.replaceCandidate(this.dashboard.messageId, payload);
      } else if (this.dashboard.verdictFingerprint !== verdict.fingerprint) {
        try {
          await this.rest().patch(Routes.channelMessage(this.state.channelId, this.dashboard.messageId), { body: payload });
        } catch (error) {
          if (!this.isMissingMessageError(error)) throw error;
          const message = await this.post(payload);
          this.dashboard.messageId = snowflake(message?.id);
          await this.seedVerdictReactions(this.dashboard.messageId);
        }
      }

      this.dashboard.packageKey = packageKey;
      this.dashboard.verdictFingerprint = verdict.fingerprint;
      this.saveDashboardState();
      if (!this.state.announcedTestPackages.includes(packageKey)) {
        this.state.announcedTestPackages = [...this.state.announcedTestPackages, packageKey].slice(-100);
        this.saveState();
      }
      return { packageKey, verdict: verdict.status, messageId: this.dashboard.messageId };
    }
    return { skipped: true, reason: 'no-testable-candidate' };
  }

  getDashboardState() {
    return JSON.parse(JSON.stringify(this.dashboard));
  }
}

module.exports = {
  TEST_REACTION_PASS,
  TEST_REACTION_FAIL,
  buildVerdict,
  verdictText,
  dashboardPayload,
  SentinelBuildDashboardService
};
