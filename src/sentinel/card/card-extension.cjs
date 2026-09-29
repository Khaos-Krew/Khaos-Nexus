'use strict';

const path = require('node:path');
const { Client, Events } = require('discord.js');
const { loadConfig } = require('../../shared/config.cjs');
const { BackendClient } = require('../backend-client.cjs');
const { NexusEconomyClient } = require('../nexus-economy-client.cjs');
const { JsonCardStore } = require('./card-store.cjs');
const { CardAuditLog } = require('./card-audit.cjs');
const { createRateLimiters } = require('./rate-limit.cjs');
const { cardDataDir, cardEnabled, cardLimitOptions, sourceTimeoutMs } = require('./card-config.cjs');
const { handleCardInteraction, registerCardCommands } = require('./card-commands.cjs');

const INSTALLED = Symbol.for('khaos.nexus.playerCard.extension');

function createCardDeps(options = {}) {
  const env = options.env || process.env;
  const config = options.config || loadConfig();
  const dir = options.dataDir || cardDataDir(env);
  const store = options.store || new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = options.audit || new CardAuditLog(path.join(dir, 'audit'));
  const limiters = options.limiters || createRateLimiters(cardLimitOptions(env));
  return {
    config,
    store,
    audit,
    limiters,
    backend: options.backend || new BackendClient(config),
    economy: options.economy || new NexusEconomyClient(),
    timeoutMs: options.timeoutMs || sourceTimeoutMs(env),
    isEnabled: options.isEnabled || (() => cardEnabled(env))
  };
}

function installPlayerCardExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function playerCardLogin(...args) {
    const client = this;
    const deps = createCardDeps();
    client.on(Events.InteractionCreate, (interaction) => {
      void handleCardInteraction(interaction, deps).catch((error) => {
        console.warn(`[Player Card] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        deps.audit.prune();
        deps.audit.scheduleDaily();
        if (!cardEnabled()) {
          console.log('[Player Card] CARD_ENABLED is off. /card was not registered.');
          return;
        }
        const config = deps.config || loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerCardCommands(guild);
        console.log(`[Player Card] registered /card and View Card in guild ${guild.id}`);
      } catch (error) {
        console.error(`[Player Card] registration failed: ${String(error?.message || error).slice(0, 300)}`);
      }
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  createCardDeps,
  installPlayerCardExtension
};
