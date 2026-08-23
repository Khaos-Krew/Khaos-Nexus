'use strict';

const { MessageFlags } = require('discord.js');
const { MODULES, getModule } = require('../backend/modules/catalog.cjs');
const { layoutFor } = require('./module-layouts.cjs');

const ACCESS_BUTTON_PREFIX = 'nexus:module-access:';
const ROLE_MENU_MARKER = 'nexus-sentinal:module-access:v1';
const DEFAULT_ROLE_CHANNEL_NAMES = ['roles', 'role-selection', 'self-roles', 'server-roles'];
const DEFAULT_RULES_CHANNEL_NAMES = ['rules', 'server-rules', 'rules-and-info', 'rules-and-information'];

function normalizedName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function accessDefinitionFor(module) {
  if (!module?.id) return null;
  let layout;
  try { layout = layoutFor(module.id); } catch { return null; }
  if (layout.accessRole === false) return null;
  return {
    moduleId: module.id,
    label: module.name,
    roleName: String(layout.accessRoleName || `${module.name} Access`).slice(0, 100),
    section: String(layout.accessSection || 'Games').slice(0, 100)
  };
}

function enabledAccessDefinitions(config = {}) {
  return MODULES
    .filter((module) => config.modules?.[module.id]?.enabled !== false)
    .map(accessDefinitionFor)
    .filter(Boolean);
}

function parseAccessButton(customId) {
  const value = String(customId || '');
  if (!value.startsWith(ACCESS_BUTTON_PREFIX)) return null;
  const moduleId = value.slice(ACCESS_BUTTON_PREFIX.length).trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(moduleId) || !getModule(moduleId)) return null;
  return moduleId;
}

function buttonRows(definitions) {
  const buttons = definitions.map((definition) => ({
    type: 2,
    style: 2,
    label: definition.label.slice(0, 80),
    custom_id: `${ACCESS_BUTTON_PREFIX}${definition.moduleId}`
  }));
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({ type: 1, components: buttons.slice(index, index + 5) });
  }
  return rows;
}

function buildRoleMenuPayloads(definitions) {
  if (!definitions.length) return [];
  const groups = new Map();
  for (const definition of definitions) {
    if (!groups.has(definition.section)) groups.set(definition.section, []);
    groups.get(definition.section).push(definition);
  }

  const payloads = [];
  for (const [section, items] of groups.entries()) {
    for (let offset = 0; offset < items.length; offset += 25) {
      const page = items.slice(offset, offset + 25);
      payloads.push({
        content: `**${section} Access**\nUse the buttons below to add or remove your access roles. This menu is maintained automatically by Nexus Sentinal.`,
        embeds: [{
          description: page.map((item) => `• **${item.label}** → \`${item.roleName}\``).join('\n'),
          footer: { text: ROLE_MENU_MARKER }
        }],
        components: buttonRows(page),
        allowedMentions: { parse: [] }
      });
    }
  }
  return payloads;
}

