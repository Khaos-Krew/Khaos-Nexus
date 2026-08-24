'use strict';

const { normalizedName, exactRoleForLabel } = require('./self-role-model.cjs');

const LEGACY_ROLE_MENU_TITLES = Object.freeze([
  'Game Types & Playstyle',
  'Games',
  'Notification Pings',
  'Name Color — Page 1',
  'Name Color — Page 2',
  'Pronouns',
  'Playstyle',
  'Region / Timezone',
  'Looking For Group',
  'Content Preferences',
  'Platforms'
]);

const LEGACY_ROLE_MENU_TITLE_KEYS = new Set(LEGACY_ROLE_MENU_TITLES.map(normalizedName));

const EXPLICIT_ALIASES = Object.freeze({
  [normalizedName('Content Preferences')]: Object.freeze({
    [normalizedName('Fashion')]: 'Screenshots / Fashion',
    [normalizedName('Lore')]: 'Lore Discussion'
  }),
  [normalizedName('Notification Pings')]: Object.freeze({
    [normalizedName('Events')]: 'Events Ping',
    [normalizedName('Giveaways')]: 'Giveaways Ping',
    [normalizedName('Ko-fi / Supporter Updates')]: 'Supporter Updates'
  }),
  [normalizedName('Games')]: Object.freeze({
    [normalizedName('Ark Survival Ascended')]: 'ARK: Survival Ascended Access',
    [normalizedName('Warframe')]: 'Warframe Access',
    [normalizedName('Minecraft')]: 'Minecraft Access',
    [normalizedName('Dungeons & Dragons')]: 'Nexus D&D Access'
  }),
  [normalizedName('Game Types & Playstyle')]: Object.freeze({
    [normalizedName('MMO / RPG')]: 'MMO / Online RPG',
    [normalizedName('Modded MC')]: 'Modded Minecraft',
    [normalizedName('Grinder')]: 'Endgame Grinder',
    [normalizedName('Helper')]: 'Mentor / Helper'
  })
});

function isLegacyRoleMenuTitle(title) {
  return LEGACY_ROLE_MENU_TITLE_KEYS.has(normalizedName(title));
}

function canonicalLegacyRoleName(menuTitle, label) {
  const titleKey = normalizedName(menuTitle);
  const labelKey = normalizedName(label);
  if (!titleKey || !labelKey || !LEGACY_ROLE_MENU_TITLE_KEYS.has(titleKey)) return '';
  if (titleKey === normalizedName('Name Color — Page 1') || titleKey === normalizedName('Name Color — Page 2')) {
    return `Color: ${String(label || '').trim()}`;
  }
  return EXPLICIT_ALIASES[titleKey]?.[labelKey] || '';
}

function resolveLegacyRole(menuTitle, label, roles = []) {
  const direct = exactRoleForLabel(roles, label);
  if (direct) return { role: direct, source: 'exact', target: String(direct.name || label) };
  const target = canonicalLegacyRoleName(menuTitle, label);
  if (!target) return { role: null, source: 'unresolved', target: '' };
  const aliased = exactRoleForLabel(roles, target);
  return aliased
    ? { role: aliased, source: 'alias', target }
    : { role: null, source: 'alias-unresolved', target };
}

module.exports = {
  LEGACY_ROLE_MENU_TITLES,
  EXPLICIT_ALIASES,
  isLegacyRoleMenuTitle,
  canonicalLegacyRoleName,
  resolveLegacyRole
};
