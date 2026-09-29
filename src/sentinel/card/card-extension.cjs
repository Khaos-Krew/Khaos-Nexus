'use strict';

const path = require('node:path');
const { Client, Events } = require('discord.js');
const { loadConfig } = require('../../shared/config.cjs');
const { BackendClient } = require('../backend-client.cjs');
const { NexusEconomyClient } = require('../nexus-economy-client.cjs');
const { JsonCardStore } = require('./card-store.cjs');
const { CardAuditLog } = require('./card-audit.cjs');
const { createLookupLimits, createRateLimiters } = require('./rate-limit.cjs');
const { cardDataDir, cardEnabled, cardFindEnabled, cardLimitOptions, sourceTimeoutMs } = require('./card-config.cjs');
const { TagIndex } = require('./tag-index.cjs');
const { handleCardInteraction, registerCardCommands } = require('./card-commands.cjs');

const INSTALLED = Symbol.for('khaos.nexus.playerCard.extension');

function disabledCardDeps(reason) {
  return {
    config: {},
    store: null,
    audit: null,
    limiters: null,
    backend: null,
    economy: null,
    timeoutMs: 1500,
    disabledReason: reason,
    isEnabled: () => false
  };
}

function createCardDeps(options = {}) {
  const env = options.env || process.env;
  const config = options.config || loadConfig();
  const dir = options.dataDir || cardDataDir(env);
  const store = options.store || new JsonCardStore(path.join(dir, 'cards.json'));
  const audit = options.audit || new CardAuditLog(path.join(dir, 'audit'));
  const limiters = options.limiters || createRateLimiters(cardLimitOptions(env));
  const findEnabled = options.findEnabled ?? (cardEnabled(env) && cardFindEnabled(env));
  let index = options.index || null;
  if (findEnabled) {
    if (!index) {
      index = new TagIndex();
      try { index.rebuild(store); } catch (error) {
        index.ready = false;
        console.error(`[Player Card] tag index failed: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
    store.onUserChanged?.((userId, record) => index.updateUser(userId, record));
  }
  return {
    config,
    store,
    audit,
    limiters,
    lookupLimits: options.lookupLimits || createLookupLimits(),
    index: findEnabled ? index : null,
    findEnabled: findEnabled === true,
    env,
    backend: options.backend || new BackendClient(config),
    economy: options.economy || new NexusEconomyClient(),
    timeoutMs: options.timeoutMs || sourceTimeoutMs(env),
    isEnabled: options.isEnabled || (() => cardEnabled(env))
  };
}

function openCardDeps(env = process.env) {
  if (!cardEnabled(env)) return disabledCardDeps('flag');
  try {
    return createCardDeps({ env });
  } catch (error) {
    console.warn(`[Player Card] setup failed; card feature disabled: ${String(error?.message || error).slice(0, 240)}`);
    return disabledCardDeps('setup');
  }
}

function installPlayerCardExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function playerCardLogin(...args) {
    const client = this;
    const deps = openCardDeps(process.env);
    client[Symbol.for('khaos.nexus.playerCard.deps')] = deps;
    client.on(Events.InteractionCreate, (interaction) => {
      // bot.cjs answers autocomplete first and routes /card there. Skipping it
      // here keeps that response from being sent twice.
      if (interaction.isAutocomplete?.() && interaction.commandName === 'card') return;
      return handleCardInteraction(interaction, deps).catch((error) => {
        console.warn(`[Player Card] interaction failed: ${String(error?.message || error).slice(0, 240)}`);
      });
    });
    client.once(Events.ClientReady, async () => {
      try {
        if (!deps.isEnabled() || !deps.audit) {
          const why = deps.disabledReason === 'setup' ? 'setup failed' : 'CARD_ENABLED is off';
          console.log(`[Player Card] ${why}. /card was not registered.`);
          return;
        }
        deps.audit.prune();
        deps.audit.scheduleDaily();
        const config = deps.config || loadConfig();
        const guildId = String(config.discord?.guildId || '').trim();
        if (!guildId) throw new Error('Nexus Discord guild ID is not configured.');
        const guild = await client.guilds.fetch(guildId);
        await registerCardCommands(guild, { findEnabled: deps.findEnabled === true });
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
  openCardDeps,
  installPlayerCardExtension
};
