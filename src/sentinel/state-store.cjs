'use strict';

const fs = require('node:fs');
const path = require('node:path');

class StateStore {
  constructor(root = path.resolve(__dirname, '../..')) {
    this.dir = path.join(root, 'data');
    this.file = path.join(this.dir, 'sentinel-state.json');
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { consoles: {} }; }
  }
  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
  }
  getConsole(moduleId) { return this.read().consoles?.[moduleId] || null; }
  setConsole(moduleId, value) { const state = this.read(); state.consoles ||= {}; state.consoles[moduleId] = value; this.write(state); return value; }
}

module.exports = { StateStore };
