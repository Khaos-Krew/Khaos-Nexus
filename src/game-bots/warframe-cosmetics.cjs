'use strict';

function parseCosmeticRoles(env = process.env) {
  const raw = String(env.CEPHALON_COSMETIC_ROLES || '').trim();
  const roles = [];
  if (!raw) return roles;
  for (const part of raw.split(',')) {
    const [idRaw, ...labelParts] = part.split(':');
    const id = String(idRaw || '').trim();
    const label = labelParts.join(':').replace(/[\r\n]/g, ' ').trim().slice(0, 32);
    if (!/^\d{17,20}$/.test(id) || !label) continue;
    if (!roles.some((role) => role.id === id)) roles.push({ id, label });
  }
  return roles.slice(0, 25);
}

function memberHasRole(roleIds, roleId) {
  const ids = Array.isArray(roleIds) ? roleIds.map(String) : [];
  return ids.includes(String(roleId));
}

function cosmeticPlan(roles, roleIds, requestedId) {
  const match = (roles || []).find((role) => role.id === String(requestedId || '').trim());
  if (!match) return { ok: false, reason: 'not-cosmetic' };
  const action = memberHasRole(roleIds, match.id) ? 'remove' : 'add';
  return { ok: true, action, roleId: match.id, label: match.label };
}

function cosmeticListText(roles) {
  if (!roles.length) {
    return 'Warframe cosmetic roles are not configured. This command does not change Nexus Sentinal ranks or wallet.';
  }
  return [
    '**Warframe cosmetic roles**',
    'These are Discord-side cosmetics. They do not grant items, plat, or Nexus Sentinal ranks.',
    ...roles.map((role) => `• ${role.label} (\`${role.id}\`)`),
    '',
    'Use `/cosmetic` with a listed role id to add or remove it.'
  ].join('\n');
}

module.exports = { parseCosmeticRoles, memberHasRole, cosmeticPlan, cosmeticListText };
