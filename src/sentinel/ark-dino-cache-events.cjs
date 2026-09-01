'use strict';

const { EventEmitter } = require('node:events');

const BUS = Symbol.for('khaos.nexus.dino-cache.events');
if (!globalThis[BUS]) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(20);
  globalThis[BUS] = emitter;
}

module.exports = { dinoCacheEvents: globalThis[BUS] };
