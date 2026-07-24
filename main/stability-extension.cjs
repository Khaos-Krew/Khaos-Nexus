'use strict';

const electron = require('electron');
const {
  BOT_STARTUP_TIMEOUT_MS,
  isStartupStatus,
  startupTimeoutMessage
} = require('../shared/startup-guard.cjs');

let installed = false;

function patchBotSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__khaosStabilityPatched) return;

  class StableBotSupervisor extends Original {
    constructor(...args) {
      super(...args);
      this.khaosStartupTimer = null;
      this.khaosTimedOutChild = null;
      this.khaosLaunchFailureChild = null;
    }

    clearKhaosStartupTimer() {
      if (this.khaosStartupTimer) clearTimeout(this.khaosStartupTimer);
      this.khaosStartupTimer = null;
    }

    armKhaosStartupTimer(child) {
      this.clearKhaosStartupTimer();
      if (!child) return;
      this.khaosStartupTimer = setTimeout(() => {
        if (this.child !== child || !isStartupStatus(this.state?.status)) return;
        this.khaosTimedOutChild = child;
        const error = new Error(startupTimeoutMessage(BOT_STARTUP_TIMEOUT_MS));
        error.code = 'BOT_STARTUP_TIMEOUT';
        this.recordError(error);
        this.update({ status: 'error' });
        this.logger?.error?.('Discord bot startup timed out.', { timeoutMs: BOT_STARTUP_TIMEOUT_MS, pid: child.pid || null });
        try { child.kill(); } catch (killError) {
          this.logger?.error?.('Could not terminate the timed-out Discord bot process.', { message: killError.message });
          this.child = null;
          this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        }
      }, BOT_STARTUP_TIMEOUT_MS);
      this.khaosStartupTimer?.unref?.();
    }

    start() {
      if (this.child) return super.start();
      try {
        const result = super.start();
        if (this.child && isStartupStatus(this.state?.status)) this.armKhaosStartupTimer(this.child);
        return result;
      } catch (error) {
        this.clearKhaosStartupTimer();
        const failedChild = this.child;
        if (failedChild) this.khaosLaunchFailureChild = failedChild;
        this.recordError(error);
        this.update({ status: 'error', pid: failedChild?.pid || null });
        if (failedChild) {
          try { failedChild.kill(); } catch {}
        } else {
          this.khaosLaunchFailureChild = null;
          this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null });
        }
        throw error;
      }
    }

    handleMessage(message) {
      if (message?.type === 'ready' || (message?.type === 'heartbeat' && message?.payload?.ready)) {
        this.clearKhaosStartupTimer();
      }
      return super.handleMessage(message);
    }

    handleExit(code) {
      const exitingChild = this.child;
      if (exitingChild && exitingChild === this.khaosTimedOutChild) {
        this.clearKhaosStartupTimer();
        this.khaosTimedOutChild = null;
        this.child = null;
        this.stopping = false;
        this.restartPending = false;
        this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        this.logger?.error?.('Timed-out Discord bot process exited.', { code });
        return;
      }
      if (exitingChild && exitingChild === this.khaosLaunchFailureChild) {
        this.clearKhaosStartupTimer();
        this.khaosLaunchFailureChild = null;
        this.child = null;
        this.stopping = false;
        this.restartPending = false;
        this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null, status: 'error' });
        this.logger?.error?.('Discord bot launch failed and the child process exited.', { code });
        return;
      }
      this.clearKhaosStartupTimer();
      return super.handleExit(code);
    }

    async stop() {
      this.clearKhaosStartupTimer();
      this.khaosTimedOutChild = null;
      this.khaosLaunchFailureChild = null;
      return super.stop();
    }
  }

  Object.defineProperty(StableBotSupervisor, '__khaosStabilityPatched', { value: true });
  target.BotSupervisor = StableBotSupervisor;
}

function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosStabilityUiPatched) return;
  const original = prototype.loadFile;

  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="stability-fixes.css"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'stability-fixes.css';
          document.head.appendChild(link);
        }
        if (!document.querySelector('script[src="stability-fixes.js"]')) {
          const script = document.createElement('script');
          script.src = 'stability-fixes.js';
          script.defer = true;
          document.body.appendChild(script);
        }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };

  Object.defineProperty(prototype, '__khaosStabilityUiPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchBotSupervisor();
  patchBrowserLoader();
}

module.exports = { install };
