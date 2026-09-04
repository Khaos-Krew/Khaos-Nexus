'use strict';

const { Client } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { reconcileArnLiveBoard } = require('./arn-live-board-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arnPollReconcileWorker');
const DEFAULT_POLL_MS = 30_000;
const READY_PROBE_MS = 1_000;
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
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArnPollReconcileLogin(...args) {
    const client = this;
    const config = loadConfig();
    const pollMs = resolvePollMs();
    let readyProbe = null;
    let pollTimer = null;
    let running = false;
    let started = false;

    const reconcile = async (reason) => {
      if (running || !client.isReady?.()) return;
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

    const start = () => {
      if (started || !client.isReady?.()) return;
      started = true;
      if (readyProbe) clearInterval(readyProbe);
      readyProbe = null;
      void reconcile('startup');
      pollTimer = setInterval(() => void reconcile('poll'), pollMs);
      pollTimer.unref?.();
      console.log(`[Nexus Sentinal] ARN listener-independent poll worker armed: pollSeconds=${Math.round(pollMs / 1000)}`);
    };

    readyProbe = setInterval(start, READY_PROBE_MS);
    readyProbe.unref?.();

    const loginResult = originalLogin.apply(client, args);
    Promise.resolve(loginResult).then(start).catch(() => {});
    return loginResult;
  };
}

installArnPollReconcileWorker();

module.exports = {
  DEFAULT_POLL_MS,
  READY_PROBE_MS,
  MIN_POLL_MS,
  MAX_POLL_MS,
  resolvePollMs,
  installArnPollReconcileWorker
};
