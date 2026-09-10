'use strict';

const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { Client, Events, GatewayIntentBits } = require('discord.js');

class DiscordShadowAdapter {
  constructor({ token, guildId, logger, client } = {}) {
    this.token = String(token || '').trim();
    this.guildId = String(guildId || '').trim();
    this.logger = logger;
    this.client = client || new Client({ intents: [GatewayIntentBits.Guilds] });
    this.connected = false;
  }

  async start() {
    if (!this.token) throw new Error('Sentinel shadow Discord token is not configured');
    if (!this.guildId) throw new Error('Sentinel shadow guild id is not configured');

    const ready = this.client.isReady?.() ? null : once(this.client, Events.ClientReady);
    await this.client.login(this.token);
    if (ready) await ready;
    this.connected = true;

    const snapshot = await this.snapshot();
    this.logger?.info?.('sentinel.discord_shadow.connected', {
      guildId: snapshot.guildId,
      guildName: snapshot.guildName,
      channels: snapshot.channelCount,
      roles: snapshot.roleCount,
      members: snapshot.memberCount,
      fingerprint: snapshot.fingerprint,
    });
    return snapshot;
  }

  async snapshot() {
    if (!this.guildId) throw new Error('Sentinel shadow guild id is not configured');
    const guild = await this.client.guilds.fetch(this.guildId);
    const [channels, roles] = await Promise.all([
      guild.channels.fetch(),
      guild.roles.fetch(),
    ]);

    const snapshot = normalizeGuildSnapshot({ guild, channels, roles });
    return Object.freeze({
      ...snapshot,
      fingerprint: snapshotFingerprint(snapshot),
      capturedAt: new Date().toISOString(),
    });
  }

  async stop() {
    this.connected = false;
    await this.client.destroy?.();
  }
}

function normalizeGuildSnapshot({ guild, channels, roles }) {
  const channelList = collectionValues(channels)
    .filter(Boolean)
    .map((channel) => ({
      id: String(channel.id),
      name: String(channel.name || ''),
      type: Number(channel.type),
      parentId: channel.parentId ? String(channel.parentId) : null,
      position: Number.isFinite(channel.rawPosition) ? channel.rawPosition : Number(channel.position || 0),
    }))
    .sort(byStableEntity);

  const roleList = collectionValues(roles)
    .filter(Boolean)
    .map((role) => ({
      id: String(role.id),
      name: String(role.name || ''),
      position: Number(role.position || 0),
      managed: Boolean(role.managed),
    }))
    .sort(byStableEntity);

  return {
    guildId: String(guild.id),
    guildName: String(guild.name || ''),
    memberCount: Number(guild.memberCount || 0),
    channelCount: channelList.length,
    roleCount: roleList.length,
    channels: channelList,
    roles: roleList,
  };
}

function snapshotFingerprint(snapshot) {
  const stable = {
    guildId: snapshot.guildId,
    guildName: snapshot.guildName,
    channels: snapshot.channels,
    roles: snapshot.roles,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function diffGuildSnapshots(previous, current) {
  if (!previous) return { changed: true, reason: 'initial-snapshot', previousFingerprint: null, currentFingerprint: current?.fingerprint || null };
  if (!current) return { changed: true, reason: 'missing-current-snapshot', previousFingerprint: previous?.fingerprint || null, currentFingerprint: null };
  return {
    changed: previous.fingerprint !== current.fingerprint,
    reason: previous.fingerprint === current.fingerprint ? 'no-drift' : 'guild-drift',
    previousFingerprint: previous.fingerprint,
    currentFingerprint: current.fingerprint,
  };
}

function collectionValues(value) {
  if (!value) return [];
  if (typeof value.values === 'function') return [...value.values()];
  if (Array.isArray(value)) return [...value];
  return Object.values(value);
}

function byStableEntity(a, b) {
  return Number(a.position || 0) - Number(b.position || 0)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || String(a.id).localeCompare(String(b.id));
}

module.exports = {
  DiscordShadowAdapter,
  normalizeGuildSnapshot,
  snapshotFingerprint,
  diffGuildSnapshots,
};
