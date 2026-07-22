'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { utilityProcess, app } = require('electron');
const { errorFingerprint } = require('../../shared/redaction.cjs');

class BotSupervisor extends EventEmitter {
  constructor({ configStore, logger }) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.child = null;
    this.stopping = false;
    this.restartTimer = null;
    this.restartPending = false;
    this.watchdogTimer = setInterval(() => this.checkHeartbeat(), 5000);
    this.watchdogTimer.unref();
    this.state = {
      status: 'stopped',
      pid: null,
      startedAt: null,
      ready: null,
      heartbeat: null,
      lastHeartbeatAt: null,
      restartHistory: [],
      crashCount: 0,
      lastError: null,
      autoRestartBlocked: false
    };
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.getState());
  }

  botPath() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'bot', 'index.cjs')
      : path.join(__dirname, '..', '..', 'bot', 'index.cjs');
  }

  start() {
    if (this.child) return this.getState();
    clearTimeout(this.restartTimer);
    this.stopping = false;
    this.update({ status: 'starting', autoRestartBlocked: false, lastError: null });

    const bootstrap = this.configStore.getRuntimeBootstrap();
    if (!bootstrap.discordToken) {
      const error = new Error('Add the Discord bot token in Bot Setup before starting.');
      this.recordError(error);
      this.update({ status: 'error' });
      throw error;
    }

    const child = utilityProcess.fork(this.botPath(), [], {
      serviceName: 'Khaos Nexus Discord Bot',
      stdio: 'pipe'
    });
    this.child = child;
    this.update({ pid: child.pid, startedAt: new Date().toISOString(), ready: null, heartbeat: null });

    child.stdout?.on('data', (chunk) => this.logger.write('info', chunk.toString().trim(), {}, 'bot-stdout'));
    child.stderr?.on('data', (chunk) => this.logger.write('error', chunk.toString().trim(), {}, 'bot-stderr'));

    child.on('message', (event) => this.handleMessage(event?.data ?? event));
    child.on('exit', (code) => this.handleExit(code));

    child.postMessage({ type: 'bootstrap', payload: bootstrap });
    this.logger.info('Bot runtime process started.', { pid: child.pid });
    return this.getState();
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'log') {
      this.logger.ingest(message.payload);
      return;
    }
    if (message.type === 'ready') {
      this.update({ status: 'online', ready: message.payload, lastHeartbeatAt: new Date().toISOString() });
      return;
    }
    if (message.type === 'heartbeat') {
      this.update({ status: message.payload.ready ? 'online' : 'connecting', heartbeat: message.payload, lastHeartbeatAt: new Date().toISOString() });
      return;
    }
    if (message.type === 'error' || message.type === 'fatal') {
      this.recordError(message.payload);
      if (message.type === 'fatal') this.update({ status: 'error' });
      return;
    }
    if (message.type === 'restart-requested') {
      this.logger.warn('Bot restart requested from Discord.', message.payload);
      this.restart();
    }
  }

  recordError(errorLike) {
    const error = errorLike instanceof Error ? errorLike : new Error(errorLike?.message || String(errorLike));
    const id = errorLike?.id || errorFingerprint(errorLike?.stack || error.stack || error.message);
    const lastError = {
      id,
      time: new Date().toISOString(),
      message: error.message,
      stack: errorLike?.stack || error.stack
    };
    this.update({ lastError });
    this.logger.error(`Runtime error [${id}]: ${error.message}`, { stack: lastError.stack });
  }

  handleExit(code) {
    const wasStopping = this.stopping;
    const shouldRestartAfterStop = this.restartPending;
    this.child = null;
    this.update({ pid: null, ready: null, heartbeat: null, lastHeartbeatAt: null });

    if (wasStopping || code === 0) {
      this.update({ status: 'stopped' });
      this.logger.info('Bot runtime stopped.', { code });
      this.stopping = false;
      if (shouldRestartAfterStop) {
        this.restartPending = false;
        this.update({ status: 'restarting' });
        this.restartTimer = setTimeout(() => {
          try { this.start(); } catch (error) { this.recordError(error); }
        }, 500);
      }
      return;
    }

    const now = Date.now();
    const config = this.configStore.getConfig();
    const windowMs = config.monitor.restartWindowMinutes * 60 * 1000;
    const restartHistory = [...this.state.restartHistory, now].filter((time) => now - time <= windowMs);
    const crashCount = this.state.crashCount + 1;
    this.update({ status: 'crashed', restartHistory, crashCount });
    this.logger.error('Bot runtime exited unexpectedly.', { code, crashCount });

    if (!config.general.autoRestart) return;
    if (restartHistory.length >= config.monitor.maxRestarts) {
      this.update({ autoRestartBlocked: true, status: 'error' });
      this.logger.fatal('Automatic restart stopped because the crash limit was reached.', { restartHistory });
      return;
    }

    const delay = Math.min(30000, 1000 * (2 ** Math.max(0, restartHistory.length - 1)));
    this.update({ status: 'restarting' });
    this.restartTimer = setTimeout(() => {
      try { this.start(); } catch (error) { this.recordError(error); }
    }, delay);
  }

  async stop() {
    clearTimeout(this.restartTimer);
    if (!this.child) {
      this.update({ status: 'stopped' });
      return this.getState();
    }
    this.stopping = true;
    const child = this.child;
    this.update({ status: 'stopping' });
    child.postMessage({ type: 'shutdown' });
    setTimeout(() => {
      if (this.child === child) child.kill();
    }, 5000).unref();
    return this.getState();
  }

  async restart() {
    if (!this.child) return this.start();
    this.restartPending = true;
    await this.stop();
    return this.getState();
  }

  checkHeartbeat() {
    if (!this.child || this.state.status !== 'online' || !this.state.lastHeartbeatAt) return;
    const ageMs = Date.now() - new Date(this.state.lastHeartbeatAt).getTime();
    if (ageMs <= 35000) return;
    const error = new Error(`Bot heartbeat was lost for ${Math.round(ageMs / 1000)} seconds.`);
    this.recordError(error);
    this.update({ status: 'error' });
    this.logger.error('Health Monitor is terminating an unresponsive bot runtime.', { ageMs });
    this.child.kill();
  }
}

module.exports = { BotSupervisor };
