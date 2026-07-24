'use strict';

const { REST, Routes } = require('discord.js');
const {
  CHANNEL_TYPES,
  normalizeDiscordAutomationConfig,
  normalizeRoleMenu,
  normalizeLayout,
  renderRoleMenu,
  planLayout
} = require('../../shared/discord-automation.cjs');

function discordError(error) {
  const code = Number(error?.code);
  const status = Number(error?.status);
  if (code === 50013 || status === 403) return new Error('The Discord bot is missing permission for that action. Check Manage Roles, Manage Channels, View Channel, Send Messages, Embed Links, and Read Message History.');
  if (code === 50001) return new Error('The Discord bot cannot access the selected server or channel.');
  if (code === 10003 || code === 10004 || status === 404) return new Error('The selected Discord server, channel, or message no longer exists.');
  if (code === 10008) return new Error('The published Discord message no longer exists. Publish it again.');
  if (status === 401) return new Error('Discord rejected the stored bot token. Update it in Discord Setup.');
  return error instanceof Error ? error : new Error(String(error || 'Discord request failed.'));
}

class DiscordAutomationService {
  constructor({ configStore, logger, restFactory, now } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.restFactory = restFactory || ((token) => new REST({ version: '10' }).setToken(token));
    this.now = now || (() => new Date());
  }

  bootstrap() { return this.configStore.getRuntimeBootstrap(); }
  config() { return normalizeDiscordAutomationConfig(this.configStore.getDiscordAutomation?.() || this.configStore.getConfig().discordAutomation || {}); }
  rest() {
    const token = this.bootstrap().discordToken;
    if (!token) throw new Error('Save the Discord bot token before using Discord Automation.');
    return this.restFactory(token);
  }
  guildId(override = '') {
    const value = String(override || this.bootstrap().config.discord?.guildId || '').trim();
    if (!/^\d{5,25}$/.test(value)) throw new Error('Configure the Discord server ID before using Discord Automation.');
    return value;
  }

