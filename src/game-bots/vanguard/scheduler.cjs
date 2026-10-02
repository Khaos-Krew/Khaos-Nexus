'use strict';

const { errorClass } = require('../command-failure.cjs');

class Scheduler {
  constructor() {
    this.tail = Promise.resolve();
    this.timers = new Set();
    this.stopped = false;
  }

  run(task) {
    if (this.stopped) return Promise.resolve({ skipped: true });
    const job = this.tail.then(() => task(), () => task());
    this.tail = job.then(() => undefined, () => undefined);
    return job;
  }

  every(ms, task) {
    const timer = setInterval(() => {
      void this.run(task).catch((error) => {
        console.warn(`[Nexus Vanguard] scheduler class=${errorClass(error)}`);
      });
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
    return timer;
  }

  stop() {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.clear();
  }
}

module.exports = { Scheduler };
