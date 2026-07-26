'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  MAX_RENDERER_ACTION_ERRORS,
  normalizeRendererActionError,
  normalizeRendererActionErrorState,
  rendererActionErrorSummary
} = require('../../shared/renderer-action-errors.cjs');

class RendererActionErrorService extends EventEmitter {
  constructor({ dataDirectory, configStore, logger, now = () => Date.now() } = {}) {
    super();
    this.configStore = configStore;
    this.logger = logger;
    this.now = now;
    this.statePath = path.join(dataDirectory, 'renderer-action-errors.json');
    this.state = this.loadState();
  }

  loadState() {
    try {
      return normalizeRendererActionErrorState(JSON.parse(fs.readFileSync(this.statePath, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`); } catch {}
      }
      return normalizeRendererActionErrorState({});
    }
  }

  saveState() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporary, this.statePath);
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  record(input = {}) {
    const secrets = this.configStore?.getSecretValues?.() || [];
    const entry = normalizeRendererActionError({ ...input, time: input.time || new Date(this.now()).toISOString() }, secrets);
    const existingIndex = this.state.entries.findIndex((item) => item.id === entry.id && item.channel === entry.channel && item.view === entry.view);
    const previous = existingIndex >= 0 ? this.state.entries[existingIndex] : null;
    const previousSeenAt = previous ? new Date(previous.lastSeenAt).getTime() : 0;
    const duplicateWithinMinute = Boolean(previous && this.now() - previousSeenAt < 60 * 1000);

    if (previous) {
      this.state.entries.splice(existingIndex, 1);
      entry.occurrences = Math.min(9999, Number(previous.occurrences || 1) + 1);
      entry.time = previous.time;
      entry.lastSeenAt = new Date(this.now()).toISOString();
    }

    this.state.entries.unshift(entry);
    this.state.entries = this.state.entries.slice(0, MAX_RENDERER_ACTION_ERRORS);
    this.state.totalCaptured = Number(this.state.totalCaptured || 0) + 1;
    this.saveState();

    this.logger?.write?.('error', `UI action error [${entry.id}]: ${rendererActionErrorSummary(entry)}`, {
      channel: entry.channel,
      view: entry.view,
      operation: entry.operation,
      elementId: entry.elementId,
      occurrences: entry.occurrences,
      stack: entry.stack
    }, 'renderer-action');

    const publicState = this.getState();
    this.emit('state', publicState);
    return { entry: JSON.parse(JSON.stringify(entry)), duplicateWithinMinute, state: publicState };
  }

  clear() {
    this.state = normalizeRendererActionErrorState({ entries: [], totalCaptured: this.state.totalCaptured, lastClearedAt: new Date(this.now()).toISOString() });
    this.saveState();
    const publicState = this.getState();
    this.emit('state', publicState);
    return publicState;
  }

  latestText() {
    const entry = this.state.entries[0];
    if (!entry) throw new Error('No UI action error has been captured yet.');
    return [
      `Khaos Nexus UI action error ${entry.id}`,
      `Time: ${entry.lastSeenAt}`,
      `View: ${entry.view}`,
      `Action: ${entry.operation}`,
      `IPC channel: ${entry.channel}`,
      `Element: ${entry.elementTag || 'unknown'}#${entry.elementId || 'none'} ${entry.elementText || ''}`.trim(),
      `Occurrences: ${entry.occurrences}`,
      `Error: ${entry.message}`,
      '',
      entry.stack || 'No renderer stack was supplied.'
    ].join('\n');
  }
}

module.exports = { RendererActionErrorService };
