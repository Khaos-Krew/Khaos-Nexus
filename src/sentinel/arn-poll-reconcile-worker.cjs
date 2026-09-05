'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { reconcileArnLiveBoard } = require('./arn-live-board-extension.cjs');
const { registerStartupTask } = require('./startup-coordinator.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arnPollReconcileWorker');
const DEFAULT_POLL_MS = 30_000;
const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 5 * 60_000;

function resolvePollMs(value = process.env.ARN_POLL_RECONCILE_MS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.floor(parsed)));
}

function sanitizeError(error) {
  return String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 350);
}

function installArnPollReconcileWorker() {
  if (globalThis[INSTALLED]) return;
  globalThis[INSTALLED] = true;

  const config = loadConfig();
  const pollMs = resolvePollMs();

  registerStartupTask({
    id: 'ark.arn-poll-reconcile',
    owner: 'arn-poll-reconcile-worker',
    priority: 130,
    run(client) {
      let running = false;

      const reconcile = async (reason) => {
        if (running || !client?.isReady?.()) return;
        running = true;
        try {
          const result = await reconcileArnLiveBoard(client, config, { logger: console });
          if (result?.skipped) {
            console.warn(`[Nexus Sentinal] ARN poll reconcile skipped: reason=${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] ARN poll reconcile: reason=${reason} replayed=${result.replayed} tracked=${result.tracked} pollSeconds=${Math.round(pollMs / 1000)}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARN poll reconcile failed: reason=${reason} error=${sanitizeError(error)}`);
        } finally {
          running = false;
        }
      };

      void reconcile('startup');
      const pollTimer = setInterval(() => void reconcile('poll'), pollMs);
      pollTimer.unref?.();
      console.log(`[Nexus Sentinal] ARN listener-independent poll worker armed: pollSeconds=${Math.round(pollMs / 1000)}`);
    }
  });
}

installArnPollReconcileWorker();

module.exports = {
  DEFAULT_POLL_MS,
  MIN_POLL_MS,
  MAX_POLL_MS,
  resolvePollMs,
  installArnPollReconcileWorker
};
