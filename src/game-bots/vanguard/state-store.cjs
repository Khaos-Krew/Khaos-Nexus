'use strict';

const { readJson, writeJson } = require('../panel-message.cjs');

class GuildStateStore {
  constructor(file) {
    this.file = file;
    this.chain = Promise.resolve();
  }

  read() {
    const data = readJson(this.file, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  write(value) {
    writeJson(this.file, value && typeof value === 'object' ? value : {});
  }

  update(mutator) {
    const run = this.chain.then(async () => {
      const current = this.read();
      const next = await mutator(current);
      const saved = next && typeof next === 'object' ? next : current;
      this.write(saved);
      return saved;
    });
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }
}

module.exports = { GuildStateStore };
