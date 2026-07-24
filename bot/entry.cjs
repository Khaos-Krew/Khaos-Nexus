'use strict';

const { Client } = require('discord.js');
const { installDiscordAutomationRuntime } = require('./discord-automation-runtime.cjs');

const parent = process.parentPort;
let bootstrap = null;

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap' || message?.type === 'config-update') bootstrap = message.payload;
});

const originalLogin = Client.prototype.login;
Client.prototype.login = function patchedLogin(...args) {
  installDiscordAutomationRuntime({
    client: this,
    getBootstrap: () => bootstrap,
    send: (type, payload = {}) => parent?.postMessage({ type, payload }),
    log: (level, message, meta = {}) => parent?.postMessage({
      type: 'log', payload: { time: new Date().toISOString(), source: 'bot', level, message, meta }
    })
  });
  return originalLogin.apply(this, args);
};

require('./index.cjs');
