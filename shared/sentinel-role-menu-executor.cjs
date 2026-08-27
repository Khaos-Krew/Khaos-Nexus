'use strict';

const { normalizeAuditEntry, renderRoleMenu } = require('./discord-automation.cjs');

function clean(value) {
  return String(value || '').trim();
}

function auditEntry({ action, menu, targetId, summary, actor = {} }) {
  return normalizeAuditEntry({
    category: 'sentinel-role-menus',
    action,
    outcome: 'success',
    actorId: actor.id,
    actorName: actor.name || 'Nexus Sentinel',
    actorRole: actor.role || 'local-admin',
    targetType: 'discord-message',
    targetId,
    targetName: menu.name || menu.id,
    summary,
    details: { menuId: menu.id, kind: menu.kind, channelId: menu.channelId },
  });
}

async function emit(audit, entry) {
  if (typeof audit === 'function') await audit(entry);
}

async function executeRoleMenuMessagePlan({
  menu,
  plan,
  gateway,
  persistMessageBinding,
  audit,
  actor,
  dryRun = true,
} = {}) {
  if (!menu?.id) throw new TypeError('A role menu is required.');
  if (!plan?.action) throw new TypeError('A role menu message plan is required.');
  const channelId = clean(menu.channelId);

  if (plan.action === 'keep') {
    return { menuId: menu.id, status: 'kept', discordMessageId: plan.discordMessageId };
  }
  if (plan.action === 'review') {
    return {
      menuId: menu.id,
      status: 'review-required',
      discordMessageId: null,
      reason: plan.reason,
      candidates: [...(plan.candidates || [])],
    };
  }
  if (plan.action === 'adopt') {
    if (dryRun) return { menuId: menu.id, status: 'would-adopt', discordMessageId: plan.discordMessageId };
    if (typeof persistMessageBinding !== 'function') throw new TypeError('persistMessageBinding() is required for role menu adoption.');
    await persistMessageBinding(menu.id, plan.discordMessageId);
    await emit(audit, auditEntry({
      action: 'message-adopted',
      menu,
      targetId: plan.discordMessageId,
      summary: `Adopted existing Sentinel role menu message ${menu.id}.`,
      actor,
    }));
    return { menuId: menu.id, status: 'adopted', discordMessageId: plan.discordMessageId };
  }
  if (!channelId) throw new Error(`Role menu ${menu.id} has no bound Discord channel.`);

  const payload = renderRoleMenu(menu);

  if (plan.action === 'refresh' || plan.action === 'update') {
    const messageId = clean(plan.discordMessageId);
    if (!messageId) throw new TypeError('A discordMessageId is required to refresh a role menu.');
    if (dryRun) return { menuId: menu.id, status: 'would-update', discordMessageId: messageId };
    if (!gateway || typeof gateway.updateMessageInChannel !== 'function') throw new TypeError('Role menu executor requires updateMessageInChannel().');
    await gateway.updateMessageInChannel({ channelId, discordMessageId: messageId, payload });
    await emit(audit, auditEntry({
      action: 'message-updated',
      menu,
      targetId: messageId,
      summary: `Updated persistent Sentinel role menu ${menu.id}.`,
      actor,
    }));
    return { menuId: menu.id, status: 'updated', discordMessageId: messageId };
  }

  if (plan.action === 'create') {
    if (dryRun) return { menuId: menu.id, status: 'would-create', discordMessageId: null };
    if (!gateway || typeof gateway.sendMessageToChannel !== 'function') throw new TypeError('Role menu executor requires sendMessageToChannel().');
    if (typeof persistMessageBinding !== 'function') throw new TypeError('persistMessageBinding() is required for role menu creation.');
    const created = await gateway.sendMessageToChannel({ channelId, payload });
    const messageId = clean(created?.id);
    if (!messageId) throw new Error(`Role menu creation returned no Discord message ID for ${menu.id}.`);
    await persistMessageBinding(menu.id, messageId);
    await emit(audit, auditEntry({
      action: 'message-created',
      menu,
      targetId: messageId,
      summary: `Created persistent Sentinel role menu ${menu.id}.`,
      actor,
    }));
    return { menuId: menu.id, status: 'created', discordMessageId: messageId };
  }

  throw new TypeError(`Unsupported role menu message action: ${plan.action}`);
}

module.exports = {
  executeRoleMenuMessagePlan,
};
