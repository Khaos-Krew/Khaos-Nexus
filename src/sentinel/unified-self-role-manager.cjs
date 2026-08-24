'use strict';

const { MessageFlags } = require('discord.js');
const { SelfRoleManager: AliasedSelfRoleManager } = require('./aliased-self-role-manager.cjs');
const { parseSelfRoleButton } = require('./self-role-model.cjs');

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function currentRoleIds(member) {
  const cache = member?.roles?.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map(String);
  return valuesOf(cache).map((role) => String(role?.id || role)).filter(Boolean);
}

function planGlobalColorMutation({ selectedRoleId, currentRoles = [], colorRoleIds = [] } = {}) {
  const selected = String(selectedRoleId || '');
  const current = new Set((Array.isArray(currentRoles) ? currentRoles : []).map(String));
  const colors = [...new Set((Array.isArray(colorRoleIds) ? colorRoleIds : []).map(String).filter(Boolean))];
  if (!selected || !colors.includes(selected)) throw new Error('That color option is no longer active.');

  const otherSelected = colors.filter((id) => id !== selected && current.has(id));
  if (current.has(selected)) {
    return {
      action: 'removed',
      addRoleId: '',
      removeRoleIds: [selected, ...otherSelected]
    };
  }
  return {
    action: otherSelected.length ? 'replaced' : 'added',
    addRoleId: selected,
    removeRoleIds: otherSelected
  };
}

class SelfRoleManager extends AliasedSelfRoleManager {
  allColorOptions() {
    const options = new Map();
    for (const menu of this.runtimeMenus.values()) {
      if (menu.kind !== 'colors') continue;
      for (const option of menu.options || []) {
        if (!option?.roleId) continue;
        options.set(String(option.roleId), option);
      }
    }
    for (const menu of this.configuredMenus()) {
      if (menu.kind !== 'colors') continue;
      for (const option of menu.options || []) {
        if (!option?.roleId || options.has(String(option.roleId))) continue;
        options.set(String(option.roleId), option);
      }
    }
    return [...options.values()];
  }

  async handleButton(interaction) {
    const parsed = parseSelfRoleButton(interaction.customId);
    if (!parsed) return false;
    const menu = this.runtimeMenus.get(parsed.menuId) || this.configuredMenus().find((item) => item.id === parsed.menuId);
    if (!menu || menu.kind !== 'colors') return super.handleButton(interaction);

    const option = menu.options.find((item) => item.id === parsed.optionId);
    if (!option) {
      await interaction.reply({ content: 'That color option is no longer active.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const member = interaction.member;
    if (!member?.roles?.add || !member?.roles?.remove) {
      await interaction.reply({ content: 'Sentinal could not resolve your server member record.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const allColorOptions = this.allColorOptions();
    const colorRoleIds = allColorOptions.map((item) => String(item.roleId));
    const mutation = planGlobalColorMutation({
      selectedRoleId: option.roleId,
      currentRoles: currentRoleIds(member),
      colorRoleIds
    });

    const allRoles = await interaction.guild.roles.fetch();
    const roleMap = new Map(valuesOf(allRoles).map((role) => [String(role.id), role]));
    const affectedIds = new Set([String(option.roleId), ...mutation.removeRoleIds.map(String)]);
    for (const id of affectedIds) {
      const role = roleMap.get(id);
      if (!role) {
        await interaction.reply({ content: `Sentinal could not find color role ${id}. The role menu will be reconciled automatically.`, flags: MessageFlags.Ephemeral });
        return true;
      }
      if (role.editable === false) {
        await interaction.reply({ content: `Sentinal cannot manage **${role.name}** because it is above (or equal to) the Sentinal bot role.`, flags: MessageFlags.Ephemeral });
        return true;
      }
    }

    const addRole = mutation.addRoleId ? roleMap.get(String(mutation.addRoleId)) : null;
    const removeRoles = mutation.removeRoleIds.map((id) => roleMap.get(String(id))).filter(Boolean);
    let added = false;
    try {
      if (addRole) {
        await member.roles.add(addRole, `Nexus Sentinal global name-color ${menu.id}/${option.id} by ${interaction.user.id}`);
        added = true;
      }
      for (const role of removeRoles) {
        await member.roles.remove(role, `Nexus Sentinal global name-color ${menu.id}/${option.id} by ${interaction.user.id}`);
      }
    } catch (error) {
      if (added && addRole) {
        try { await member.roles.remove(addRole, 'Nexus Sentinal name-color rollback after failed replacement'); } catch {}
      }
      throw error;
    }

    let content;
    if (mutation.action === 'removed') content = `Removed **${option.label}**.`;
    else if (mutation.action === 'replaced') content = `Changed your name color to **${option.label}**.`;
    else content = `Added **${option.label}**.`;

    if (addRole) {
      const override = this.displayColorOverride(member, addRole);
      if (override) content += `\n⚠️ **${override.name}** is a higher colored staff/integration role, so Discord may display that role's color instead.`;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return true;
  }
}

module.exports = {
  valuesOf,
  currentRoleIds,
  planGlobalColorMutation,
  SelfRoleManager
};
