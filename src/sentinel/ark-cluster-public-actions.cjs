'use strict';

const { Client, Events, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkShopProfileStore } = require('./arkshop-profiles.cjs');
const {
  BUTTON_MODS,
  BUTTON_STATS,
  BUTTON_PUBLIC_SHOP,
  BUTTON_PUBLIC_KITS,
  effectiveMods
} = require('./ark-cluster-panel.cjs');
const { renderPublicShopReply, renderPublicKitsReply } = require('./arkshop-public-view.cjs');
const {
  curseForgeLookupUrl,
  loadLiveArkPublicInfo,
  refreshArkPublicMetadata
} = require('./ark-public-server-info.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.cluster.public.actions');
const BOUND = Symbol.for('khaos.nexus.ark.cluster.public.actions.bound');
const REFRESH_TIMER = Symbol.for('khaos.nexus.ark.cluster.public.actions.refresh.timer');

function clean(value, max = 120) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function chunkLines(lines = [], maxLength = 950) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildModListReply(servers = []) {
  const enabled = servers.filter((server) => server.enabled !== false);
  if (!enabled.length) return '🧩 No ARK maps are currently enabled.';
  const sections = enabled.map((server) => {
    const mods = effectiveMods(server).filter(Boolean);
    const title = `**${clean(server.mapName || server.name || server.id, 80)}**`;
    if (!mods.length) return `${title}\nNo configured, running, or installed mods detected.`;
    const lines = mods.slice(0, 40).map((mod, index) => {
      const value = clean(mod, 100);
      const id = value.match(/\b\d{5,10}\b/)?.[0];
      return id ? `${index + 1}. [${value}](${curseForgeLookupUrl(id)})` : `${index + 1}. ${value}`;
    });
    if (mods.length > 40) lines.push(`…and ${mods.length - 40} more.`);
    return `${title}\n${lines.join('\n')}`;
  });
  return `🧩 **ARK Mod List**\n\n${sections.join('\n\n')}`.slice(0, 1900);
}

function buildLiveModListPayload(snapshots = []) {
  const fields = [];
  let total = 0;
  for (const snapshot of snapshots) {
    const mods = Array.isArray(snapshot?.mods) ? snapshot.mods : [];
    total += mods.length;
    const lines = mods.map((mod, index) => {
      const id = clean(mod?.id, 16);
      const name = clean(mod?.name || `Mod ${id}`, 80).replace(/[\[\]]/g, '');
      const url = String(mod?.url || curseForgeLookupUrl(id));
      return `${index + 1}. [${name}](${url}) · \`${id}\``;
    });
    const chunks = chunkLines(lines.length ? lines : ['No configured, running, or installed mods detected.']);
    chunks.forEach((value, index) => fields.push({
      name: `${clean(snapshot?.serverName || 'ARK Server', 80)}${chunks.length > 1 ? ` • ${index + 1}/${chunks.length}` : ''}`,
      value,
      inline: false
    }));
  }
  return {
    embeds: [{
      title: '🧩 Khaos Nexus • ARK Mod List',
      description: `${total} mod${total === 1 ? '' : 's'} detected from the running log, server config, or map-local installed-mod directory. Each entry links to CurseForge.`,
      color: 0x5865f2,
      fields: fields.slice(0, 25),
      footer: { text: 'Sentinal server-side detection • API optional for friendly names only' }
    }],
    allowedMentions: { parse: [] }
  };
}

function renderObjectLines(object = {}) {
  return Object.entries(object || {}).map(([key, value]) => `**${clean(key, 40)}:** ${clean(value, 120)}`);
}

