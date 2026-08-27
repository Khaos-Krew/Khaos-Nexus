'use strict';

function requireFunction(target, name) {
  if (!target || typeof target[name] !== 'function') {
    throw new TypeError(`Sentinel role executor requires ${name}().`);
  }
  return target[name].bind(target);
}

async function emitAudit(audit, event) {
  if (typeof audit === 'function') await audit(Object.freeze({ ...event }));
}

async function executeManagedRoleSyncPlan({
  plan = [],
  definitions = [],
  gateway,
  persistBinding,
  audit,
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
      await emitAudit(audit, {
        type: 'sentinel.role.adopted',
        roleKey: item.roleKey,
        discordRoleId: item.discordRoleId,
      });
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
      await emitAudit(audit, {
        type: 'sentinel.role.created',
        roleKey: item.roleKey,
        discordRoleId,
      });
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

  // Remove conflicting managed roles before adding the new exclusive role.
  // This preserves deterministic name-color precedence and avoids transient multi-color state.
  for (const discordRoleId of remove) {
    await removeRole(normalizedMemberId, discordRoleId);
    await emitAudit(audit, {
      type: 'sentinel.member_role.removed',
      memberId: normalizedMemberId,
      roleKey: plan.roleKey,
      group: plan.group,
      discordRoleId,
    });
  }

  for (const discordRoleId of add) {
    await addRole(normalizedMemberId, discordRoleId);
    await emitAudit(audit, {
      type: 'sentinel.member_role.added',
      memberId: normalizedMemberId,
      roleKey: plan.roleKey,
      group: plan.group,
      discordRoleId,
    });
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
