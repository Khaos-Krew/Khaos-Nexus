'use strict';

const {
  ChannelType,
  Client,
  Events,
  OverwriteType,
  PermissionFlagsBits
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const {
  normalizeName,
  overwriteSetMatches
} = require('./staff-workspace.cjs');
const { ensureStaffCategory } = require('./staff-workspace-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arnIntake.extension');
const ARN_INTAKE_CHANNEL_NAME = 'arn-ingest';
const ARN_INTAKE_TOPIC = 'Private ARN intake bus for per-map Shiny! Dinos webhooks. Read by Nexus Sentinel.';
const INITIAL_RECONCILE_DELAY_MS = 90_000;
const PERIODIC_RECONCILE_MS = 5 * 60_000;

let webhookRegistry = new Map();

function mapFromArnWebhookName(value) {
  const match = String(value || '').trim().match(/^ARN\s*-\s*(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function getArnWebhookRegistry() {
  return new Map(webhookRegistry);
}

function channelNamed(channels, name) {
  const wanted = normalizeName(name);
  return [...channels.values()].find((channel) =>
    channel?.type === ChannelType.GuildText && normalizeName(channel.name) === wanted
  ) || null;
}

function intakeOverwrites(category, botId) {
  const inherited = [...category.permissionOverwrites.cache.values()].map((entry) => ({
    id: String(entry.id),
    type: Number(entry.type),
    allow: [entry.allow.bitfield],
    deny: [entry.deny.bitfield]
  }));

  inherited.push({
    id: String(botId),
    type: OverwriteType.Member,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.ManageWebhooks
    ]
  });
  return inherited;
}

async function discoverNamedWebhooks(channel, logger = console) {
  const webhooks = await channel.fetchWebhooks();
  const next = new Map();
  const duplicateMaps = new Map();

  for (const webhook of webhooks.values()) {
    const mapName = mapFromArnWebhookName(webhook.name);
    if (!mapName) continue;
    next.set(String(webhook.id), mapName);

    const key = normalizeName(mapName);
    const ids = duplicateMaps.get(key) || [];
    ids.push(String(webhook.id));
    duplicateMaps.set(key, ids);
  }

  webhookRegistry = next;

  for (const [mapKey, ids] of duplicateMaps) {
    if (ids.length > 1) {
      logger.warn?.(`[Nexus Sentinal] ARN intake duplicate map webhook names detected: map=${mapKey} count=${ids.length}; webhook IDs remain authoritative.`);
    }
  }

  return {
    recognized: next.size,
    maps: [...new Set(next.values())].sort((a, b) => a.localeCompare(b))
  };
}

async function reconcileArnIntake(client, config = loadConfig(), options = {}) {
  const logger = options.logger || console;
  const guildId = String(config?.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
  if (!guildId) return { skipped: 'guild-not-configured' };

  const guild = await client.guilds.fetch(guildId);
  const [channelsSnapshot, rolesSnapshot] = await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch()
  ]);

  const categoryResult = await ensureStaffCategory(
    guild,
    client,
    config,
    channelsSnapshot,
    rolesSnapshot
  );
  const category = categoryResult.category;
  let channel = channelNamed(channelsSnapshot, ARN_INTAKE_CHANNEL_NAME);
  let created = false;
  let moved = false;
  let renamed = false;
  let topicUpdated = false;
  let permissionsUpdated = false;

  if (!channel) {
    channel = await guild.channels.create({
      name: ARN_INTAKE_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: ARN_INTAKE_TOPIC,
      reason: 'Nexus Sentinal managed ARN intake channel'
    });
    created = true;
  } else {
    if (String(channel.parentId || '') !== String(category.id)) {
      await channel.setParent(category.id, {
        lockPermissions: false,
        reason: 'Nexus Sentinal ARN intake organization'
      });
      moved = true;
    }
    if (String(channel.name || '') !== ARN_INTAKE_CHANNEL_NAME) {
      await channel.setName(ARN_INTAKE_CHANNEL_NAME, 'Nexus Sentinal ARN intake naming reconciliation');
      renamed = true;
    }
  }

  if (String(channel.topic || '') !== ARN_INTAKE_TOPIC) {
    await channel.setTopic(ARN_INTAKE_TOPIC, 'Nexus Sentinal ARN intake topic reconciliation');
    topicUpdated = true;
  }

  const desiredOverwrites = intakeOverwrites(category, client.user.id);
  if (!overwriteSetMatches(channel, desiredOverwrites)) {
    await channel.permissionOverwrites.set(
      desiredOverwrites,
      'Nexus Sentinal ARN intake privacy and webhook permission reconciliation'
    );
    permissionsUpdated = true;
  }

  const discovery = await discoverNamedWebhooks(channel, logger);
  return {
    reason: options.reason || 'manual',
    categoryId: String(category.id),
    channelId: String(channel.id),
    categoryCreated: Boolean(categoryResult.created),
    categoryPermissionsUpdated: Boolean(categoryResult.permissionsUpdated),
    created,
    moved,
    renamed,
    topicUpdated,
    permissionsUpdated,
    webhookCount: discovery.recognized,
    maps: discovery.maps
  };
}

function installArnIntakeExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArnIntakeLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await reconcileArnIntake(client, config, { reason });
          if (result.skipped) {
            console.warn(`[Nexus Sentinal] ARN intake skipped: ${result.skipped}`);
            return;
          }
          console.log(`[Nexus Sentinal] ARN intake (${reason}): category=${result.categoryId} channel=${result.channelId} categoryCreated=${result.categoryCreated} categoryPermissionsUpdated=${result.categoryPermissionsUpdated} created=${result.created} moved=${result.moved} renamed=${result.renamed} topicUpdated=${result.topicUpdated} permissionsUpdated=${result.permissionsUpdated} namedWebhooks=${result.webhookCount} maps=${result.maps.join(',') || 'none'}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARN intake unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)}`);
        }
      };

      const initial = setTimeout(() => void run('startup'), INITIAL_RECONCILE_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), PERIODIC_RECONCILE_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  ARN_INTAKE_CHANNEL_NAME,
  ARN_INTAKE_TOPIC,
  INITIAL_RECONCILE_DELAY_MS,
  PERIODIC_RECONCILE_MS,
  mapFromArnWebhookName,
  getArnWebhookRegistry,
  intakeOverwrites,
  discoverNamedWebhooks,
  reconcileArnIntake,
  installArnIntakeExtension
};
