'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { activeReport, validCaseId } = require('./safety-report-model.cjs');

function emptyState() {
  return { reports: {}, rulesPanel: null, infrastructure: null };
}

class SafetyReportStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..')) {
    this.dir = process.env.NEXUS_DATA_DIR ? path.resolve(root) : path.join(root, 'data');
    this.file = path.join(this.dir, 'safety-reports.json');
  }

  read() {
    let state = null;
    try { state = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    state ||= emptyState();
    state.reports ||= {};
    state.rulesPanel ??= null;
    state.infrastructure ??= null;
    return state;
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }

  list() { return { ...this.read().reports }; }

  get(caseId) {
    const id = String(caseId || '').toUpperCase();
    return validCaseId(id) ? this.read().reports[id] || null : null;
  }

  set(caseId, value = {}) {
    const id = String(caseId || '').toUpperCase();
    if (!validCaseId(id)) throw new Error('Invalid Nexus report case ID.');
    const state = this.read();
    state.reports[id] = { ...(state.reports[id] || {}), ...value, caseId: id, updatedAt: new Date().toISOString() };
    this.write(state);
    return state.reports[id];
  }

  openForReporter(reporterId) {
    const id = String(reporterId || '');
    return Object.values(this.read().reports).filter((report) => String(report.reporterId || '') === id && activeReport(report));
  }

  findByChannel(channelId) {
    const id = String(channelId || '');
    return Object.values(this.read().reports).find((report) => String(report.channelId || '') === id) || null;
  }

  getRulesPanel() { return this.read().rulesPanel || null; }
  setRulesPanel(value) {
    const state = this.read();
    state.rulesPanel = value ? { ...value, updatedAt: new Date().toISOString() } : null;
    this.write(state);
    return state.rulesPanel;
  }

  getInfrastructure() { return this.read().infrastructure || null; }
  setInfrastructure(value) {
    const state = this.read();
    state.infrastructure = value ? { ...value, updatedAt: new Date().toISOString() } : null;
    this.write(state);
    return state.infrastructure;
  }
}

module.exports = { SafetyReportStore, emptyState };
