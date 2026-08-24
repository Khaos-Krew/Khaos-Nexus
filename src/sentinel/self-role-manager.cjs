'use strict';

const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
  SELF_ROLE_MARKER_PREFIX,
  LEGACY_SELF_ROLE_BUTTON_PREFIX,
  configuredSelfRoleMenus,
  parseSelfRoleButton,
  selfRoleMutation,
  renderSelfRoleMenu,
  messageButtons,
  isCurrentSelfRoleMessage,
  isLegacySelfRoleMessage,
  discoverLegacySelfRoleMenu,
  normalizeSelfRoleMenu,
  normalizedName,
  planColorRolePositions
} = require('./self-role-model.cjs');

const DEFAULT_ROLE_CHANNEL_NAMES = ['roles', 'role-selection', 'self-roles', 'server-roles', 'roles-and-notifications'];
const STAFF_PERMISSION_FLAGS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ModerateMembers
].filter(Boolean);

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function roleHasStaffPower(role) {
  return STAFF_PERMISSION_FLAGS.some((flag) => role?.permissions?.has?.(flag));
}

function roleIdsFromRankMap(rankRoles = {}) {
  return Object.values(rankRoles || {}).map(String).filter((id) => /^\d{5,25}$/.test(id));
}

function mergeMenus(discovered = [], configured = []) {
  const merged = new Map();
  for (const menu of discovered) merged.set(menu.id, normalizeSelfRoleMenu(menu));
  for (const menu of configured) {
    const previous = merged.get(menu.id);
    merged.set(menu.id, normalizeSelfRoleMenu({
      ...(previous || {}),
      ...menu,
      channelId: menu.channelId || previous?.channelId || '',
      messageId: menu.messageId || previous?.messageId || '',
      options: menu.options?.length ? menu.options : previous?.options || []
    }));
  }
  return [...merged.values()].filter((menu) => menu.enabled && menu.options.length);
}

function currentRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  return valuesOf(cache).map((role) => String(role?.id || role)).filter(Boolean);
}

function legacyComponentsRemoved(rows = []) {
  const cleaned = [];
  for (const rowSource of rows) {
    const row = typeof rowSource?.toJSON === 'function' ? rowSource.toJSON() : rowSource;
    const components = (row?.components || []).map((item) => typeof item?.toJSON === 'function' ? item.toJSON() : item)
      .filter((item) => !String(item?.custom_id || '').startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX));
    if (components.length) cleaned.push({ ...row, components });
  }
  return cleaned;
}

class SelfRoleManager {
  constructor({ client, state, config }) {
    this.client = client;
    this.state = state;
    this.config = config || {};
    this.runtimeMenus = new Map();
  }

  configuredMenus() {
    return configuredSelfRoleMenus(this.config);
  }

  async findTextChannel(guild, configuredId = '') {
    if (configuredId) {
      try {
        const configured = await guild.channels.fetch(String(configuredId));
        if (configured?.isTextBased?.()) return configured;
      } catch {}
    }
    const channels = await guild.channels.fetch();
    const wanted = new Set(DEFAULT_ROLE_CHANNEL_NAMES.map(normalizedName));
    return valuesOf(channels).find((channel) => channel?.isTextBased?.() && wanted.has(normalizedName(channel.name))) || null;
  }

  async discoverLegacyMenus(guild) {
    const warnings = [];
    const channel = await this.findTextChannel(guild, this.config.discord?.rolesChannelId || '');
    if (!channel) return { menus: [], warnings: ['Legacy self-role discovery skipped: roles channel not found.'] };
    const roles = valuesOf(await guild.roles.fetch());
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recent) return { menus: [], warnings: ['Legacy self-role discovery skipped: could not read recent role-channel messages.'] };

