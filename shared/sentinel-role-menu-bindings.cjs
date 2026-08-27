'use strict';

function clean(value) {
  return String(value || '').trim();
}

function messageCustomIds(message = {}) {
  const result = [];
  for (const row of Array.isArray(message.components) ? message.components : []) {
    for (const component of Array.isArray(row?.components) ? row.components : []) {
      const id = clean(component?.customId || component?.custom_id);
      if (id) result.push(id);
    }
  }
  return result;
}

function isManagedRoleMenuMessage(message, menuId) {
  const prefix = `kn-role:${clean(menuId)}:`;
  return Boolean(clean(menuId)) && messageCustomIds(message).some((id) => id.startsWith(prefix));
}

function planRoleMenuMessage({ menu = {}, messages = [], refresh = false } = {}) {
  const menuId = clean(menu.id);
  if (!menuId) throw new TypeError('Role menu message planning requires a menu id.');
  const available = Array.isArray(messages) ? messages : [];
  const persisted = clean(menu.messageId);

  if (persisted) {
    const exact = available.find((message) => clean(message?.id) === persisted);
    if (exact) {
      return Object.freeze({
        action: refresh ? 'refresh' : 'keep',
        discordMessageId: persisted,
        reason: refresh ? 'refresh-requested' : 'id',
      });
    }
  }

  const matches = available.filter((message) => isManagedRoleMenuMessage(message, menuId));
  if (matches.length === 1) {
    return Object.freeze({
      action: 'adopt',
      discordMessageId: clean(matches[0].id),
      reason: 'managed-button-marker',
    });
  }
  if (matches.length > 1) {
    return Object.freeze({
      action: 'review',
      discordMessageId: null,
      reason: 'multiple-managed-menu-matches',
      candidates: Object.freeze(matches.map((message) => clean(message?.id)).filter(Boolean)),
    });
  }

  return Object.freeze({
    action: 'create',
    discordMessageId: null,
    reason: persisted ? 'persisted-message-missing' : 'message-not-bound',
  });
}

module.exports = {
  messageCustomIds,
  isManagedRoleMenuMessage,
  planRoleMenuMessage,
};
