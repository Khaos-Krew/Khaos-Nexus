'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { ServerConnection } = require('../../bot/server-client.cjs');
const { getNexusCoreService } = require('./nexus-core-service.cjs');
const { NitradoClient, onlineLike, offlineLike } = require('./nitrado-client.cjs');
const {
  PALWORLD_DEDICATED_APP_ID,
  normalizeProfileState,
  warningText,
  finalWarningText
} = require('../../shared/palworld-update-automation.cjs');

const STEAM_UPDATE_ENDPOINT = 'https://api.steampowered.com/ISteamApps/UpToDateCheck/v1/';
const DESTRUCTIVE_STAGES = new Set(['saving', 'restarting']);
const ACTIVE_STAGES = new Set(['detected', 'countdown', 'saving', 'restarting', 'verifying']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso(now) { return new Date(now).toISOString(); }
function milliseconds(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))); }

class PalworldUpdateCoordinator extends EventEmitter {
  constructor({
    dataDirectory,
    configStore,
    autonomy,
    logger,
    fetchImpl = global.fetch,
    connectionFactory,
    nitradoFactory,
    now = () => Date.now()
  } = {}) {
    super();
    this.dataDirectory = dataDirectory;
    this.configStore = configStore;
    this.autonomy = autonomy;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.connectionFactory = connectionFactory || ((server) => new ServerConnection(server));
    this.nitradoFactory = nitradoFactory || ((runtime) => new NitradoClient({ ...runtime, fetchImpl: this.fetchImpl }));
    this.now = now;
    this.statePath = path.join(dataDirectory, 'palworld-update-state.json');
    this.runtime = this.loadState();
    this.busyProfiles = new Set();
    this.coreRegistered = false;
    this.reconcileInterruptedWork();
  }

