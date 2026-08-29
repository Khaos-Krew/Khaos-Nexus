'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { findStaffCategory, normalizeName } = require('./staff-workspace.cjs');
const { SECTIONS: SHOP_SECTIONS } = require('./ark-shop-plan-extension.cjs');
const { ADDITIONS: SHOP_ADDITIONS } = require('./ark-shop-plan-additions-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkClusterPlan.extension');
const CHANNEL_NAME = 'ark-cluster-plan';
const LEGACY_CHANNEL_NAME = 'ark-shop-plan';
const INITIAL_DELAY_MS = 15_000;
const PERIODIC_MS = 60 * 60_000;
const PLAN_VERSION = 'v1';

const CORE_SECTIONS = Object.freeze([
  {
    title: 'KHAOS NEXUS • ARK CLUSTER PLAN',
    marker: `Nexus Sentinal • ARK Cluster Plan • Master • ${PLAN_VERSION}`,
    legacyMarkers: [],
    description: [
      '**Status: Canonical master planning workspace**',
      '',
      'This channel replaces the former ARK Shop Plan as the source of truth for the entire Khaos Nexus ARK cluster. The shop/economy remains a major subsection, but all ARK features, decisions, integrations, configuration work, and future changes belong here.',
      '',
      '## 📚 Master Scope',
      '• **Cluster & Servers** — maps, server registry, hosting/provider connectivity, RCON/SFTP/API access, status, restarts, saves, and expansion.',
      '• **Configuration** — Game.ini, GameUserSettings.ini, dynamic config profiles, map overrides, validation, rollout, rollback, and Sentinel ownership.',
      '• **Mods & Plugins** — ASA mods, ArkAPI plugins, compatibility, update monitoring, metadata, and deployment requirements.',
      '• **Shop & Economy** — ArkShop, MX-E/ArkShopUI, Nexus Points, banking, trading, kits, caches, resource markets, safeguards, and pricing.',
      '• **Sentinel Automation** — cluster control, scheduled operations, mod monitoring, Discord integration, audit logs, alerts, and managed configuration.',
      '• **Discord & Communications** — ARK channels, Crosschat, event feeds, staff controls, and player-facing status/information.',
      '• **Events & Progression** — Nexus Anomalies/Shiny events, seasonal events, achievements, titles, bounties, Codex tracking, and future cluster activities.',
      '• **UI & Information** — WBUI2, shop UI, public server information, dynamic content, and Nexus visual identity.',
      '• **Backlog & Decisions** — approved ideas, deferred work, technical blockers, compatibility decisions, and future map/content additions.',
      '',
      '**Rule:** update the Sentinel-owned source plan instead of manually replacing canonical messages. Shop-specific details below remain authoritative unless superseded by a newer cluster-plan entry.'
    ].join('\n')
  },
  {
    title: '✨ NEXUS ANOMALY SYSTEM & CROSSCHAT',
    marker: `Nexus Sentinal • ARK Cluster Plan • Nexus Anomalies • ${PLAN_VERSION}`,
    legacyMarkers: [],
    description: [
      '**Approved direction**',
      '',
      '## 🧬 Shiny! Dinos / Nexus Anomalies',
      'Shiny! Dinos is the gameplay engine for the Nexus Anomaly system rather than a simple cosmetic-creature feature.',
      '• Sentinel-triggered/scheduled anomaly hunts through supported RCON controls.',
      '• Enraged Shinies used as roaming world-boss style encounters.',
      '• Nexus Point bounties awarded through ArkShop after verified event completion.',
      '• Cluster-wide Codex/discovery tracking, achievements, titles, leaderboards, first discoveries, seasonal events, breeder/genetic events, and rarity-driven hunts.',
      '• Exact-location information may be reduced for special hunts so players search rather than GPS-race.',
      '• Essence remains part of the player progression/economy loop instead of turning the shop into a direct rare-Shiny vending machine.',
      '• **No museum / Hall of Anomalies feature.**',
      '• **Dino Ball compatibility is confirmed; no additional compatibility test phase is required.**',
      '',
      '## 💬 Dedicated Communications',
      'Use **#nexus-anomalies** as the dedicated ARK anomaly/event chat and Crosschat destination.',
      '• ARK map-to-map chat remains cluster-wide through Crosschat.',
      '• Sentinel should bridge eligible player chat between Discord and the Crosschat backend when the live schema supports safe two-way writes.',
      '• Prevent relay loops and distinguish ARK_PLAYER, DISCORD_PLAYER, SENTINEL_SYSTEM, and ANOMALY_EVENT sources.',
      '• Sentinel anomaly alerts, bounty completions, Codex discoveries, seasonal events, and player discussion share the same channel while system events remain visually distinct.'
    ].join('\n')
  },
  {
    title: '⚙️ CLUSTER CONFIGURATION & SENTINEL OWNERSHIP',
    marker: `Nexus Sentinal • ARK Cluster Plan • Configuration • ${PLAN_VERSION}`,
    legacyMarkers: [],
    description: [
      '**Sentinel is the cluster control plane.**',
      '',
      '• Maintain dynamic Game.ini / GameUserSettings.ini configuration with cluster defaults plus map-specific overrides.',
      '• Validate changes before publish, preserve backups/diffs, and use health checks/rollback for managed changes.',
      '• Manage WBUI2 externally hosted JSON and refresh applicable maps over RCON after publication.',
      '• Manage ArkShop / ArkShopUI configuration and economy data without modifying the MX-E UI package itself.',
      '• Track active ASA mods by configured numeric IDs, resolve CurseForge metadata, cache names/versions, detect compatible updates, and post deduplicated mod-update notices.',
      '• Maintain scheduled ARK operations such as the approved 6:00 AM restart flow with warning/countdown behavior.',
      '• Keep hosted-server connectivity provider-neutral through REST/RCON/SFTP/API capabilities rather than binding the Nexus architecture to one host.'
    ].join('\n')
  }
]);