    const menus = [];
    for (const message of valuesOf(recent)) {
      if (isCurrentSelfRoleMessage(message)) continue;
      const hasLegacyButton = messageButtons(message).some((button) => String(button?.custom_id || '').startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX));
      if (!hasLegacyButton) continue;
      const menu = discoverLegacySelfRoleMenu(message, roles);
      if (menu) menus.push(menu);
      else warnings.push(`Could not safely map legacy role menu message ${message.id} to existing Discord roles; it was left untouched.`);
    }
    return { menus, warnings };
  }

  async effectiveMenus(guild) {
    const discovery = await this.discoverLegacyMenus(guild);
    return {
      menus: mergeMenus(discovery.menus, this.configuredMenus()),
      warnings: discovery.warnings
    };
  }

  async resolveMenuRoles(guild, menu) {
    const allRoles = await guild.roles.fetch();
    const roles = new Map();
    const warnings = [];
    for (const option of menu.options) {
      let role = null;
      try {
        role = typeof allRoles.get === 'function' ? allRoles.get(String(option.roleId)) : null;
        role ||= await guild.roles.fetch(String(option.roleId));
      } catch { role = null; }
      if (!role) {
        warnings.push(`${menu.name} / ${option.label}: Discord role ${option.roleId} no longer exists.`);
        continue;
      }
      roles.set(option.roleId, role);
      if (role.editable === false) warnings.push(`${menu.name} / ${option.label}: Sentinal cannot manage ${role.name}.`);
    }
    return { roles, warnings };
  }

  async findOwnedMenuMessage(channel, menu, saved) {
    const candidateIds = [...new Set([saved?.messageId, menu.messageId].map(String).filter(Boolean))];
    for (const id of candidateIds) {
      try {
        const candidate = await channel.messages.fetch(id);
        if (candidate?.author?.id === this.client.user?.id) return candidate;
      } catch {}
    }

    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!recent) return null;
    const marker = `${SELF_ROLE_MARKER_PREFIX}${menu.id}:v1`;
    return valuesOf(recent).find((message) =>
      message.author?.id === this.client.user?.id
      && message.embeds?.some?.((embed) => String(embed?.footer?.text || '') === marker)
    ) || null;
  }

  async prioritizeColorRoles(guild, menus, resolvedRoles, warnings) {
    if (this.config.discord?.prioritizeColorRoles === false) return { changed: 0, skipped: true };

    const colorIds = new Set();
    for (const menu of menus) {
      if (menu.kind !== 'colors') continue;
      for (const option of menu.options) colorIds.add(String(option.roleId));
    }
    if (!colorIds.size) return { changed: 0, skipped: true };

    const allRolesCollection = await guild.roles.fetch();
    const allRoles = valuesOf(allRolesCollection);
    const colorRoles = allRoles.filter((role) => colorIds.has(String(role.id)) && role.editable !== false);
    if (!colorRoles.length) return { changed: 0, skipped: true };

    let botMember = guild.members?.me || null;
    if (!botMember && this.client.user?.id && guild.members?.fetch) {
      try { botMember = await guild.members.fetch(String(this.client.user.id)); } catch {}
    }
    const botPosition = Number(botMember?.roles?.highest?.position || 0);
    if (botPosition <= 1) {
      warnings.push('Color-role priority skipped because Sentinal could not determine a safe bot-role ceiling.');
      return { changed: 0, skipped: true };
    }

    const operatorIds = new Set((this.config.discord?.operatorRoleIds || []).map(String));
    const staffRoles = allRoles.filter((role) =>
      !colorIds.has(String(role.id))
      && Number(role.position || 0) > 0
      && Number(role.position || 0) < botPosition
      && (operatorIds.has(String(role.id)) || roleHasStaffPower(role))
    );
    const rankIds = new Set([
      ...roleIdsFromRankMap(this.config.discord?.rankRoles),
      ...roleIdsFromRankMap(this.state?.getAdminSettings?.()?.rankRoles)
    ]);
    const accessIds = new Set(Object.values(this.state?.listAccessRoles?.() || {}).map((item) => String(item?.roleId || '')).filter(Boolean));
    const selfRoleIds = new Set(menus.flatMap((menu) => menu.options.map((option) => String(option.roleId))));
    const ordinaryManaged = allRoles.filter((role) =>
      !colorIds.has(String(role.id))
      && (rankIds.has(String(role.id)) || accessIds.has(String(role.id)) || selfRoleIds.has(String(role.id)))
    );
    const plan = planColorRolePositions({
      colorRoles,
      ordinaryRoles: ordinaryManaged,
      staffRoles,
      botPosition
    });
    if (plan.skipped) {
      if (plan.reason === 'ordinary-role-overlap') warnings.push('Color-role priority has no safe hierarchy space above the current self-role/rank roles and below moderation roles.');
      else if (plan.reason === 'insufficient-safe-space') warnings.push('Color-role priority could not be fully applied without placing color roles above a moderation role.');
      else warnings.push(`Color-role priority skipped: ${plan.reason}.`);
      return { changed: 0, skipped: true };
    }

    const positions = plan.positions;
    const ordered = [...colorRoles];
    const changed = positions.filter((item) => {
      const role = ordered.find((candidate) => String(candidate.id) === item.role);
      return Number(role?.position || 0) !== item.position;
    });
    if (!changed.length) return { changed: 0, skipped: false };

    try {
      if (typeof guild.roles.setPositions === 'function') {
        await guild.roles.setPositions(positions, 'Nexus Sentinal name-color roles take priority over self-access and supporter roles');
      } else {
        for (const item of positions) {
          const role = ordered.find((candidate) => String(candidate.id) === item.role);
          await role?.setPosition?.(item.position, 'Nexus Sentinal name-color role priority');
        }
      }
      return { changed: changed.length, skipped: false };
    } catch (error) {
      warnings.push(`Color-role priority could not be applied: ${String(error?.message || error)}`);
      return { changed: 0, skipped: true };
    }
  }

  async retireLegacyMenus(channels, activeMessageIds, legacyMessageIds, warnings) {
    let reactionsCleared = 0;
    let buttonsRetired = 0;
    for (const channel of channels.values()) {
      const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!recent) continue;
      for (const message of valuesOf(recent)) {
        if (activeMessageIds.has(String(message.id))) continue;
        if (!isLegacySelfRoleMessage(message, legacyMessageIds)) continue;
        try {
          if (message.reactions?.removeAll) {
            await message.reactions.removeAll();
            reactionsCleared += 1;
          }
          if (message.author?.id === this.client.user?.id) {
            const cleaned = legacyComponentsRemoved(message.components || []);
            const before = JSON.stringify((message.components || []).map((row) => typeof row?.toJSON === 'function' ? row.toJSON() : row));
            if (JSON.stringify(cleaned) !== before) {
              await message.edit({ components: cleaned, allowedMentions: { parse: [] } });
              buttonsRetired += 1;
            }
          }
        } catch (error) {
          warnings.push(`Legacy role menu ${message.id} could not be fully retired: ${String(error?.message || error)}`);
        }
      }
    }
    return { reactionsCleared, buttonsRetired };
  }

  async reconcile(guild) {
    const effective = await this.effectiveMenus(guild);
    const warnings = [...effective.warnings];
    const menus = effective.menus;
    this.runtimeMenus = new Map(menus.map((menu) => [menu.id, menu]));

    if (!menus.length) {
      return { ok: true, skipped: true, menus: 0, messages: 0, roles: 0, colorPriorityChanges: 0, reactionsCleared: 0, buttonsRetired: 0, warnings, reason: 'No Khaos Nexus self-role menus were configured or safely rediscovered.' };
    }

    const channels = new Map();
    const activeMessageIds = new Set();
    const resolvedRoles = new Map();
    let messages = 0;
    let rolesCount = 0;

    for (const menu of menus) {
      const channel = await this.findTextChannel(guild, menu.channelId || this.config.discord?.rolesChannelId || '');
      if (!channel) {
        warnings.push(`${menu.name}: role-menu channel was not found.`);
        continue;
      }
      channels.set(String(channel.id), channel);

      const resolved = await this.resolveMenuRoles(guild, menu);
      warnings.push(...resolved.warnings);
      for (const [id, role] of resolved.roles) resolvedRoles.set(id, role);
      const usableOptions = menu.options.filter((option) => resolved.roles.has(option.roleId) && resolved.roles.get(option.roleId)?.editable !== false);
      rolesCount += usableOptions.length;
      if (!usableOptions.length) {
        warnings.push(`${menu.name}: no manageable role options remain, so the replacement menu was not published.`);
        continue;
      }

      const renderMenu = normalizeSelfRoleMenu({ ...menu, channelId: String(channel.id), options: usableOptions });
      const saved = this.state?.getSelfRoleMenu?.(menu.id) || null;
      let message = await this.findOwnedMenuMessage(channel, renderMenu, saved);
      if (message?.reactions?.removeAll) {
        try { await message.reactions.removeAll(); } catch {}
      }
      const payload = renderSelfRoleMenu(renderMenu);
      if (message) await message.edit(payload);
      else message = await channel.send(payload);

      activeMessageIds.add(String(message.id));
      messages += 1;
      this.state?.setSelfRoleMenu?.(menu.id, {
        guildId: String(guild.id),
        channelId: String(channel.id),
        messageId: String(message.id),
        sourceMessageId: menu.messageId || '',
        updatedAt: new Date().toISOString()
      });
    }

    const priority = await this.prioritizeColorRoles(guild, menus, resolvedRoles, warnings);
    const legacyMessageIds = menus.map((menu) => menu.messageId).filter(Boolean);
    const retired = await this.retireLegacyMenus(channels, activeMessageIds, legacyMessageIds, warnings);

    return {
      ok: warnings.length === 0,
      skipped: false,
      menus: menus.length,
      messages,
      roles: rolesCount,
      colorPriorityChanges: priority.changed,
      reactionsCleared: retired.reactionsCleared,
      buttonsRetired: retired.buttonsRetired,
      warnings
    };
  }

  roleFor(menu, roleId) {
    return menu.options.find((option) => String(option.roleId) === String(roleId)) || null;
  }

  displayColorOverride(member, selectedRole) {
    const selectedPosition = Number(selectedRole?.position || 0);
    return valuesOf(member?.roles?.cache).find((role) =>
      String(role?.id || '') !== String(selectedRole?.id || '')
      && Number(role?.color || 0) !== 0
      && Number(role?.position || 0) > selectedPosition
    ) || null;
  }

  async handleButton(interaction) {
    const parsed = parseSelfRoleButton(interaction.customId);
    if (!parsed) return false;
    const menu = this.runtimeMenus.get(parsed.menuId) || this.configuredMenus().find((item) => item.id === parsed.menuId);
    if (!menu) {
      await interaction.reply({ content: 'That Khaos Nexus role menu is no longer active. Sentinal will refresh the replacement menu automatically.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const option = menu.options.find((item) => item.id === parsed.optionId);
    if (!option) {
      await interaction.reply({ content: 'That role option is no longer active.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const member = interaction.member;
    if (!member?.roles?.add || !member?.roles?.remove) {
      await interaction.reply({ content: 'Sentinal could not resolve your server member record.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const resolved = await this.resolveMenuRoles(interaction.guild, menu);
    const requiredIds = new Set([String(option.roleId)]);
    if (menu.mode === 'exclusive') for (const sibling of menu.options) requiredIds.add(String(sibling.roleId));
    for (const id of requiredIds) {
      const role = resolved.roles.get(id);
      if (role?.editable === false) {
        await interaction.reply({ content: `Sentinal cannot manage **${role.name}** because it is above (or equal to) the Sentinal bot role.`, flags: MessageFlags.Ephemeral });
        return true;
      }
    }

    const mutation = selfRoleMutation(menu, option.id, currentRoleIds(member));
    const addRole = mutation.addRoleId ? resolved.roles.get(String(mutation.addRoleId)) : null;
    const removeRoles = mutation.removeRoleIds.map((id) => resolved.roles.get(String(id))).filter(Boolean);

    let added = false;
    try {
      if (addRole) {
        await member.roles.add(addRole, `Nexus Sentinal self-role ${menu.id}/${option.id} by ${interaction.user.id}`);
        added = true;
      }
      for (const role of removeRoles) {
        await member.roles.remove(role, `Nexus Sentinal self-role ${menu.id}/${option.id} by ${interaction.user.id}`);
      }
    } catch (error) {
      if (added && addRole) {
        try { await member.roles.remove(addRole, 'Nexus Sentinal self-role rollback after failed replacement'); } catch {}
      }
      throw error;
    }

    let content;
    if (mutation.action === 'removed') content = `Removed **${option.label}**.`;
    else if (mutation.action === 'replaced') content = `Changed your ${menu.kind === 'colors' ? 'name color' : 'role'} to **${option.label}**.`;
    else content = `Added **${option.label}**.`;

    if (menu.kind === 'colors' && addRole) {
      const override = this.displayColorOverride(member, addRole);
      if (override) content += `\n⚠️ **${override.name}** is a higher colored staff/integration role, so Discord may display that role's color instead.`;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return true;
  }
}

module.exports = {
  DEFAULT_ROLE_CHANNEL_NAMES,
  STAFF_PERMISSION_FLAGS,
  valuesOf,
  roleHasStaffPower,
  roleIdsFromRankMap,
  mergeMenus,
  currentRoleIds,
  legacyComponentsRemoved,
  SelfRoleManager
};
