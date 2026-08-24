'use strict';

const {
  normalizeSelfRoleMenu,
  normalizedName,
  parseSelfRoleButton,
  messageButtons,
  isCurrentSelfRoleMessage,
  exactRoleForLabel
} = require('./self-role-model.cjs');

function componentEmoji(button) {
  const emoji = button?.emoji;
  if (!emoji) return '';
  const name = String(emoji?.name || '').trim().slice(0, 32);
  const id = String(emoji?.id || '').trim();
  if (id) return { id, ...(name ? { name } : {}), animated: Boolean(emoji?.animated) };
  return name;
}

function recoverCurrentSelfRoleMenu(message, roles = []) {
  if (!isCurrentSelfRoleMessage(message)) return null;

  const buttons = messageButtons(message)
    .map((button) => ({ button, parsed: parseSelfRoleButton(button?.custom_id) }))
    .filter((item) => item.parsed && !item.parsed.legacy);
  if (!buttons.length) return null;

  const menuIds = [...new Set(buttons.map((item) => item.parsed.menuId))];
  if (menuIds.length !== 1) return null;

  const menuId = menuIds[0];
  const firstEmbed = message?.embeds?.[0] || {};
  const title = String(firstEmbed?.title || 'Choose Your Roles').trim();
  const kind = /\bcolou?r(s)?\b/i.test(`${title} ${menuId}`) ? 'colors' : 'roles';
  const options = [];
  const seenRoleIds = new Set();

  for (const { button, parsed } of buttons) {
    const label = String(button?.label || '').trim();
    const role = exactRoleForLabel(roles, label);
    if (!label || !role?.id || seenRoleIds.has(String(role.id))) return null;
    seenRoleIds.add(String(role.id));
    options.push({
      id: parsed.optionId || normalizedName(label),
      label,
      roleId: String(role.id),
      emoji: componentEmoji(button),
      ...(kind === 'colors' ? { color: role.hexColor || '#808080' } : {})
    });
  }

  return normalizeSelfRoleMenu({
    id: menuId,
    name: title,
    title,
    description: String(firstEmbed?.description || 'Use the buttons below to update your roles.').slice(0, 4000),
    kind,
    mode: kind === 'colors' ? 'exclusive' : 'toggle',
    channelId: String(message?.channelId || message?.channel?.id || ''),
    messageId: String(message?.id || ''),
    options
  });
}

module.exports = {
  componentEmoji,
  recoverCurrentSelfRoleMenu
};