function normalizeShopSection(section, group) {
  const oldMarker = String(section.marker || '');
  let title = String(section.title || 'ARK SHOP');
  if (title === 'KHAOS NEXUS • ARK CLUSTER SHOP PLAN') title = '💰 ARK SHOP & ECONOMY — CORE PLAN';
  return {
    title,
    marker: oldMarker.replace('ARK Shop Plan', `ARK Cluster Plan • ${group}`),
    legacyMarkers: [oldMarker],
    description: String(section.description || '')
  };
}

const PLAN_SECTIONS = Object.freeze([
  ...CORE_SECTIONS,
  ...SHOP_SECTIONS.map((section) => normalizeShopSection(section, 'Shop')),
  ...SHOP_ADDITIONS.map((section) => normalizeShopSection(section, 'Shop Additions'))
]);

function payload(section) {
  return {
    embeds: [{
      title: section.title,
      description: section.description,
      footer: { text: section.marker }
    }],
    allowedMentions: { parse: [] }
  };
}

function messageHasAnyMarker(message, markers, botId) {
  if (!message || String(message.author?.id || '') !== String(botId || '')) return false;
  const expected = new Set(markers.filter(Boolean).map(String));
  return (message.embeds || []).some((embed) => expected.has(String(embed?.footer?.text || '')));
}