  async resources(guildOverride = '') {
    const guildId = this.guildId(guildOverride);
    try {
      const rest = this.rest();
      const [roles, channels, me] = await Promise.all([
        rest.get(Routes.guildRoles(guildId)),
        rest.get(Routes.guildChannels(guildId)),
        rest.get(Routes.user('@me'))
      ]);
      const botMember = await rest.get(Routes.guildMember(guildId, String(me.id)));
      const roleList = Array.isArray(roles) ? roles : [];
      const botRoleIds = new Set(Array.isArray(botMember?.roles) ? botMember.roles.map(String) : []);
      const topBotPosition = roleList.filter((role) => botRoleIds.has(String(role.id))).reduce((max, role) => Math.max(max, Number(role.position) || 0), 0);
      return {
        guildId,
        roles: roleList
          .filter((role) => String(role.name) !== '@everyone')
          .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
          .map((role) => ({
            id: String(role.id), name: String(role.name || 'Unnamed role'), color: Number(role.color || 0),
            position: Number(role.position || 0), managed: Boolean(role.managed),
            manageable: !role.managed && Number(role.position || 0) < topBotPosition
          })),
        channels: (Array.isArray(channels) ? channels : [])
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.name).localeCompare(String(b.name)))
          .map((channel) => ({
            id: String(channel.id), name: String(channel.name || 'unnamed'), type: Number(channel.type),
            parentId: channel.parent_id ? String(channel.parent_id) : '', position: Number(channel.position || 0)
          })),
        bot: { id: String(me.id), username: String(me.username || 'Khaos Nexus'), topRolePosition: topBotPosition }
      };
    } catch (error) { throw discordError(error); }
  }

  validateRoleMenu(menuInput, resources) {
    const menu = normalizeRoleMenu(menuInput);
    if (!menu.options.length) throw new Error('Add at least one role button before publishing.');
    const roles = new Map((resources?.roles || []).map((role) => [role.id, role]));
    for (const option of menu.options) {
      const role = roles.get(option.roleId);
      if (!role) throw new Error(`Discord role for “${option.label}” was not found.`);
      if (!role.manageable) throw new Error(`The bot cannot manage “${role.name}”. Move the bot role above it and ensure the role is not managed by an integration.`);
    }
    return menu;
  }

  async sendMessage(channelId, payload) {
    try { return await this.rest().post(Routes.channelMessages(channelId), { body: payload }); }
    catch (error) { throw discordError(error); }
  }
  async editMessage(channelId, messageId, payload) {
    try { return await this.rest().patch(Routes.channelMessage(channelId, messageId), { body: payload }); }
    catch (error) { throw discordError(error); }
  }
  async deleteMessage(channelId, messageId) {
    try { await this.rest().delete(Routes.channelMessage(channelId, messageId)); return { deleted: true }; }
    catch (error) {
      if (Number(error?.code) === 10008 || Number(error?.status) === 404) return { deleted: false, alreadyMissing: true };
      throw discordError(error);
    }
  }

  async publishRoleMenu(menuInput) {
    const resources = await this.resources(menuInput.guildId);
    const menu = this.validateRoleMenu(menuInput, resources);
    if (!/^\d{5,25}$/.test(menu.channelId)) throw new Error('Select a Discord text channel before publishing the role menu.');
    const channel = resources.channels.find((item) => item.id === menu.channelId && [CHANNEL_TYPES.text, CHANNEL_TYPES.announcement].includes(item.type));
    if (!channel) throw new Error('The selected role-menu channel is not a bot-accessible text or announcement channel.');
    const payload = renderRoleMenu(menu);
    let message;
    let replaced = false;
    if (menu.messageId) {
      try { message = await this.editMessage(menu.channelId, menu.messageId, payload); }
      catch (error) {
        if (!/no longer exists|not found/i.test(error.message)) throw error;
      }
    }
    if (!message) { message = await this.sendMessage(menu.channelId, payload); replaced = true; }
    return { menu, messageId: String(message.id), guildId: resources.guildId, channelId: menu.channelId, publishedAt: this.now().toISOString(), replaced };
  }

  async deletePublishedMenu(menuInput) {
    const menu = normalizeRoleMenu(menuInput);
    if (menu.channelId && menu.messageId) await this.deleteMessage(menu.channelId, menu.messageId);
    return { removed: true };
  }

  async previewLayout(layoutInput) {
    const layout = normalizeLayout(layoutInput);
    const resources = await this.resources(layout.guildId);
    return { resources, plan: planLayout(layout, resources.channels) };
  }

  async applyLayout(layoutInput) {
    const layout = normalizeLayout(layoutInput);
    const resources = await this.resources(layout.guildId);
    const plan = planLayout(layout, resources.channels);
    const rest = this.rest();
    const created = [];
    const categoryIds = new Map();
    try {
      for (const operation of plan.operations.filter((item) => item.kind === 'category')) {
        if (operation.action === 'unchanged') { categoryIds.set(operation.ref, operation.existingId); continue; }
        const category = await rest.post(Routes.guildChannels(resources.guildId), { body: { name: operation.name, type: CHANNEL_TYPES.category } });
        categoryIds.set(operation.ref, String(category.id));
        created.push({ kind: 'category', id: String(category.id), name: operation.name });
      }
      for (const operation of plan.operations.filter((item) => item.kind !== 'category' && item.action === 'create')) {
        const parentId = categoryIds.get(operation.parentRef) || operation.parentRef.replace(/^planned:/, '');
        const settings = operation.settings || {};
        const body = { name: operation.name, type: CHANNEL_TYPES[operation.kind], parent_id: parentId };
        if (operation.kind !== 'voice') {
          if (settings.topic) body.topic = settings.topic;
          body.nsfw = Boolean(settings.nsfw);
        } else {
          body.bitrate = Number(settings.bitrate || 64000);
          body.user_limit = Number(settings.userLimit || 0);
        }
        const channel = await rest.post(Routes.guildChannels(resources.guildId), { body });
        created.push({ kind: operation.kind, id: String(channel.id), name: operation.name, parentId });
      }
      return { layout, plan, created, appliedAt: this.now().toISOString() };
    } catch (error) { throw discordError(error); }
  }

  async publishAuditEntry(entry, auditSettings) {
    if (!auditSettings?.publishToDiscord || !auditSettings.channelId) return { published: false };
    const color = entry.outcome === 'success' ? 0x2ecc71 : entry.outcome === 'blocked' ? 0xf1c40f : 0xe3264f;
    const payload = {
      embeds: [{
        title: `Discord Automation • ${entry.action}`,
        description: entry.summary || 'Automation activity recorded.',
        color,
        fields: [
          { name: 'Actor', value: `${entry.actorName} (${entry.actorRole})`, inline: true },
          { name: 'Target', value: entry.targetName || entry.targetType || 'Khaos Nexus', inline: true },
          { name: 'Outcome', value: entry.outcome, inline: true }
        ],
        timestamp: entry.time
      }],
      allowed_mentions: { parse: [] }
    };
    const message = await this.sendMessage(auditSettings.channelId, payload);
    return { published: true, messageId: String(message.id) };
  }
}

module.exports = { DiscordAutomationService, discordError };
