'use strict';

const { Client, Events } = require('discord.js');
require('./dnd-runtime-completion-patch.cjs').install();
const { installModuleRuntime } = require('./module-runtime.cjs');
const { installDiscordAutomationRuntime } = require('./discord-automation-runtime.cjs');
const { installCommunityAboutRuntime } = require('./community-about-runtime.cjs');
const { installStatusPanelRuntime } = require('./status-panel-runtime.cjs');
const {
  isDndInteraction,
  handleDndInteraction,
  installEncounterPanelRuntime
} = require('./dnd-encounter-panel-policy.cjs');

const parent = process.parentPort;
let bootstrap = null;
let dndRuntime = null;
let encounterPanelController = null;
let communityAboutController = null;

parent?.on('message', (event) => {
  const message = event?.data ?? event;
  if (message?.type === 'bootstrap' || message?.type === 'config-update') {
    bootstrap = message.payload;
    encounterPanelController?.onConfigUpdate();
    communityAboutController?.onConfigUpdate();
  }
});

installModuleRuntime({ ClientClass: Client, getBootstrap: () => bootstrap });

const originalEmit = Client.prototype.emit;
Client.prototype.emit = function dndAwareEmit(eventName, ...args) {
  const interaction = eventName === Events.InteractionCreate ? args[0] : null;
  if (interaction && dndRuntime && isDndInteraction(interaction)) {
    Promise.resolve(handleDndInteraction(interaction, dndRuntime)).catch((error) => {
      dndRuntime.log('error', `Unhandled D&D interaction failure: ${error.stack || error.message}`);
    });
    return true;
  }
  return originalEmit.call(this, eventName, ...args);
};

const originalLogin = Client.prototype.login;
Client.prototype.login = function patchedLogin(...args) {
  const runtime = {
    client: this,
    getBootstrap: () => bootstrap,
    send: (type, payload = {}) => parent?.postMessage({ type, payload }),
    log: (level, message, meta = {}) => parent?.postMessage({
      type: 'log', payload: { time: new Date().toISOString(), source: 'bot', level, message, meta }
    })
  };
  dndRuntime = runtime;
  encounterPanelController = installEncounterPanelRuntime(runtime);
  installDiscordAutomationRuntime(runtime);
  communityAboutController = installCommunityAboutRuntime(runtime);
  installStatusPanelRuntime(runtime);
  return originalLogin.apply(this, args);
};

require('./index.cjs');
