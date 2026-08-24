'use strict';

const { SelfRoleManager: UnifiedSelfRoleManager } = require('./unified-self-role-manager.cjs');
const { valuesOf, roleHasStaffPower } = require('./self-role-manager.cjs');

const HIERARCHY_WARNING_PREFIXES = Object.freeze([
  'Color-role priority has no safe hierarchy space',
  'Color-role priority could not be fully applied without placing color roles above a moderation role.'
]);

function roleIdsFromRankMap(rankRoles = {}) {
  return Object.values(rankRoles || {}).map(String).filter((id) => /^\d{5,25}$/.test(id));
}

function isHierarchySpacingWarning(message) {
  const text = String(message || '');
  return HIERARCHY_WARNING_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function analyzeManagedColorDisplayConflicts({ roles = [], menus = [], config = {}, state = null } = {}) {
  const allRoles = valuesOf(roles).filter(Boolean);
  const colorIds = new Set();
  const selfRoleIds = new Set();
  for (const menu of menus || []) {
    for (const option of menu?.options || []) {
      const id = String(option?.roleId || '');
      if (!id) continue;
      selfRoleIds.add(id);
      if (menu?.kind === 'colors') colorIds.add(id);
    }
  }

  const colorRoles = allRoles.filter((role) => colorIds.has(String(role?.id || '')));
  if (!colorRoles.length) return {
    displaySafe: true,
    conflictCount: 0,
    lowestSelectableColorPosition: 0,
    conflicts: []
  };

  const lowestSelectableColorPosition = Math.min(...colorRoles.map((role) => Number(role?.position || 0)));
  const operatorIds = new Set((config.discord?.operatorRoleIds || []).map(String));
  const rankIds = new Set([
    ...roleIdsFromRankMap(config.discord?.rankRoles),
    ...roleIdsFromRankMap(state?.getAdminSettings?.()?.rankRoles)
  ]);
  const accessIds = new Set(Object.values(state?.listAccessRoles?.() || {}).map((item) => String(item?.roleId || '')).filter(Boolean));

  const conflicts = allRoles
    .filter((role) => !colorIds.has(String(role?.id || '')))
    .filter((role) => Number(role?.color || 0) !== 0)
    .filter((role) => Number(role?.position || 0) > lowestSelectableColorPosition)
    .filter((role) => {
      const id = String(role?.id || '');
      return operatorIds.has(id) || rankIds.has(id) || accessIds.has(id) || selfRoleIds.has(id) || roleHasStaffPower(role);
    })
    .map((role) => {
      const id = String(role?.id || '');
      const staff = operatorIds.has(id) || roleHasStaffPower(role);
      let source = staff ? 'staff' : 'managed-role';
      if (!staff && rankIds.has(id)) source = 'rank';
      else if (!staff && accessIds.has(id)) source = 'module-access';
      else if (!staff && selfRoleIds.has(id)) source = 'self-role';
      return {
        id,
        name: String(role?.name || ''),
        position: Number(role?.position || 0),
        color: Number(role?.color || 0),
        hexColor: /^#[0-9A-F]{6}$/i.test(String(role?.hexColor || ''))
          ? String(role.hexColor).toUpperCase()
          : `#${Number(role?.color || 0).toString(16).padStart(6, '0').toUpperCase()}`,
        source,
        staff,
        managed: role?.managed === true,
        editable: role?.editable !== false
      };
    })
    .sort((a, b) => b.position - a.position);

  return {
    displaySafe: conflicts.length === 0,
    conflictCount: conflicts.length,
    lowestSelectableColorPosition,
    conflicts
  };
}

function conflictSummary(analysis = {}) {
  const conflicts = Array.isArray(analysis.conflicts) ? analysis.conflicts : [];
  if (!conflicts.length) return 'displaySafe=true conflicts=0';
  const bounded = conflicts.slice(0, 12).map((role) => `${String(role.name).replace(/[\r\n]+/g, ' ').slice(0, 60)}#${role.id}:${role.hexColor}:pos=${role.position}:${role.source}`);
  return `displaySafe=false conflicts=${conflicts.length} roles=[${bounded.join(' | ')}]`;
}

class SelfRoleManager extends UnifiedSelfRoleManager {
  async prioritizeColorRoles(guild, menus, resolvedRoles, warnings) {
    const localWarnings = [];
    const result = await super.prioritizeColorRoles(guild, menus, resolvedRoles, localWarnings);
    const spacingWarnings = localWarnings.filter(isHierarchySpacingWarning);
    if (!spacingWarnings.length) {
      warnings.push(...localWarnings);
      return { ...result, displayConflicts: 0, displaySafe: true };
    }

    const roles = await guild.roles.fetch();
    const analysis = analyzeManagedColorDisplayConflicts({
      roles,
      menus,
      config: this.config,
      state: this.state
    });

    warnings.push(...localWarnings.filter((message) => !isHierarchySpacingWarning(message)));
    if (analysis.displaySafe) {
      console.log(`[Nexus Sentinal] name-color hierarchy optimization skipped safely: ${conflictSummary(analysis)}`);
      return { ...result, displayConflicts: 0, displaySafe: true };
    }

    const staffConflicts = analysis.conflicts.filter((role) => role.staff).length;
    const ordinaryConflicts = analysis.conflictCount - staffConflicts;
    warnings.push(`Name-color display conflict remains: ${analysis.conflictCount} managed colored role(s) are above at least one selectable color (${staffConflicts} staff, ${ordinaryConflicts} rank/access/self-role). Protected hierarchy was left unchanged.`);
    console.warn(`[Nexus Sentinal] name-color display conflicts: ${conflictSummary(analysis)}`);
    return { ...result, displayConflicts: analysis.conflictCount, displaySafe: false };
  }
}

module.exports = {
  HIERARCHY_WARNING_PREFIXES,
  roleIdsFromRankMap,
  isHierarchySpacingWarning,
  analyzeManagedColorDisplayConflicts,
  conflictSummary,
  SelfRoleManager
};
