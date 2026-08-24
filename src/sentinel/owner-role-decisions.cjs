'use strict';

const PLATFORM_ROLE_MIGRATIONS = Object.freeze([
  Object.freeze({ label:'PC', canonicalRoleId:'1492769364477350030', duplicateRoleId:'1516604271251034212' }),
  Object.freeze({ label:'PlayStation', canonicalRoleId:'1492769365588709509', duplicateRoleId:'1516604272492417094' }),
  Object.freeze({ label:'Xbox', canonicalRoleId:'1492769365215416341', duplicateRoleId:'1516604271909539840' }),
  Object.freeze({ label:'Mobile', canonicalRoleId:'1492769367396585534', duplicateRoleId:'1516604274132647946' })
]);

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function roleById(roles, id) {
  if (!roles) return null;
  if (typeof roles.get === 'function') return roles.get(String(id)) || null;
  return valuesOf(roles).find((role) => String(role?.id || '') === String(id || '')) || null;
}

async function migrateDuplicateRole(guild, decision, options = {}) {
  const logger = options.logger || console;
  const roles = options.roles || await guild.roles.fetch();
  const canonical = roleById(roles, decision.canonicalRoleId);
  const duplicate = roleById(roles, decision.duplicateRoleId);
  const result = {
    label:decision.label,
    canonicalRoleId:decision.canonicalRoleId,
    duplicateRoleId:decision.duplicateRoleId,
    membersMigrated:0,
    duplicateDeleted:false,
    skipped:false,
    warning:''
  };

  if (!duplicate) {
    result.skipped = true;
    return result;
  }
  if (!canonical) {
    result.warning = `${decision.label}: approved canonical role ${decision.canonicalRoleId} was not found; duplicate was left untouched.`;
    return result;
  }
  if (canonical.editable === false || duplicate.editable === false || duplicate.managed === true) {
    result.warning = `${decision.label}: one of the approved platform roles is not manageable by Sentinal; duplicate was left untouched.`;
    return result;
  }

  try {
    if (guild.members?.fetch) await guild.members.fetch();
  } catch (error) {
    result.warning = `${decision.label}: member inventory could not be loaded before role migration (${String(error?.message || error)}); duplicate was left untouched.`;
    return result;
  }

  const members = valuesOf(duplicate.members);
  let failed = 0;
  for (const member of members) {
    try {
      const cache = member?.roles?.cache;
      const alreadyCanonical = Boolean(cache?.has?.(String(canonical.id)));
      if (!alreadyCanonical) {
        await member.roles.add(canonical, `Nexus Sentinal owner-approved platform role consolidation: ${decision.label}`);
      }
      await member.roles.remove(duplicate, `Nexus Sentinal owner-approved platform role consolidation: ${decision.label}`);
      result.membersMigrated += 1;
    } catch (error) {
      failed += 1;
      logger.warn?.(`[Nexus Sentinal] ${decision.label} platform member ${member?.id || 'unknown'} could not be migrated: ${String(error?.message || error)}`);
    }
  }

  if (failed) {
    result.warning = `${decision.label}: ${failed} member migration(s) failed, so duplicate role ${duplicate.id} was preserved.`;
    return result;
  }

  try {
    await duplicate.delete(`Nexus Sentinal owner-approved duplicate platform role consolidation: ${decision.label}`);
    result.duplicateDeleted = true;
  } catch (error) {
    result.warning = `${decision.label}: members migrated, but duplicate role ${duplicate.id} could not be deleted (${String(error?.message || error)}).`;
  }
  return result;
}

async function reconcileOwnerApprovedRoles(guild, options = {}) {
  const roles = await guild.roles.fetch();
  const results = [];
  for (const decision of PLATFORM_ROLE_MIGRATIONS) {
    results.push(await migrateDuplicateRole(guild, decision, { ...options, roles }));
  }
  return {
    results,
    membersMigrated:results.reduce((sum, item) => sum + item.membersMigrated, 0),
    duplicatesDeleted:results.filter((item) => item.duplicateDeleted).length,
    warnings:results.map((item) => item.warning).filter(Boolean)
  };
}

module.exports = {
  PLATFORM_ROLE_MIGRATIONS,
  valuesOf,
  roleById,
  migrateDuplicateRole,
  reconcileOwnerApprovedRoles
};
