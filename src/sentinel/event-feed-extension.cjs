'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { StateStore } = require('./state-store.cjs');
const { EventFeedPublisher } = require('./event-feed.cjs');

const INSTALLED = Symbol.for('khaos.nexus.event.feed.extension');

function installEventFeedExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const state = new StateStore();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusEventFeedLogin(...args) {
    this.once(Events.ClientReady, async () => {
      try {
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const publisher = new EventFeedPublisher({ client:this, guild, backend, state });
        publisher.start();
        this.__nexusEventFeedPublisher = publisher;
        console.log(`[Nexus Sentinal] persistent module feeds enabled for guild ${guild.id}`);
      } catch (error) {
        console.error('[Nexus Sentinal] event feed startup:', error);
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installEventFeedExtension };
