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
const DISCORD_MESSAGE_LIMITS = Object.freeze({
  content: 2000,
  embeds: 10,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedTotal: 6000,
  actionRows: 5,
  rowComponents: 5,
  buttonLabel: 80,
  customId: 100,
  url: 2048
});

function payloadError(path, message, code = 'DND_DISCORD_PAYLOAD_INVALID') {
  const error = new Error(`D&D Discord payload ${path}: ${message}`);
  error.code = code;
  error.field = path;
  return error;
}

function validateOptionalText(value, path, maximum, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw payloadError(path, 'is required.');
    return 0;
  }
  if (typeof value !== 'string') throw payloadError(path, 'must be text.');
  if (required && !value.trim()) throw payloadError(path, 'must not be empty.');
  if (value.length > maximum) throw payloadError(path, `must be ${maximum} characters or fewer.`);
  return value.length;
}

function validateDiscordUrl(value, path) {
  validateOptionalText(value, path, DISCORD_MESSAGE_LIMITS.url, { required: true });
  let parsed;
  try { parsed = new URL(value); } catch { throw payloadError(path, 'must be a valid URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw payloadError(path, 'must use HTTP or HTTPS.');
}

function validateDiscordEmoji(emoji, path) {
  if (!emoji || typeof emoji !== 'object' || Array.isArray(emoji)) throw payloadError(path, 'must be an emoji object.');
  const hasId = emoji.id !== undefined && emoji.id !== null && String(emoji.id).trim();
  const hasName = emoji.name !== undefined && emoji.name !== null && String(emoji.name).trim();
  if (!hasId && !hasName) throw payloadError(path, 'must contain an emoji name or ID.');
  if (hasId && !/^\d{5,25}$/.test(String(emoji.id))) throw payloadError(`${path}.id`, 'must be a valid Discord emoji ID.');
  if (hasName) validateOptionalText(String(emoji.name), `${path}.name`, 32, { required: true });
}

function validateDiscordMessagePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw payloadError('body', 'must be an object.');
  validateOptionalText(payload.content, 'content', DISCORD_MESSAGE_LIMITS.content);

  const embeds = payload.embeds === undefined ? [] : payload.embeds;
  if (!Array.isArray(embeds)) throw payloadError('embeds', 'must be an array.');
  if (embeds.length > DISCORD_MESSAGE_LIMITS.embeds) throw payloadError('embeds', `may contain at most ${DISCORD_MESSAGE_LIMITS.embeds} embeds.`);
  let embedCharacters = 0;
  embeds.forEach((embed, embedIndex) => {
    const path = `embeds[${embedIndex}]`;
    if (!embed || typeof embed !== 'object' || Array.isArray(embed)) throw payloadError(path, 'must be an object.');
    embedCharacters += validateOptionalText(embed.title, `${path}.title`, DISCORD_MESSAGE_LIMITS.embedTitle);
    embedCharacters += validateOptionalText(embed.description, `${path}.description`, DISCORD_MESSAGE_LIMITS.embedDescription);
    if (embed.url !== undefined) validateDiscordUrl(embed.url, `${path}.url`);
    if (embed.thumbnail?.url !== undefined) validateDiscordUrl(embed.thumbnail.url, `${path}.thumbnail.url`);
    if (embed.image?.url !== undefined) validateDiscordUrl(embed.image.url, `${path}.image.url`);
    if (embed.footer !== undefined) {
      if (!embed.footer || typeof embed.footer !== 'object' || Array.isArray(embed.footer)) throw payloadError(`${path}.footer`, 'must be an object.');
      embedCharacters += validateOptionalText(embed.footer.text, `${path}.footer.text`, DISCORD_MESSAGE_LIMITS.embedFooter, { required: true });
      if (embed.footer.icon_url !== undefined) validateDiscordUrl(embed.footer.icon_url, `${path}.footer.icon_url`);
    }
    const fields = embed.fields === undefined ? [] : embed.fields;
    if (!Array.isArray(fields)) throw payloadError(`${path}.fields`, 'must be an array.');
    if (fields.length > DISCORD_MESSAGE_LIMITS.embedFields) throw payloadError(`${path}.fields`, `may contain at most ${DISCORD_MESSAGE_LIMITS.embedFields} fields.`);
    fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields[${fieldIndex}]`;
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw payloadError(fieldPath, 'must be an object.');
      embedCharacters += validateOptionalText(field.name, `${fieldPath}.name`, DISCORD_MESSAGE_LIMITS.embedFieldName, { required: true });
      embedCharacters += validateOptionalText(field.value, `${fieldPath}.value`, DISCORD_MESSAGE_LIMITS.embedFieldValue, { required: true });
      if (field.inline !== undefined && typeof field.inline !== 'boolean') throw payloadError(`${fieldPath}.inline`, 'must be true or false.');
    });
  });
  if (embedCharacters > DISCORD_MESSAGE_LIMITS.embedTotal) throw payloadError('embeds', `combined embed text must be ${DISCORD_MESSAGE_LIMITS.embedTotal} characters or fewer.`);

  const rows = payload.components === undefined ? [] : payload.components;
  if (!Array.isArray(rows)) throw payloadError('components', 'must be an array.');
  if (rows.length > DISCORD_MESSAGE_LIMITS.actionRows) throw payloadError('components', `may contain at most ${DISCORD_MESSAGE_LIMITS.actionRows} action rows.`);
  rows.forEach((row, rowIndex) => {
    const rowPath = `components[${rowIndex}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw payloadError(rowPath, 'must be an action-row object.');
    if (row.type !== 1) throw payloadError(`${rowPath}.type`, 'must be Discord action-row type 1.');
    if (!Array.isArray(row.components) || !row.components.length) throw payloadError(`${rowPath}.components`, 'must contain at least one component.');
    if (row.components.length > DISCORD_MESSAGE_LIMITS.rowComponents) throw payloadError(`${rowPath}.components`, `may contain at most ${DISCORD_MESSAGE_LIMITS.rowComponents} components.`);
    row.components.forEach((component, componentIndex) => {
      const componentPath = `${rowPath}.components[${componentIndex}]`;
      if (!component || typeof component !== 'object' || Array.isArray(component)) throw payloadError(componentPath, 'must be an object.');
      if (component.type !== 2) throw payloadError(`${componentPath}.type`, 'must be Discord button type 2.');
      if (![1, 2, 3, 4, 5].includes(component.style)) throw payloadError(`${componentPath}.style`, 'must be a valid Discord button style.');
      validateOptionalText(component.label, `${componentPath}.label`, DISCORD_MESSAGE_LIMITS.buttonLabel, { required: !component.emoji });
      if (component.emoji !== undefined) validateDiscordEmoji(component.emoji, `${componentPath}.emoji`);
      if (component.style === 5) {
        if (component.custom_id !== undefined) throw payloadError(`${componentPath}.custom_id`, 'is not allowed on a link button.');
        validateDiscordUrl(component.url, `${componentPath}.url`);
      } else {
        validateOptionalText(component.custom_id, `${componentPath}.custom_id`, DISCORD_MESSAGE_LIMITS.customId, { required: true });
        if (component.url !== undefined) throw payloadError(`${componentPath}.url`, 'is only allowed on a link button.');
      }
      if (component.disabled !== undefined && typeof component.disabled !== 'boolean') throw payloadError(`${componentPath}.disabled`, 'must be true or false.');
    });
  });

  if (!payload.content && !embeds.length && !rows.length) throw payloadError('body', 'must contain content, an embed, or components.');
  return payload;
}

function discordValidationDetail(body) {
  const visit = (node, path = '') => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node._errors) && node._errors.length) {
      const message = clean(node._errors[0]?.message || node._errors[0]?.code || 'Invalid value.', 240);
      return { path: path || 'body', message };
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === '_errors') continue;
      const result = visit(value, path ? `${path}.${key}` : key);
      if (result) return result;
    }
    return null;
  };
  return visit(body?.errors);
}

