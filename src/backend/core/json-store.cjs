'use strict';

const fs = require('node:fs');
const path = require('node:path');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = path.resolve(filePath);
    this.defaults = clone(defaults);
    this.state = clone(defaults);
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.state = { ...clone(this.defaults), ...parsed };
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error(`[Nexus State] ${path.basename(this.filePath)}:`, error.message);
    }
    return this.state;
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  read() { return this.state; }

  update(mutator) {
    const result = mutator(this.state);
    this.save();
    return result;
  }
}

module.exports = { JsonStore, clone };
