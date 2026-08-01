'use strict';

const {
  validateSetupOperation,
  normalizeBinding,
  normalizePanel,
  assertBindingConstraints,
  campaignPanelData,
  stableHash,
  normalizeSnowflake,
  clean,
  nowIso
} = require('../../shared/dnd-discord.cjs');

const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_TYPES = Object.freeze({
  0: 'channel', 2: 'voice', 5: 'channel', 10: 'thread', 11: 'thread', 12: 'thread', 15: 'forum', 16: 'forum'
});

function discordError(status, body, fallback) {
  const message = body?.message || fallback || `Discord request failed with HTTP ${status}.`;
  const error = new Error(message);
  error.status = status;
  error.discordCode = body?.code;
  if (status === 401) error.code = 'DISCORD_TOKEN_INVALID';
  else if (status === 403) error.code = 'DISCORD_PERMISSION_MISSING';
  else if (status === 404) error.code = 'DISCORD_RESOURCE_STALE';
  else error.code = 'DISCORD_REQUEST_FAILED';
  return error;
}

class DndCampaignService {
  constructor({ configStore, logger }) {
    this.configStore = configStore;
    this.logger = logger;
  }

  state() { return this.configStore.getDndState(); }

  token(appId) {
    const token = this.configStore.getDiscordAppToken(appId);
    if (!token) throw Object.assign(new Error('The selected registered Discord app has no protected bot token.'), { code: 'DISCORD_BOT_TOKEN_MISSING' });
    return token;
  }