async function ensureChannel(guild) {
  const channels = await guild.channels.fetch();
  const category = findStaffCategory(channels);
  if (!category) return { skipped: 'staff-category-not-found' };

  let channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText
    && normalizeName(item.name) === normalizeName(CHANNEL_NAME)) || null;

  const legacy = [...channels.values()].find((item) => item?.type === ChannelType.GuildText
    && normalizeName(item.name) === normalizeName(LEGACY_CHANNEL_NAME)) || null;

  let renamed = false;
  let created = false;

  if (!channel && legacy) {
    await legacy.setName(CHANNEL_NAME, 'Nexus Sentinal promotes ARK Shop Plan to ARK Cluster Plan');
    channel = legacy;
    renamed = true;
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Sentinel-managed Khaos Nexus ARK master cluster plan: servers, configs, mods/plugins, economy, Sentinel automation, Crosschat, Nexus Anomalies, WBUI2/UI, operations, and future features.',
      reason: 'Nexus Sentinal ARK cluster master-plan workspace'
    });
    created = true;
  }

  if (String(channel.parentId || '') !== String(category.id)) {
    await channel.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal ARK cluster-plan organization' });
  }

  if (typeof channel.setTopic === 'function') {
    const desiredTopic = 'Sentinel-managed Khaos Nexus ARK master cluster plan: servers, configs, mods/plugins, economy, Sentinel automation, Crosschat, Nexus Anomalies, WBUI2/UI, operations, and future features.';
    if (String(channel.topic || '') !== desiredTopic) {
      await channel.setTopic(desiredTopic, 'Nexus Sentinal ARK cluster-plan scope update').catch(() => {});
    }
  }

  if (typeof channel.lockPermissions === 'function') {
    await channel.lockPermissions('Nexus Sentinal ARK cluster-plan staff privacy').catch(() => {});
  }

  return { channel, created, renamed };
}

async function reconcileArkClusterPlan(client, config, reason = 'manual') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };

  const guild = await client.guilds.fetch(guildId);
  const channelResult = await ensureChannel(guild);
  if (channelResult.skipped) return channelResult;
  const channel = channelResult.channel;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);

  let created = 0;
  let updated = 0;
  let duplicatesRemoved = 0;
  let pinned = false;

  for (const [index, section] of PLAN_SECTIONS.entries()) {
    const markers = [section.marker, ...(section.legacyMarkers || [])];
    const found = recent?.values
      ? [...recent.values()].filter((message) => messageHasAnyMarker(message, markers, client.user.id))
      : [];
    found.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));

    let message = found[0] || null;
    const desired = payload(section);
    if (!message) {
      message = await channel.send(desired);
      created += 1;
    } else {
      const current = message.embeds?.[0];
      const sameTitle = String(current?.title || '') === section.title;
      const sameDescription = String(current?.description || '') === section.description;
      const sameMarker = String(current?.footer?.text || '') === section.marker;
      if (!sameTitle || !sameDescription || !sameMarker) {
        await message.edit(desired);
        updated += 1;
      }
    }

    if (index === 0 && !message.pinned && typeof message.pin === 'function') {
      try { await message.pin('Nexus Sentinal canonical ARK cluster plan'); pinned = true; } catch {}
    }

    for (const duplicate of found.slice(1)) {
      await duplicate.delete('Nexus Sentinal duplicate ARK cluster-plan section').catch(() => {});
      duplicatesRemoved += 1;
    }
  }

  return {
    reason,
    channelId: String(channel.id),
    channelCreated: channelResult.created,
    channelRenamed: channelResult.renamed,
    sections: PLAN_SECTIONS.length,
    created,
    updated,
    duplicatesRemoved,
    pinned
  };
}

function installArkClusterPlanExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkClusterPlanLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await reconcileArkClusterPlan(client, config, reason);
          if (result.skipped) return console.warn(`[Nexus Sentinal] ARK cluster plan skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] ARK cluster plan (${reason}): channel=${result.channelId} created=${result.channelCreated} renamed=${result.channelRenamed} sections=${result.sections} messagesCreated=${result.created} messagesUpdated=${result.updated} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARK cluster plan unavailable: ${String(error?.message || error).slice(0, 300)}`);
        }
      };

      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => run('periodic'), PERIODIC_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  CHANNEL_NAME,
  LEGACY_CHANNEL_NAME,
  PLAN_VERSION,
  PLAN_SECTIONS,
  reconcileArkClusterPlan,
  installArkClusterPlanExtension
};
