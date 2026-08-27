'use strict';

const { normalizeAuditEntry } = require('../shared/discord-automation.cjs');

function requireFunction(target, name) {
  if (!target || typeof target[name] !== 'function') {
    throw new TypeError(`Sentinel role executor requires ${name}().`);
  }
  return target[name].bind(target);
}

function auditEntry({ action, targetType, targetId, targetName, summary, details, actor = {} }) {
  return normalizeAuditEntry({
    category: 'sentinel-roles',
    action,
    outcome: 'success',
    actorId: actor.id,
    actorName: actor.name || 'Nexus Sentinel',
    actorRole: actor.role || 'local-admin',
    targetType,
    targetId,
    targetName,
    summary,
    details,
  });
}

async function emitAudit(audit, event) {
  if (typeof audit === 'function') await audit(event);
}

async function executeManagedRoleSyncPlan({
  plan = [],
  definitions = [],
  gateway,
  persistBinding,
  audit,
  actor,
  dryRun = true,
} = {}) {
  const byKey = new Map((definitions || []).map((definition) => [definition.roleKey, definition]));
  const results = [];

  for (const item of plan || []) {
    const definition = byKey.get(item.roleKey);
    if (!definition) throw new TypeError(`Missing managed role definition for ${item.roleKey}.`);

    if (item.action === 'keep') {
      results.push({ roleKey: item.roleKey, status: 'kept', discordRoleId: item.discordRoleId || null });
      continue;
    }

    if (item.action === 'review') {
      results.push({
        roleKey: item.roleKey,
        status: 'review-required',
        discordRoleId: null,
        reason: item.reason || 'ambiguous',
        candidates: [...(item.candidates || [])],
      });
      continue;
    }

    if (item.action === 'unbound') {
      results.push({ roleKey: item.roleKey, status: 'unbound', discordRoleId: null });
      continue;
    }

    if (item.action === 'adopt') {
      if (dryRun) {
        results.push({ roleKey: item.roleKey, status: 'would-adopt', discordRoleId: item.discordRoleId });
        continue;
      }
      if (typeof persistBinding !== 'function') {
        throw new TypeError('Sentinel role executor requires persistBinding() for adoption.');
      }
      await persistBinding(item.roleKey, item.discordRoleId);
      await emitAudit(audit, auditEntry({
        action: 'role-adopted',
        targetType: 'discord-role',
        targetId: item.discordRoleId,
        targetName: definition.displayName,
        summary: `Adopted existing Discord role for ${item.roleKey}.`,
        details: { roleKey: item.roleKey },
        actor,
      }));
      results.push({ roleKey: item.roleKey, status: 'adopted', discordRoleId: item.discordRoleId });
      continue;
    }

    if (item.action === 'create') {
      if (dryRun) {
        results.push({ roleKey: item.roleKey, status: 'would-create', discordRoleId: null });
        continue;
      }
      const createRole = requireFunction(gateway, 'createRole');
      if (typeof persistBinding !== 'function') {
        throw new TypeError('Sentinel role executor requires persistBinding() for role creation.');
      }
      const created = await createRole({
        roleKey: definition.roleKey,
        name: definition.displayName,
        group: definition.group || null,
        priority: Number(definition.priority) || 0,
      });
      const discordRoleId = String(created?.id || '').trim();
      if (!discordRoleId) throw new Error(`Discord role creation returned no ID for ${item.roleKey}.`);
      await persistBinding(item.roleKey, discordRoleId);
      await emitAudit(audit, auditEntry({
        action: 'role-created',
        targetType: 'discord-role',
        targetId: discordRoleId,
        targetName: definition.displayName,
        summary: `Created managed Discord role for ${item.roleKey}.`,
        details: { roleKey: item.roleKey, group: definition.group || null },
        actor,
      }));
      results.push({ roleKey: item.roleKey, status: 'created', discordRoleId });
      continue;
    }

    throw new TypeError(`Unsupported managed role action: ${item.action}`);
  }

  return results;
}

async function executeExclusiveRoleAssignment({
  memberId,
  plan,
  gateway,
  audit,
  actor,
  dryRun = true,
} = {}) {
  const normalizedMemberId = String(memberId || '').trim();
  if (!normalizedMemberId) throw new TypeError('A memberId is required for role assignment.');
  if (!plan || !plan.roleKey || !plan.group) throw new TypeError('A valid exclusive role plan is required.');

  const remove = [...(plan.remove || [])].map(String);
  const add = [...(plan.add || [])].map(String);

  if (dryRun) {
    return {
      roleKey: plan.roleKey,
      memberId: normalizedMemberId,
      status: plan.noop ? 'noop' : 'would-apply',
      remove,
      add,
    };
  }

  if (plan.noop) {
    return { roleKey: plan.roleKey, memberId: normalizedMemberId, status: 'noop', remove: [], add: [] };
  }

  const removeRole = remove.length ? requireFunction(gateway, 'removeRoleFromMember') : null;
  const addRole = add.length ? requireFunction(gateway, 'addRoleToMember') : null;

  for (const discordRoleId of remove) {
    await removeRole(normalizedMemberId, discordRoleId);
    await emitAudit(audit, auditEntry({
      action: 'member-role-removed',
      targetType: 'discord-member',
      targetId: normalizedMemberId,
      targetName: normalizedMemberId,
      summary: `Removed conflicting ${plan.group} role before applying ${plan.roleKey}.`,
      details: { roleKey: plan.roleKey, group: plan.group, discordRoleId },
      actor,
    }));
  }

  for (const discordRoleId of add) {
    await addRole(normalizedMemberId, discordRoleId);
    await emitAudit(audit, auditEntry({
      action: 'member-role-added',
      targetType: 'discord-member',
      targetId: normalizedMemberId,
      targetName: normalizedMemberId,
      summary: `Applied ${plan.roleKey} in the ${plan.group} role group.`,
      details: { roleKey: plan.roleKey, group: plan.group, discordRoleId },
      actor,
    }));
  }

  return {
    roleKey: plan.roleKey,
    memberId: normalizedMemberId,
    status: 'applied',
    remove,
    add,
  };
}

module.exports = {
  executeManagedRoleSyncPlan,
  executeExclusiveRoleAssignment,
};