  async discord(appId, path, { method = 'GET', body } = {}) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token(appId)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'KhaosNexus-DnD/1.0'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) throw discordError(response.status, payload, `Discord request to ${path} failed.`);
    return payload;
  }

  async guildResources(appId, guildId) {
    const id = normalizeSnowflake(guildId, 'Guild ID');
    const [channels, active] = await Promise.all([
      this.discord(appId, `/guilds/${id}/channels`),
      this.discord(appId, `/guilds/${id}/threads/active`).catch(() => ({ threads: [] }))
    ]);
    const resources = [];
    for (const channel of Array.isArray(channels) ? channels : []) {
      const kind = CHANNEL_TYPES[channel.type];
      if (!kind) continue;
      resources.push({
        id: String(channel.id), parentId: channel.parent_id ? String(channel.parent_id) : '',
        name: String(channel.name || channel.id), discordType: Number(channel.type),
        resourceType: kind, archived: Boolean(channel.thread_metadata?.archived)
      });
    }
    for (const thread of active?.threads || []) {
      if (resources.some((item) => item.id === String(thread.id))) continue;
      const parent = resources.find((item) => item.id === String(thread.parent_id));
      resources.push({
        id: String(thread.id), parentId: String(thread.parent_id || ''), name: String(thread.name || thread.id),
        discordType: Number(thread.type), resourceType: parent?.resourceType === 'forum' ? 'forum_post' : 'thread',
        archived: Boolean(thread.thread_metadata?.archived)
      });
    }
    return resources.sort((a, b) => a.name.localeCompare(b.name));
  }

  async testResource(appId, guildId, resourceId, expectedType = '') {
    normalizeSnowflake(guildId, 'Guild ID');
    const id = normalizeSnowflake(resourceId, 'Discord resource ID');
    const channel = await this.discord(appId, `/channels/${id}`);
    const actual = CHANNEL_TYPES[channel.type] || 'unknown';
    const parent = channel.parent_id ? await this.discord(appId, `/channels/${channel.parent_id}`).catch(() => null) : null;
    const normalizedActual = actual === 'thread' && parent && CHANNEL_TYPES[parent.type] === 'forum' ? 'forum_post' : actual;
    if (expectedType && expectedType !== normalizedActual && !(expectedType === 'channel' && normalizedActual === 'voice')) {
      throw Object.assign(new Error(`The Discord resource is ${normalizedActual}, not ${expectedType}.`), { code: 'WRONG_DISCORD_RESOURCE_TYPE' });
    }
    return {
      ok: true,
      id: String(channel.id),
      guildId: String(channel.guild_id || guildId),
      name: String(channel.name || channel.id),
      resourceType: normalizedActual,
      parentChannelId: String(channel.parent_id || ''),
      note: 'The bot can view this resource. Send-message capability is verified when the persistent panel is refreshed.'
    };
  }

  async createResource(input) {
    const operation = validateSetupOperation(input);
    if (operation.creates !== 1) throw Object.assign(new Error('This setup mode does not create a Discord resource.'), { code: 'NO_RESOURCE_CREATION_REQUESTED' });
    if (!input.confirmed) throw Object.assign(new Error('Confirm the creation of exactly one Discord resource.'), { code: 'CONFIRMATION_REQUIRED' });
    const parentId = normalizeSnowflake(input.parentChannelId, 'Parent channel ID');
    const name = clean(input.name || 'dnd-campaign', 90);
    if (!name) throw Object.assign(new Error('A thread or forum post name is required.'), { code: 'INVALID_ARGUMENT' });
    const body = operation.resourceType === 'forum_post'
      ? { name, auto_archive_duration: 10080, message: { content: clean(input.initialMessage || 'Khaos Nexus campaign space created by explicit confirmation.', 1900) } }
      : { name, type: 11, auto_archive_duration: 10080, invitable: true };
    const created = await this.discord(input.appId, `/channels/${parentId}/threads`, { method: 'POST', body });
    return {
      createdCount: 1,
      resource: {
        id: String(created.id), parentChannelId: String(created.parent_id || parentId), name: String(created.name || name),
        resourceType: operation.resourceType
      }
    };
  }

  buildPanel(campaignId) {
    const data = campaignPanelData(this.state(), campaignId);
    const party = data.party.length
      ? data.party.slice(0, 8).map((item) => `${item.name}: ${item.hp}/${item.maxHp} HP · AC ${item.armorClass}${item.conditions.length ? ` · ${item.conditions.join(', ')}` : ''}`).join('\n')
      : 'No active characters.';
    const fields = [
      { name: 'DM', value: data.dm?.displayName || 'Not assigned', inline: true },
      { name: 'Players', value: String(data.playerCount), inline: true },
      { name: 'Ruleset', value: data.campaign.ruleset || 'Not set', inline: true },
      { name: 'Next session', value: data.nextSession ? `${data.nextSession.title}\n${data.nextSession.startsAt}` : 'Not scheduled', inline: false },
      { name: 'Active session', value: data.activeSession?.title || 'None', inline: true },
      { name: 'Current location', value: data.currentLocation || 'Not set', inline: true },
      { name: 'Active quest', value: data.activeQuest?.title || 'None', inline: false },
      { name: 'Party', value: party.slice(0, 1024), inline: false }
    ];
    const payload = {
      embeds: [{
        title: data.campaign.name,
        description: `Campaign status: **${data.campaign.status}**`,
        fields,
        footer: { text: 'Khaos Nexus D&D · Persistent campaign panel' }
      }],
      components: [[
        ['Characters', 'characters'], ['Attendance', 'attendance'], ['Quests', 'quests'], ['Shared loot', 'loot'], ['Roll dice', 'roll']
      ].map(([label, action]) => ({ type: 2, style: 2, label, custom_id: `dnd:${action}:${campaignId}` }))]
    };
    return { data, payload, hash: stableHash(data) };
  }

  async refreshPanel(bindingId) {
    const state = this.state();
    const binding = state.bindings.find((item) => item.id === bindingId && item.active !== false);
    if (!binding) throw Object.assign(new Error('The selected campaign binding is missing or inactive.'), { code: 'BINDING_NOT_FOUND' });
    const built = this.buildPanel(binding.campaignId);
    let panel = state.panels.find((item) => item.bindingId === bindingId) || normalizePanel({ bindingId });
    if (panel.messageId && panel.contentHash === built.hash) return { unchanged: true, panel, hash: built.hash };

    let message;
    if (panel.messageId) {
      try {
        message = await this.discord(binding.appId, `/channels/${binding.resourceId}/messages/${panel.messageId}`, { method: 'PATCH', body: built.payload });
      } catch (error) {
        if (error.code !== 'DISCORD_RESOURCE_STALE') throw error;
        panel.messageId = '';
      }
    }
    if (!panel.messageId) message = await this.discord(binding.appId, `/channels/${binding.resourceId}/messages`, { method: 'POST', body: built.payload });
    panel = normalizePanel({ ...panel, bindingId, messageId: String(message.id), contentHash: built.hash, lastRefreshedAt: nowIso(), lastError: '' });
    this.configStore.upsertDndPanel(panel);
    this.configStore.appendDndAudit({ action: 'panel.refreshed', outcome: 'success', campaignId: binding.campaignId, targetId: bindingId, appId: binding.appId, guildId: binding.guildId });
    return { unchanged: false, panel, hash: built.hash };
  }

  saveBinding(input) {
    const state = this.state();
    const binding = normalizeBinding(input);
    assertBindingConstraints(state.bindings, binding);
    return this.configStore.upsertDndBinding(binding);
  }

  async saveSetup(input) {
    const operation = validateSetupOperation(input);
    if (operation.mode === 'none') return { mode: 'none', createdCount: 0, binding: null };
    let resource = {
      id: input.resourceId,
      resourceType: input.resourceType || operation.resourceType,
      parentChannelId: input.parentChannelId || '',
      name: input.displayName || ''
    };
    let createdCount = 0;
    if (operation.creates === 1) {
      const result = await this.createResource(input);
      resource = result.resource;
      createdCount = result.createdCount;
    }
    const verified = await this.testResource(input.appId, input.guildId, resource.id, resource.resourceType);
    const binding = this.saveBinding({
      ...input,
      resourceId: resource.id,
      resourceType: resource.resourceType,
      parentChannelId: resource.parentChannelId || verified.parentChannelId,
      displayName: resource.name || verified.name,
      verifiedAt: nowIso(),
      lastError: ''
    });
    this.configStore.appendDndAudit({
      action: createdCount ? 'binding.resource_created' : 'binding.created', outcome: 'success', campaignId: binding.campaignId,
      targetId: binding.id, appId: binding.appId, guildId: binding.guildId, metadata: { mode: operation.mode, createdCount }
    });
    return { mode: operation.mode, createdCount, binding };
  }
}

module.exports = { DndCampaignService, CHANNEL_TYPES, DISCORD_API };