function stripWebsiteLines(text, exactUrl = '') {
  const target = String(exactUrl || '').trim();
  const original = String(text || '');
  if (!original) return original;
  return original
    .split(/\r?\n/)
    .filter((line) => {
      const containsExact = target && line.includes(target);
      const labelledWebsite = /website/i.test(line) && /https?:\/\//i.test(line);
      return !containsExact && !labelledWebsite;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripWebsiteComponents(rows, exactUrl = '') {
  const target = String(exactUrl || '').trim();
  return (rows || []).map((row) => {
    const raw = typeof row?.toJSON === 'function' ? row.toJSON() : row;
    const components = (raw?.components || []).filter((component) => {
      const item = typeof component?.toJSON === 'function' ? component.toJSON() : component;
      if (Number(item?.style) !== 5) return true;
      const url = String(item?.url || '');
      const label = String(item?.label || '');
      if (target && url === target) return false;
      return !/website/i.test(label);
    });
    return { ...raw, components };
  }).filter((row) => row.components.length);
}

function websiteCleanupPayload(message, exactUrl = '') {
  const content = stripWebsiteLines(message?.content || '', exactUrl);
  const components = stripWebsiteComponents(message?.components || [], exactUrl);
  const changedContent = content !== String(message?.content || '');
  const originalComponents = (message?.components || []).map((row) => typeof row?.toJSON === 'function' ? row.toJSON() : row);
  const changedComponents = JSON.stringify(components) !== JSON.stringify(originalComponents);
  if (!changedContent && !changedComponents) return null;
  return {
    content,
    components,
    allowedMentions: { parse: [] }
  };
}

class RoleMenuManager {
  constructor({ client, state, config }) {
    this.client = client;
    this.state = state;
    this.config = config || {};
  }

  definitions() {
    return enabledAccessDefinitions(this.config);
  }

  async findTextChannel(guild, configuredId, fallbackNames) {
    if (configuredId) {
      try {
        const configured = await guild.channels.fetch(String(configuredId));
        if (configured?.isTextBased?.()) return configured;
      } catch {}
    }
    const channels = await guild.channels.fetch();
    const wanted = new Set(fallbackNames.map(normalizedName));
    return channels.find((channel) => channel?.isTextBased?.() && wanted.has(normalizedName(channel.name))) || null;
  }

  async ensureAccessRole(guild, definition) {
    const saved = this.state.getAccessRole(definition.moduleId);
    let role = null;
    if (saved?.roleId) {
      try { role = await guild.roles.fetch(String(saved.roleId)); } catch { role = null; }
    }
    if (!role) {
      const roles = await guild.roles.fetch();
      role = roles.find((item) => item.name === definition.roleName) || null;
    }
    if (!role) {
      role = await guild.roles.create({
        name: definition.roleName,
        hoist: false,
        mentionable: false,
        reason: `Nexus Sentinal module access role: ${definition.moduleId}`
      });
    }
    this.state.setAccessRole(definition.moduleId, {
      guildId: String(guild.id),
      roleId: String(role.id),
      roleName: role.name,
      updatedAt: new Date().toISOString()
    });
    return role;
  }

  async reconcile(guild) {
    const definitions = this.definitions();
    const roles = new Map();
    const warnings = [];
    for (const definition of definitions) {
      try {
        const role = await this.ensureAccessRole(guild, definition);
        roles.set(definition.moduleId, role);
        if (role.editable === false) warnings.push(`${definition.label}: Sentinal role is not high enough to manage ${role.name}`);
      } catch (error) {
        warnings.push(`${definition.label}: ${String(error?.message || error)}`);
      }
    }

    const channel = await this.findTextChannel(
      guild,
      this.config.discord?.rolesChannelId,
      DEFAULT_ROLE_CHANNEL_NAMES
    );
    if (!channel) {
      return { ok: false, skipped: true, roles: roles.size, warnings, reason: 'Roles channel not found. Set discord.rolesChannelId or use a standard roles channel name.' };
    }

    const payloads = buildRoleMenuPayloads(definitions);
    const saved = this.state.getRoleMenu();
    const savedIds = saved?.channelId === String(channel.id) ? [...(saved.messageIds || [])] : [];
    const messages = [];

    for (let index = 0; index < payloads.length; index += 1) {
      let message = null;
      const savedId = savedIds[index];
      if (savedId) {
        try {
          const candidate = await channel.messages.fetch(String(savedId));
          if (candidate.author?.id === this.client.user?.id) message = candidate;
        } catch {}
      }
      if (!message) {
        const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        message = recent?.find?.((candidate) => {
          if (candidate.author?.id !== this.client.user?.id) return false;
          return candidate.embeds?.some?.((embed) => embed.footer?.text === ROLE_MENU_MARKER);
        }) || null;
        if (message && messages.some((item) => item.id === message.id)) message = null;
      }
      if (message) await message.edit(payloads[index]);
      else message = await channel.send(payloads[index]);
      messages.push(message);
    }

    for (const staleId of savedIds.slice(payloads.length)) {
      try {
        const stale = await channel.messages.fetch(String(staleId));
        const owned = stale.author?.id === this.client.user?.id;
        const marked = stale.embeds?.some?.((embed) => embed.footer?.text === ROLE_MENU_MARKER);
        if (owned && marked) await stale.delete();
      } catch {}
    }

    this.state.setRoleMenu({
      guildId: String(guild.id),
      channelId: String(channel.id),
      messageIds: messages.map((message) => String(message.id)),
      updatedAt: new Date().toISOString()
    });

    return { ok: warnings.length === 0, skipped: false, roles: roles.size, messages: messages.length, warnings };
  }

  async removeRulesWebsiteLinks(guild) {
    const channel = await this.findTextChannel(
      guild,
      this.config.discord?.rulesChannelId,
      DEFAULT_RULES_CHANNEL_NAMES
    );
    if (!channel) return { ok: false, skipped: true, edited: 0, reason: 'Rules channel not found.' };

    const exactUrl = this.config.discord?.rulesWebsiteUrl || '';
    const recent = await channel.messages.fetch({ limit: 100 });
    let edited = 0;
    for (const message of recent.values()) {
      if (message.author?.id !== this.client.user?.id) continue;
      const payload = websiteCleanupPayload(message, exactUrl);
      if (!payload) continue;
      await message.edit(payload);
      edited += 1;
    }
    return { ok: true, skipped: false, edited };
  }

  async handleButton(interaction) {
    const moduleId = parseAccessButton(interaction.customId);
    if (!moduleId) return false;
    const definition = this.definitions().find((item) => item.moduleId === moduleId);
    if (!definition) {
      await interaction.reply({ content: 'That module is no longer enabled, so this access role is not currently self-assignable.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const member = interaction.member;
    if (!member?.roles?.add || !member?.roles?.remove) {
      await interaction.reply({ content: 'Sentinal could not resolve your server member record.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const role = await this.ensureAccessRole(interaction.guild, definition);
    if (role.editable === false) {
      await interaction.reply({ content: `Sentinal cannot manage **${role.name}** because that role is above (or equal to) the Sentinal bot role. Move the Sentinal role above it and try again.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    const hasRole = member.roles.cache?.has?.(String(role.id));
    if (hasRole) {
      await member.roles.remove(role, `Nexus Sentinal self-role removal by ${interaction.user.id}`);
      await interaction.reply({ content: `Removed **${role.name}**.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(role, `Nexus Sentinal self-role assignment by ${interaction.user.id}`);
      await interaction.reply({ content: `Added **${role.name}**.`, flags: MessageFlags.Ephemeral });
    }
    return true;
  }
}

module.exports = {
  ACCESS_BUTTON_PREFIX,
  ROLE_MENU_MARKER,
  RoleMenuManager,
  accessDefinitionFor,
  enabledAccessDefinitions,
  parseAccessButton,
  buildRoleMenuPayloads,
  stripWebsiteLines,
  stripWebsiteComponents,
  websiteCleanupPayload
};