  loadState() {
    let parsed = {};
    try { parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`); } catch {}
      }
    }
    const profiles = {};
    for (const [id, value] of Object.entries(parsed?.profiles || {})) profiles[id] = normalizeProfileState(value);
    return { schemaVersion: 1, profiles };
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.runtime, null, 2), 'utf8');
    fs.renameSync(temporary, this.statePath);
    this.emit('state', this.getState());
  }

  profileState(profileId) {
    this.runtime.profiles ||= {};
    this.runtime.profiles[profileId] = normalizeProfileState(this.runtime.profiles[profileId] || {});
    return this.runtime.profiles[profileId];
  }

  patchProfileState(profileId, patch = {}) {
    const current = this.profileState(profileId);
    this.runtime.profiles[profileId] = normalizeProfileState({ ...current, ...patch });
    this.saveState();
    return this.runtime.profiles[profileId];
  }

  reconcileInterruptedWork() {
    let changed = false;
    const recoveredAt = nowIso(this.now());
    for (const value of Object.values(this.runtime.profiles || {})) {
      if (!value?.candidate || !DESTRUCTIVE_STAGES.has(value.candidate.stage)) continue;
      value.candidate = {
        ...value.candidate,
        stage: 'uncertain',
        completedAt: recoveredAt,
        summary: 'Khaos Nexus restarted while a destructive update step was in progress. The restart will not be replayed automatically; verify the Nitrado server before retrying.'
      };
      value.lastError = value.candidate.summary;
      changed = true;
    }
    if (changed) this.saveState();
  }

  getState() {
    const config = this.configStore.getPalworldUpdatePublicConfig();
    const profileStates = {};
    for (const profile of config.profiles || []) profileStates[profile.id] = clone(this.profileState(profile.id));
    return { config, profiles: profileStates, steamAppId: PALWORLD_DEDICATED_APP_ID };
  }

  profile(profileId) {
    const profile = this.configStore.getPalworldUpdateConfig().profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('The selected Palworld update profile was not found.');
    return profile;
  }

  server(profile) {
    const runtime = this.configStore.getRuntimeBootstrap();
    const server = runtime.config.servers.find((item) => item.id === profile.serverId && item.enabled !== false);
    if (!server) throw new Error('Select an enabled Khaos Nexus Palworld server for this update profile.');
    if (String(server.game || '').toLowerCase() !== 'palworld') throw new Error('The selected Khaos Nexus server is not configured as Palworld.');
    if (!server.password) throw new Error('The Palworld server credential is missing from protected storage.');
    return server;
  }

  nitrado(profileId) {
    const runtime = this.configStore.getPalworldUpdateRuntime(profileId);
    if (!runtime?.profile) throw new Error('The selected Palworld update profile was not found.');
    if (!runtime.profile.nitradoServiceId) throw new Error('Enter the Nitrado Service ID before connecting.');
    if (!runtime.token) throw new Error('Save a Nitrado API token before connecting.');
    return this.nitradoFactory({
      serviceId: runtime.profile.nitradoServiceId,
      token: runtime.token,
      requestTimeoutSeconds: 15
    });
  }

  async steamRequiredVersion() {
    if (typeof this.fetchImpl !== 'function') throw new Error('Steam update checks are unavailable because HTTP networking is unavailable.');
    const endpoint = `${STEAM_UPDATE_ENDPOINT}?appid=${PALWORLD_DEDICATED_APP_ID}&version=0`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(endpoint, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Khaos-Nexus/Palworld-Update-Watcher' }
      });
      if (!response.ok) throw new Error(`Steam update check returned HTTP ${response.status}.`);
      const payload = await response.json();
      const body = payload?.response || {};
      if (body.success !== true) throw new Error(String(body.error || body.message || 'Steam did not return a successful update response.').slice(0, 400));
      const requiredVersion = Number(body.required_version);
      if (!Number.isFinite(requiredVersion) || requiredVersion <= 0) {
        throw new Error('Steam did not expose a current Palworld dedicated-server required_version. Automatic detection is paused until the next check.');
      }
      return String(Math.trunc(requiredVersion));
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Steam update check timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async notify(profile, title, message, level = 'info') {
    if (!profile.discordChannelId || !this.autonomy?.notify) return { skipped: true, reason: 'channel-not-configured' };
    return this.autonomy.notify(title, message, level, { channelId: profile.discordChannelId });
  }

  core() {
    const core = getNexusCoreService({ dataDirectory: this.dataDirectory, logger: this.logger });
    if (this.coreRegistered) return core;
    this.coreRegistered = true;

    core.registerAction('palworld.update.game-operation', {
      requiredCapabilities: (request) => request.input.operation === 'save'
        ? ['game.server.save']
        : request.input.operation === 'announce'
          ? ['game.server.broadcast']
          : ['scheduler.unsupported-operation'],
      execute: async (request) => {
        const runtime = this.configStore.getRuntimeBootstrap();
        const server = runtime.config.servers.find((item) => item.id === request.input.serverId);
        if (!server || String(server.game || '').toLowerCase() !== 'palworld') throw new Error('The configured Palworld server was not found.');
        if (!server.password) throw new Error('Protected Palworld server credentials are missing.');
        return this.connectionFactory(server).action(request.input.operation, request.input.payload || {});
      }
    });

    core.registerAction('palworld.update.nitrado-restart', {
      requiredCapabilities: ['hosted.power'],
      execute: async (request) => this.nitrado(request.input.profileId).restart()
    });
    return core;
  }

  async dispatchCore(request, capability) {
    const result = await this.core().commandGateway.dispatch(request, {
      role: 'locked',
      grantedCapabilities: [capability]
    });
    const duplicateSuccess = result.status === 'duplicate'
      && result.output?.originalState === 'completed'
      && result.output?.originalResultStatus === 'succeeded';
    if (result.status === 'succeeded') return { output: result.output, duplicate: false };
    if (duplicateSuccess) return { output: 'Nexus Core duplicate guard: operation already completed.', duplicate: true };
    const error = new Error(result.error?.message || `Nexus Core blocked the Palworld update operation (${result.status}).`);
    error.code = result.error?.code || 'PALWORLD_UPDATE_OPERATION_BLOCKED';
    throw error;
  }

  gameRequest(profile, version, stage, operation, payload = {}) {
    const operationId = `palworld-update:${profile.id}:${version}:${stage}:${operation}`;
    return {
      operationId,
      action: 'palworld.update.game-operation',
      requestedAt: nowIso(this.now()),
      scope: { kind: 'server', id: String(profile.serverId) },
      actor: { kind: 'system', id: 'palworld-update-coordinator' },
      source: { kind: 'scheduler', id: `palworld-update:${profile.id}` },
      correlationId: `palworld-update:${profile.id}:${version}`,
      idempotencyKey: operationId,
      requiredCapabilities: [],
      input: { serverId: profile.serverId, operation, payload }
    };
  }

  async gameOperation(profile, version, stage, operation, payload = {}) {
    const capability = operation === 'save' ? 'game.server.save' : 'game.server.broadcast';
    return this.dispatchCore(this.gameRequest(profile, version, stage, operation, payload), capability);
  }

  async restartThroughNitrado(profile, version, operationSuffix = 'restart') {
    const operationId = `palworld-update:${profile.id}:${version}:${operationSuffix}:nitrado-restart`;
    return this.dispatchCore({
      operationId,
      action: 'palworld.update.nitrado-restart',
      requestedAt: nowIso(this.now()),
      scope: { kind: 'hosted-server', id: profile.id },
      actor: { kind: 'system', id: 'palworld-update-coordinator' },
      source: { kind: 'scheduler', id: `palworld-update:${profile.id}` },
      correlationId: `palworld-update:${profile.id}:${version}`,
      idempotencyKey: operationId,
      requiredCapabilities: [],
      input: { profileId: profile.id }
    }, 'hosted.power');
  }

  nextCheck(profile) {
    return nowIso(this.now() + profile.checkIntervalMinutes * 60 * 1000);
  }

  async checkProfile(profile, { force = false } = {}) {
    const state = this.profileState(profile.id);
    if (!force && state.nextCheckAt && this.now() < milliseconds(state.nextCheckAt)) return { skipped: true, reason: 'not-due' };
    const checkedAt = nowIso(this.now());
    try {
      const requiredVersion = await this.steamRequiredVersion();
      const patch = {
        lastRequiredVersion: requiredVersion,
        lastCheckAt: checkedAt,
        nextCheckAt: this.nextCheck(profile),
        lastError: ''
      };
      const current = this.profileState(profile.id);
      const active = current.candidate && ACTIVE_STAGES.has(current.candidate.stage);
      if (!current.baselineVersion) {
        patch.baselineVersion = requiredVersion;
        this.patchProfileState(profile.id, patch);
        return { baselineEstablished: true, requiredVersion };
      }

      if (requiredVersion !== current.baselineVersion && !['saving', 'restarting', 'verifying', 'countdown'].includes(current.candidate?.stage)) {
        const detectedAt = checkedAt;
        const candidate = {
          version: requiredVersion,
          detectedAt,
          applyAfter: nowIso(this.now() + profile.stagingDelayMinutes * 60 * 1000),
          stage: 'detected',
          source: 'automatic',
          warningsSent: [],
          summary: `Steam published Palworld dedicated-server build ${requiredVersion}.`
        };
        patch.baselineVersion = requiredVersion;
        patch.candidate = candidate;
        if (current.lastNotifiedVersion !== requiredVersion) {
          try {
            await this.notify(
              profile,
              `${profile.name}: Palworld update detected`,
              `Steam now reports dedicated-server build ${requiredVersion}. ${profile.autoApply ? `Automatic maintenance is armed after the ${profile.stagingDelayMinutes}-minute Nitrado staging delay.` : 'Automatic installation is off; an Owner can start the guarded update workflow from Khaos Nexus.'}`,
              'warning'
            );
            patch.lastNotifiedVersion = requiredVersion;
          } catch (error) {
            this.logger?.warn?.('Palworld update Discord alert failed.', { profileId: profile.id, message: error.message });
          }
        }
      } else if (!active && current.candidate?.stage === 'success' && current.lastAppliedVersion === requiredVersion) {
        patch.candidate = current.candidate;
      }
      this.patchProfileState(profile.id, patch);
      return { requiredVersion, detected: Boolean(patch.candidate) };
    } catch (error) {
      this.patchProfileState(profile.id, {
        lastCheckAt: checkedAt,
        nextCheckAt: this.nextCheck(profile),
        lastError: String(error.message || error).slice(0, 700)
      });
      throw error;
    }
  }

  async startCountdown(profileId, { source = 'manual' } = {}) {
    const profile = this.profile(profileId);
    this.server(profile);
    this.nitrado(profile.id);
    let state = this.profileState(profile.id);
    if (!state.lastRequiredVersion) await this.checkProfile(profile, { force: true });
    state = this.profileState(profile.id);
    const version = state.candidate?.version || state.lastRequiredVersion || state.baselineVersion;
    if (!version) throw new Error('Check Steam for the current Palworld build before starting maintenance.');
    if (state.candidate && ['saving', 'restarting', 'verifying'].includes(state.candidate.stage)) throw new Error('A Palworld update workflow is already in a destructive or verification stage.');
    const countdownMinutes = Math.max(...profile.warningMinutes);
    const candidate = {
      version,
      detectedAt: state.candidate?.detectedAt || nowIso(this.now()),
      applyAfter: state.candidate?.applyAfter || nowIso(this.now()),
      stage: 'countdown',
      source,
      countdownStartedAt: nowIso(this.now()),
      restartAt: nowIso(this.now() + countdownMinutes * 60 * 1000),
      warningsSent: [],
      summary: `${countdownMinutes}-minute guarded update countdown started.`
    };
    this.patchProfileState(profile.id, { candidate, lastError: '' });
    await this.advanceCountdown(profile);
    return this.getState();
  }

  async advanceCountdown(profile) {
    const state = this.profileState(profile.id);
    const candidate = state.candidate;
    if (!candidate || candidate.stage !== 'countdown') return;
    const restartAt = milliseconds(candidate.restartAt);
    if (!restartAt) throw new Error('The update countdown has no restart target time.');
    const remainingMs = restartAt - this.now();
    const overdue = profile.warningMinutes.filter((minutes) => remainingMs <= minutes * 60 * 1000 && !candidate.warningsSent.includes(minutes));
    if (overdue.length) {
      const warning = Math.min(...overdue);
      const message = warningText(profile, warning, candidate.version);
      const markSent = [...new Set([...candidate.warningsSent, ...overdue])].sort((a, b) => b - a);
      try { await this.gameOperation(profile, candidate.version, `warning-${warning}m`, 'announce', { message }); }
      catch (error) { this.logger?.warn?.('Palworld in-game update warning failed.', { profileId: profile.id, warning, message: error.message }); }
      try { await this.notify(profile, `${profile.name}: update in ${warning} minute${warning === 1 ? '' : 's'}`, message, 'warning'); }
      catch (error) { this.logger?.warn?.('Palworld Discord update warning failed.', { profileId: profile.id, warning, message: error.message }); }
      this.patchProfileState(profile.id, { candidate: { ...candidate, warningsSent: markSent, summary: message } });
    }
    if (this.now() >= restartAt) await this.beginApply(profile);
  }

  async beginApply(profile) {
    if (this.busyProfiles.has(profile.id)) return;
    this.busyProfiles.add(profile.id);
    let state = this.profileState(profile.id);
    const candidate = state.candidate;
    if (!candidate || candidate.stage !== 'countdown') {
      this.busyProfiles.delete(profile.id);
      return;
    }
    try {
      const finalMessage = finalWarningText(candidate.version);
      this.patchProfileState(profile.id, { candidate: { ...candidate, stage: 'saving', summary: 'Saving the Palworld world before the Nitrado restart.' } });
      try { await this.gameOperation(profile, candidate.version, 'final-warning', 'announce', { message: finalMessage }); } catch {}
      try { await this.notify(profile, `${profile.name}: applying update`, finalMessage, 'warning'); } catch {}

      if (profile.saveBeforeRestart) {
        await this.gameOperation(profile, candidate.version, 'pre-update-save', 'save', {});
        if (profile.saveDelaySeconds > 0) await delay(profile.saveDelaySeconds * 1000);
      }

      state = this.profileState(profile.id);
      const restartRequestedAt = nowIso(this.now());
      this.patchProfileState(profile.id, {
        candidate: { ...state.candidate, stage: 'restarting', restartRequestedAt, summary: 'World save completed. Nitrado restart requested through Nexus Core.' }
      });
      await this.restartThroughNitrado(profile, candidate.version);
      state = this.profileState(profile.id);
      this.patchProfileState(profile.id, {
        candidate: {
          ...state.candidate,
          stage: 'verifying',
          restartRequestedAt,
          verifyDeadline: nowIso(this.now() + profile.verifyTimeoutMinutes * 60 * 1000),
          offlineObserved: false,
          summary: 'Nitrado accepted the restart. Waiting for the server to cycle and return online.'
        }
      });
    } catch (error) {
      state = this.profileState(profile.id);
      const summary = `Palworld update workflow stopped before a verified restart: ${String(error.message || error).slice(0, 500)}`;
      this.patchProfileState(profile.id, {
        lastError: summary,
        candidate: { ...state.candidate, stage: 'failed', completedAt: nowIso(this.now()), summary }
      });
      try { await this.notify(profile, `${profile.name}: update failed`, `${summary}\n\nThe workflow will not retry the restart automatically.`, 'error'); } catch {}
    } finally {
      this.busyProfiles.delete(profile.id);
    }
  }

  async verifyRestart(profile) {
    if (this.busyProfiles.has(profile.id)) return;
    this.busyProfiles.add(profile.id);
    let state = this.profileState(profile.id);
    const candidate = state.candidate;
    if (!candidate || candidate.stage !== 'verifying') {
      this.busyProfiles.delete(profile.id);
      return;
    }
    try {
      let nitradoStatus = null;
      let gameOnline = false;
      try { nitradoStatus = await this.nitrado(profile.id).status(); } catch (error) { this.logger?.warn?.('Nitrado restart verification failed.', { profileId: profile.id, message: error.message }); }
      try { await this.connectionFactory(this.server(profile)).action('status'); gameOnline = true; } catch {}

      const observedOffline = candidate.offlineObserved
        || !gameOnline
        || (nitradoStatus && offlineLike(nitradoStatus.status));
      const hostOnline = nitradoStatus ? onlineLike(nitradoStatus.status) : gameOnline;
      const elapsed = this.now() - milliseconds(candidate.restartRequestedAt);
      if (gameOnline && hostOnline && (observedOffline || elapsed >= 90000)) {
        const summary = observedOffline
          ? `Palworld returned online after the Nitrado restart for Steam build ${candidate.version}.`
          : `Palworld is online after the Nitrado restart window for Steam build ${candidate.version}; the brief offline transition was not observed.`;
        this.patchProfileState(profile.id, {
          lastAppliedVersion: candidate.version,
          lastNitradoVersion: nitradoStatus?.version || state.lastNitradoVersion,
          lastNitradoStatus: nitradoStatus?.status || 'online',
          lastError: '',
          candidate: { ...candidate, stage: 'success', offlineObserved: observedOffline, completedAt: nowIso(this.now()), summary }
        });
        try { await this.notify(profile, `${profile.name}: update complete`, summary, 'info'); } catch {}
        return;
      }

      if (this.now() >= milliseconds(candidate.verifyDeadline)) {
        const summary = 'The Nitrado restart was sent, but Khaos Nexus could not verify Palworld back online before the timeout. No second restart will be sent automatically.';
        this.patchProfileState(profile.id, {
          lastNitradoVersion: nitradoStatus?.version || state.lastNitradoVersion,
          lastNitradoStatus: nitradoStatus?.status || state.lastNitradoStatus,
          lastError: summary,
          candidate: { ...candidate, stage: 'failed', offlineObserved: observedOffline, completedAt: nowIso(this.now()), summary }
        });
        try { await this.notify(profile, `${profile.name}: restart verification failed`, summary, 'error'); } catch {}
        return;
      }

      this.patchProfileState(profile.id, {
        lastNitradoVersion: nitradoStatus?.version || state.lastNitradoVersion,
        lastNitradoStatus: nitradoStatus?.status || state.lastNitradoStatus,
        candidate: { ...candidate, offlineObserved: observedOffline, summary: 'Waiting for Palworld to return after the Nitrado restart.' }
      });
    } finally {
      this.busyProfiles.delete(profile.id);
    }
  }

  async cancel(profileId) {
    const profile = this.profile(profileId);
    const state = this.profileState(profile.id);
    if (!state.candidate || !['detected', 'countdown'].includes(state.candidate.stage)) throw new Error('This workflow can only be cancelled before the save/restart stage begins.');
    this.patchProfileState(profile.id, {
      candidate: { ...state.candidate, stage: 'cancelled', completedAt: nowIso(this.now()), summary: 'Update workflow cancelled before the destructive stage.' }
    });
    try { await this.notify(profile, `${profile.name}: update cancelled`, 'The pending Palworld update workflow was cancelled before the server save/restart stage.', 'warning'); } catch {}
    return this.getState();
  }

  async manualRestart(profileId) {
    const profile = this.profile(profileId);
    this.nitrado(profile.id);
    const bucket = Math.floor(this.now() / 30000);
    const version = `manual-${bucket}`;
    const result = await this.restartThroughNitrado(profile, version, 'manual');
    try { await this.notify(profile, `${profile.name}: manual Nitrado restart`, 'An Owner requested an immediate Nitrado restart from Khaos Nexus.', 'warning'); } catch {}
    return { result, state: this.getState() };
  }

  async testNitrado(profileId) {
    const profile = this.profile(profileId);
    const status = await this.nitrado(profile.id).status();
    this.patchProfileState(profile.id, { lastNitradoStatus: status.status, lastNitradoVersion: status.version, lastError: '' });
    return { status, state: this.getState() };
  }

  async checkNow(profileId) {
    const profile = this.profile(profileId);
    const result = await this.checkProfile(profile, { force: true });
    return { result, state: this.getState() };
  }

  async tick() {
    const profiles = this.configStore.getPalworldUpdateConfig().profiles.filter((profile) => profile.enabled);
    for (const profile of profiles) {
      try {
        const state = this.profileState(profile.id);
        if (state.candidate?.stage === 'countdown') await this.advanceCountdown(profile);
        else if (state.candidate?.stage === 'verifying') await this.verifyRestart(profile);
        else if (state.candidate?.stage === 'detected' && profile.autoApply && this.now() >= milliseconds(state.candidate.applyAfter)) {
          await this.startCountdown(profile.id, { source: 'automatic' });
        }

        const latest = this.profileState(profile.id);
        const destructive = ['countdown', 'saving', 'restarting', 'verifying'].includes(latest.candidate?.stage);
        if (profile.monitorUpdates && !destructive && (!latest.nextCheckAt || this.now() >= milliseconds(latest.nextCheckAt))) {
          await this.checkProfile(profile);
        }
      } catch (error) {
        this.logger?.warn?.('Palworld update automation tick failed.', { profileId: profile.id, message: error.message });
      }
    }
  }
}

module.exports = {
  PalworldUpdateCoordinator,
  STEAM_UPDATE_ENDPOINT,
  DESTRUCTIVE_STAGES,
  ACTIVE_STAGES,
  milliseconds,
  delay
};
