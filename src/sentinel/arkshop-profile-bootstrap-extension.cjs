'use strict';

const { Client } = require('discord.js');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { readConfig } = require('./ark-config-manager.cjs');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const { parseArkShopText } = require('./arkshop-profile-service.cjs');
const { registerStartupTask } = require('./startup-coordinator.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkshop.profile.bootstrap.extension');
const START_DELAY_MS = 8_000;

async function bootstrapMissingArkShopProfiles({
  registry = new ArkClusterRegistry(),
  profiles = new ArkShopProfileStore(),
  readConfigFn = readConfig,
  parseFn = parseArkShopText
} = {}) {
  const results = [];
  for (const server of registry.list({ includeDisabled: false })) {
    const profileId = String(server.shopProfile || '').trim();
    if (!profileId) {
      results.push({ serverId: server.id, skipped: 'no-profile-id' });
      continue;
    }
    if (profiles.get(profileId)) {
      results.push({ serverId: server.id, profileId, skipped: 'exists' });
      continue;
    }
    try {
      const live = await readConfigFn(server.envPrefix, 'arkshop');
      const config = parseFn(live.text);
      const profile = profiles.importLive({
        id: profileId,
        name: `${server.mapName || server.name || server.id} Live Shop`,
        description: `Read-only bootstrap from ${server.mapName || server.name || server.id}. Protected Mysql and Discord webhook fields are excluded.`,
        config
      });
      results.push({ serverId: server.id, profileId: profile.id, created: true });
    } catch (error) {
      results.push({ serverId: server.id, profileId, error: String(error?.message || error).slice(0, 240) });
    }
  }
  return results;
}

function installArkShopProfileBootstrapExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const registry = new ArkClusterRegistry();
  const profiles = new ArkShopProfileStore();
  registerStartupTask({
    id: 'ark.arkshop-profile-bootstrap',
    owner: 'arkshop-profile-bootstrap-extension',
    priority: 110,
    run() {
      const timer = setTimeout(() => {
        void bootstrapMissingArkShopProfiles({ registry, profiles }).then((results) => {
          const created = results.filter((item) => item.created).length;
          const errors = results.filter((item) => item.error).length;
          const existing = results.filter((item) => item.skipped === 'exists').length;
          console.log(`[Nexus Sentinal] ArkShop profile bootstrap: created=${created} existing=${existing} errors=${errors}`);
          for (const item of results.filter((entry) => entry.error)) {
            console.warn(`[Nexus Sentinal] ArkShop profile bootstrap ${item.serverId}: ${item.error}`);
          }
        }).catch((error) => console.warn(`[Nexus Sentinal] ArkShop profile bootstrap unavailable: ${String(error?.message || error).slice(0, 240)}`));
      }, START_DELAY_MS);
      timer.unref?.();
    }
  });
}

module.exports = { START_DELAY_MS, bootstrapMissingArkShopProfiles, installArkShopProfileBootstrapExtension };