function discordError(status, body, fallback) {
  const detail = discordValidationDetail(body);
  const message = detail
    ? `Discord rejected the D&D message payload at ${detail.path}: ${detail.message}`
    : body?.message || fallback || `Discord request failed with HTTP ${status}.`;
  const error = new Error(message);
  error.status = status;
  error.discordCode = body?.code;
  if (status === 401) error.code = 'DISCORD_TOKEN_INVALID';
  else if (status === 403) error.code = 'DISCORD_PERMISSION_MISSING';
  else if (status === 404) error.code = 'DISCORD_RESOURCE_STALE';
  else if (status === 400 && body?.code === 50035) error.code = 'DND_DISCORD_PAYLOAD_REJECTED';
  else error.code = 'DISCORD_REQUEST_FAILED';
  if (detail) error.field = detail.path;
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
    const payload = validateDiscordMessagePayload({
      embeds: [{
        title: data.campaign.name,
        description: `Campaign status: **${data.campaign.status}**`,
        fields,
        footer: { text: 'Khaos Nexus D&D · Persistent campaign panel' }
      }],
      components: [{
        type: 1,
        components: [
          ['Characters', 'characters'], ['Attendance', 'attendance'], ['Quests', 'quests'], ['Shared loot', 'loot'], ['Roll dice', 'roll']
        ].map(([label, action]) => ({ type: 2, style: 2, label, custom_id: `dnd:${action}:${campaignId}` }))
      }]
    });
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

module.exports = {
  DndCampaignService,
  CHANNEL_TYPES,
  DISCORD_API,
  DISCORD_MESSAGE_LIMITS,
  validateDiscordMessagePayload,
  discordValidationDetail,
  discordError
};
