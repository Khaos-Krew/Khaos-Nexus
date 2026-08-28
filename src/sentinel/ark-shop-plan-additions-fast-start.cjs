'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { reconcileArkShopPlanAdditions } = require('./ark-shop-plan-additions-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkShopPlanAdditions.fastStart');

function installArkShopPlanAdditionsFastStart() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkShopPlanAdditionsFastStartLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const timer = setTimeout(async () => {
        try {
          const result = await reconcileArkShopPlanAdditions(client, config, 'fast-start');
          if (result.skipped) return console.warn(`[Nexus Sentinal] ARK shop plan additions fast-start skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] ARK shop plan additions (fast-start): channel=${result.channelId} sections=${result.sections} created=${result.created} updated=${result.updated} duplicatesRemoved=${result.duplicatesRemoved}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARK shop plan additions fast-start unavailable: ${String(error?.message || error).slice(0, 300)}`);
        }
      }, 10_000);
      timer.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = { installArkShopPlanAdditionsFastStart };