function buildServerStatsPayload(snapshots = []) {
  const embeds = [];
  for (const snapshot of snapshots.slice(0, 10)) {
    const fields = [
      { name: '⚙️ Core Rates', value: chunkLines(renderObjectLines(snapshot?.coreRates), 1000)[0] || 'Unavailable', inline: false },
      { name: '🧍 Player Level Stats', value: chunkLines(renderObjectLines(snapshot?.playerStats), 1000)[0] || 'Unavailable', inline: false },
      { name: '🦖 Tamed Dino Level Stats', value: chunkLines(renderObjectLines(snapshot?.dinoStats), 1000)[0] || 'Unavailable', inline: false },
      { name: '🥚 Breeding', value: chunkLines(renderObjectLines(snapshot?.breeding), 1000)[0] || 'Unavailable', inline: false },
      { name: '✨ Quality of Life', value: chunkLines(renderObjectLines(snapshot?.qualityOfLife), 1000)[0] || 'Unavailable', inline: false }
    ];
    embeds.push({
      title: `📊 ${clean(snapshot?.serverName || 'ARK Server', 120)} • Server Stats & Rates`,
      description: [
        snapshot?.version ? `**ARK version:** ${clean(snapshot.version, 40)}` : '',
        '**Source:** live `GameUserSettings.ini` + `Game.ini`',
        'Settings that require an ARK restart may be configured before they are active in the running session.'
      ].filter(Boolean).join('\n'),
      color: 0x2ecc71,
      fields,
      footer: { text: `Sentinal live config read • ${clean(snapshot?.checkedAt || new Date().toISOString(), 60)}` }
    });
  }
  if (!embeds.length) embeds.push({ title: '📊 ARK Server Stats & Rates', description: 'No enabled ARK servers are currently available.', color: 0xe74c3c });
  return { embeds, allowedMentions: { parse: [] } };
}

async function loadSnapshotsAndCache(registry, servers) {
  const snapshots = [];
  for (const server of servers.filter((item) => item.enabled !== false)) {
    try {
      const snapshot = await loadLiveArkPublicInfo(server);
      snapshots.push(snapshot);
      registry.upsert({ ...server, detectedMods: snapshot.modIds, installedMods: snapshot.installedModIds, detectedRates: snapshot.detectedRates });
    } catch (error) {
      snapshots.push({
        serverId: server.id,
        serverName: server.mapName || server.name || server.id,
        mods: [], coreRates: {}, playerStats: {}, dinoStats: {}, breeding: {}, qualityOfLife: {},
        errors: [clean(error?.message || error, 180)], checkedAt: new Date().toISOString()
      });
    }
  }
  return snapshots;
}

function installArkClusterPublicActions() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const registry = new ArkClusterRegistry();
  const profiles = new ArkShopProfileStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterPublicActionsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;

      client.once(Events.ClientReady, () => {
        const runRefresh = () => {
          const servers = registry.list({ includeDisabled: false });
          void refreshArkPublicMetadata(registry, servers)
            .then((snapshots) => {
              const modCount = snapshots.reduce((sum, item) => sum + (Array.isArray(item?.modIds) ? item.modIds.length : 0), 0);
              console.log(`[Nexus Sentinal] ARK public info refreshed: servers=${snapshots.length} detectedMods=${modCount}`);
            })
            .catch((error) => console.warn(`[Nexus Sentinal] ARK public info refresh failed: ${clean(error?.message || error, 240)}`));
        };
        runRefresh();
        const seconds = Math.max(300, Number(process.env.NEXUS_ARK_PUBLIC_INFO_REFRESH_SECONDS || 600) || 600);
        client[REFRESH_TIMER] = setInterval(runRefresh, seconds * 1000);
        client[REFRESH_TIMER].unref?.();
      });

      client.on(Events.InteractionCreate, (interaction) => {
        if (!interaction.isButton?.()) return;
        const id = String(interaction.customId || '');
        if (![BUTTON_MODS, BUTTON_STATS, BUTTON_PUBLIC_SHOP, BUTTON_PUBLIC_KITS].includes(id)) return;
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        const servers = registry.list({ includeDisabled: false });

        if (id === BUTTON_PUBLIC_SHOP || id === BUTTON_PUBLIC_KITS) {
          const content = id === BUTTON_PUBLIC_SHOP
            ? renderPublicShopReply(servers, profiles)
            : renderPublicKitsReply(servers, profiles);
          void interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
          return;
        }

        void (async () => {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const snapshots = await loadSnapshotsAndCache(registry, servers);
          const payload = id === BUTTON_MODS ? buildLiveModListPayload(snapshots) : buildServerStatsPayload(snapshots);
          await interaction.editReply(payload);
        })().catch(async (error) => {
          const content = `ARK server information is temporarily unavailable: ${clean(error?.message || error, 220)}`;
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], allowedMentions: { parse: [] } }).catch(() => {});
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }).catch(() => {});
        });
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  clean,
  chunkLines,
  buildModListReply,
  buildLiveModListPayload,
  buildServerStatsPayload,
  loadSnapshotsAndCache,
  installArkClusterPublicActions
};
