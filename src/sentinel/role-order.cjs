'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { isSelectableColorRole, configuredColorRoleIds } = require('./staff-name-color-preview.cjs');
const { enabledAccessDefinitions } = require('./role-menu.cjs');
const { configuredSelfRoleMenus } = require('./self-role-model.cjs');

const WARFRAME_CLAN_MEMBER_ID = '1552750297732874332';
const WARFRAME_CLAN_OFFICER_ID = '1552750301625188384';

const AUTHORITY_FLAGS = Object.freeze([
  ['Administrator', PermissionFlagsBits.Administrator],
  ['ManageGuild', PermissionFlagsBits.ManageGuild],
  ['ManageRoles', PermissionFlagsBits.ManageRoles],
  ['KickMembers', PermissionFlagsBits.KickMembers],
  ['BanMembers', PermissionFlagsBits.BanMembers],
  ['ModerateMembers', PermissionFlagsBits.ModerateMembers]
].filter(([, bit]) => bit !== undefined && bit !== null));

function emptyBands() {
  return { colors: 0, staffBots: 0, game: 0, rest: 0 };
}

function emptyGroups() {
  return { colors: [], staffBots: [], game: [], rest: [] };
}

function oneLine(value, max = 240) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function rolePosition(role) {
  const value = Number(role?.position ?? role?.rawPosition ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function roleOrderEnabled(env = process.env) {
  const source = env || {};
  if (source.SENTINAL_ROLE_ORDER_ENABLED === undefined || String(source.SENTINAL_ROLE_ORDER_ENABLED).trim() === '') return true;
  return !['0', 'false', 'off', 'no', 'disabled'].includes(String(source.SENTINAL_ROLE_ORDER_ENABLED).trim().toLowerCase());
}

function parseIdList(value) {
  return [...new Set(String(value || '').split(/[\s,]+/).map((item) => item.trim()).filter((item) => /^\d{15,25}$/.test(item)))];
}

function roleOrderOverrides(env = process.env) {
  const source = env || {};
  return {
    colorIds: parseIdList(source.SENTINAL_ROLE_ORDER_COLOR_IDS),
    staffBotIds: parseIdList(source.SENTINAL_ROLE_ORDER_STAFF_BOT_IDS),
    gameIds: parseIdList(source.SENTINAL_ROLE_ORDER_GAME_IDS),
    protectedIds: parseIdList(source.SENTINAL_ROLE_ORDER_PROTECTED_IDS)
  };
}

function envOf(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'env')) return options.env || {};
  return process.env;
}

function hasFlag(permissions, flag) {
  if (!permissions || flag === undefined || flag === null) return false;
  if (typeof permissions.has === 'function') return Boolean(permissions.has(flag));
  try {
    const bits = typeof permissions === 'bigint' ? permissions : BigInt(permissions.bitfield ?? permissions);
    return (bits & BigInt(flag)) === BigInt(flag);
  } catch {
    return false;
  }
}

function integrationBotId(role) {
  const tags = role?.tags;
  const raw = String(tags?.botId || tags?.bot_id || role?.botId || '').trim();
  return raw;
}

function isBotManagedRole(role) {
  return Boolean(integrationBotId(role));
}

function isHumanAuthorityRole(role) {
  if (isBotManagedRole(role)) return false;
  return AUTHORITY_FLAGS.some(([, bit]) => hasFlag(role?.permissions, bit));
}

function memberCanManageRoles(member) {
  const permissions = member?.permissions;
  if (!permissions) return false;
  return hasFlag(permissions, PermissionFlagsBits.ManageRoles) || hasFlag(permissions, PermissionFlagsBits.Administrator);
}

function menuIsColors(menu) {
  if (!menu) return false;
  if (menu.kind === 'colors') return true;
  return /\bcolou?r(s)?\b/i.test(`${menu.id || ''} ${menu.name || ''} ${menu.title || ''}`);
}

function isGameSelfRoleMenu(menu) {
  if (!menu || menuIsColors(menu)) return false;
  return /\bgames?\b/i.test(`${menu.id || ''} ${menu.name || ''} ${menu.title || ''}`);
}

function roleIdsFromMenus(menus, predicate) {
  const ids = [];
  for (const menu of menus || []) {
    if (!predicate(menu)) continue;
    for (const option of menu.options || []) {
      const id = String(option?.roleId || option?.role_id || '').trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

function accessRoleNamesFromCatalog(config = {}) {
  const names = new Set();
  for (const definition of enabledAccessDefinitions(config)) {
    const roleName = normalizeName(definition?.roleName);
    if (roleName) names.add(roleName);
    for (const alias of definition?.roleAliases || []) {
      const name = normalizeName(alias);
      if (name) names.add(name);
    }
  }
  return [...names];
}

function idSet(values) {
  return new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean));
}

function byCurrentPosition(left, right) {
  return right.position - left.position || String(left.id).localeCompare(String(right.id));
}

function enforceOfficerAboveMember(ordered) {
  const officerIndex = ordered.findIndex((role) => role.id === WARFRAME_CLAN_OFFICER_ID);
  const memberIndex = ordered.findIndex((role) => role.id === WARFRAME_CLAN_MEMBER_ID);
  if (officerIndex < 0 || memberIndex < 0 || officerIndex < memberIndex) return ordered;
  const next = ordered.slice();
  next[officerIndex] = ordered[memberIndex];
  next[memberIndex] = ordered[officerIndex];
  return next;
}

function skippedPlan(reason, warnings, extra = {}) {
  return {
    ok: false,
    skipped: true,
    noop: false,
    reason,
    warnings,
    updates: [],
    moved: 0,
    bands: extra.bands || emptyBands(),
    groups: extra.groups || emptyGroups(),
    ladder: extra.ladder || [],
    pins: extra.pins || []
  };
}

function planRoleOrder(options = {}) {
  const env = envOf(options);
  const overrides = roleOrderOverrides(env);
  const canManageRoles = options.canManageRoles !== undefined ? Boolean(options.canManageRoles) : memberCanManageRoles(options.botMember);
  if (!canManageRoles) {
    return skippedPlan('missing-manage-roles', ['Sentinal lacks Manage Roles; role order was not changed.']);
  }

  const ceiling = Number(options.botHighestPosition ?? options.botMember?.roles?.highest?.position ?? 0);
  const ceilingRoleId = String(options.botHighestRoleId || options.botMember?.roles?.highest?.id || '');
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return skippedPlan('missing-bot-ceiling', ['Sentinal highest role position is unknown; role order was not changed.']);
  }

  const guildId = String(options.guildId || options.guild?.id || '');
  const sentinalBotId = String(options.sentinalBotId || options.botMember?.id || '');
  const sentinalRoleIds = idSet(options.sentinalRoleIds || [...(options.botMember?.roles?.cache?.keys?.() || [])]);
  if (ceilingRoleId) sentinalRoleIds.add(ceilingRoleId);

  const menus = options.menus || (options.config ? configuredSelfRoleMenus(options.config) : []);
  const detectedColorIds = idSet([
    ...(options.colorRoleIds || []),
    ...configuredColorRoleIds(options.config || {}),
    ...roleIdsFromMenus(menus, menuIsColors)
  ]);
  const colorOverrides = idSet([...(options.colorOverrideIds || []), ...overrides.colorIds]);
  const staffBotOverrides = idSet([...(options.staffBotOverrideIds || []), ...overrides.staffBotIds]);
  const gameOverrides = idSet([...(options.gameOverrideIds || []), ...overrides.gameIds]);
  const protectedOverrides = idSet([...(options.protectedRoleIds || []), ...overrides.protectedIds]);
  const accessNames = new Set((options.accessRoleNames || []).map(normalizeName).filter(Boolean));
  const autoGameIds = idSet([
    WARFRAME_CLAN_MEMBER_ID,
    WARFRAME_CLAN_OFFICER_ID,
    ...(options.gameRoleIds || []),
    ...(options.accessRoleIds || []),
    ...roleIdsFromMenus(menus, isGameSelfRoleMenu)
  ]);

  const seen = new Set();
  const described = [];
  for (const role of valuesOf(options.roles)) {
    const id = String(role?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const botId = integrationBotId(role);
    const sentinalOwn = id === ceilingRoleId || sentinalRoleIds.has(id) || Boolean(botId && sentinalBotId && botId === sentinalBotId);
    described.push({
      id,
      name: oneLine(role?.name, 80) || id,
      position: rolePosition(role),
      botId,
      sentinalOwn,
      humanAuthority: isHumanAuthorityRole(role)
    });
  }

  const warnings = [];
  const pins = [];
  const movable = [];

  for (const role of described) {
    const everyone = role.id === guildId || role.position <= 0;
    const aboveCeiling = role.position >= ceiling || role.id === ceilingRoleId;
    const explicitProtected = protectedOverrides.has(role.id);
    let kind = '';
    if (everyone) kind = 'everyone';
    else if (role.id === ceilingRoleId) kind = 'ceiling';
    else if (aboveCeiling) kind = 'unmovable';
    else if (role.humanAuthority) kind = 'staff';
    else if (explicitProtected) kind = 'protected';

    if (kind) {
      if (colorOverrides.has(role.id) || staffBotOverrides.has(role.id) || gameOverrides.has(role.id)) {
        warnings.push(`Role ${role.name} (${role.id}) is protected, so band overrides were not applied.`);
      }
      pins.push({ ...role, band: kind === 'ceiling' ? 'ceiling' : 'protected', kind });
      continue;
    }

    let band = 'rest';
    if (colorOverrides.has(role.id)) band = 'colors';
    else if (staffBotOverrides.has(role.id) && !role.sentinalOwn) band = 'staffBots';
    else if (gameOverrides.has(role.id)) band = 'game';
    else if (detectedColorIds.has(role.id) || isSelectableColorRole({ id: role.id, name: role.name }, detectedColorIds)) band = 'colors';
    else if (role.botId && !role.sentinalOwn) band = 'staffBots';
    else if (autoGameIds.has(role.id) || accessNames.has(normalizeName(role.name))) band = 'game';
    movable.push({ ...role, band });
  }

  const staffFloorRoles = pins.filter((role) => role.humanAuthority && role.position > 0 && role.position < ceiling);
  const staffFloor = staffFloorRoles.length ? Math.min(...staffFloorRoles.map((role) => role.position)) : ceiling;
  const blockers = movable.filter((role) => role.position >= staffFloor);
  if (blockers.length) {
    const sample = blockers.slice(0, 5).map((role) => `${role.name} (${role.id}) @${role.position}`).join(', ');
    return skippedPlan(
      'protected-staff-gap',
      [`Movable roles sit above protected staff. Drag human staff roles up under Sentinal before ordering: ${sample}.`],
      { pins }
    );
  }

  const slots = movable.map((role) => role.position).sort((left, right) => right - left);
  if (new Set(slots).size !== slots.length) {
    return skippedPlan('duplicate-positions', ['Role positions are not unique; role order was not changed.'], { pins });
  }

  const colors = movable.filter((role) => role.band === 'colors').sort(byCurrentPosition);
  const staffBots = movable.filter((role) => role.band === 'staffBots').sort(byCurrentPosition);
  const game = enforceOfficerAboveMember(movable.filter((role) => role.band === 'game').sort(byCurrentPosition));
  const rest = movable.filter((role) => role.band === 'rest').sort(byCurrentPosition);
  const ordered = [...colors, ...staffBots, ...game, ...rest];
  if (ordered.length !== slots.length) {
    return skippedPlan('slot-mismatch', ['Role order could not place every movable role; nothing was changed.'], { pins });
  }

  const assigned = new Map(pins.map((role) => [role.id, role.position]));
  ordered.forEach((role, index) => assigned.set(role.id, slots[index]));

  const officerPosition = assigned.get(WARFRAME_CLAN_OFFICER_ID);
  const memberPosition = assigned.get(WARFRAME_CLAN_MEMBER_ID);
  if (officerPosition !== undefined && memberPosition !== undefined && officerPosition <= memberPosition) {
    return skippedPlan(
      'officer-below-member',
      ['Warframe Clan Officer would stay below Clan Member. Refusing to move protected roles.'],
      { pins }
    );
  }

  const colorTooHigh = ordered.some((role, index) => role.band === 'colors' && slots[index] >= staffFloor);
  if (colorTooHigh) {
    return skippedPlan(
      'insufficient-safe-space',
      ['Not enough positions below protected staff for the color band. Nothing was changed.'],
      { pins }
    );
  }

  const updates = ordered
    .map((role, index) => ({ role: role.id, position: slots[index], from: role.position }))
    .filter((item) => item.from !== item.position)
    .map(({ role, position }) => ({ role, position }))
    .sort((left, right) => left.position - right.position || String(left.role).localeCompare(String(right.role)));

  const bands = {
    colors: colors.length,
    staffBots: staffBots.length,
    game: game.length,
    rest: rest.length
  };
  const groups = {
    colors: colors.map((role) => role.id),
    staffBots: staffBots.map((role) => role.id),
    game: game.map((role) => role.id),
    rest: rest.map((role) => role.id)
  };
  const ladder = described
    .map((role) => {
      const placed = ordered.find((item) => item.id === role.id);
      const pin = pins.find((item) => item.id === role.id);
      return {
        id: role.id,
        name: role.name,
        band: placed?.band || pin?.band || 'protected',
        from: role.position,
        to: assigned.get(role.id)
      };
    })
    .sort((left, right) => right.to - left.to || String(left.id).localeCompare(String(right.id)));

  return {
    ok: true,
    skipped: false,
    noop: updates.length === 0,
    reason: updates.length === 0 ? 'already-ordered' : '',
    warnings,
    updates,
    moved: 0,
    bands,
    groups,
    ladder,
    pins
  };
}

function formatRoleOrderLog({ reason = 'pass', moved = 0, bands = emptyBands(), warnings = [] } = {}) {
  const counts = {
    colors: Number(bands?.colors || 0),
    staffBots: Number(bands?.staffBots || 0),
    game: Number(bands?.game || 0),
    rest: Number(bands?.rest || 0)
  };
  const warningText = warnings.length ? warnings.map((warning) => oneLine(warning, 180)).join('; ').slice(0, 400) : 'none';
  return `[Nexus Sentinal] role order (${oneLine(reason, 80)}): moved=${Number(moved) || 0} bands={colors:${counts.colors},staffBots:${counts.staffBots},game:${counts.game},rest:${counts.rest}} warnings=${warningText}`;
}

function formatRoleOrderPreview(plan = {}) {
  const bands = plan.bands || emptyBands();
  const lines = [];
  if (plan.reason === 'disabled') lines.push('Role order is disabled (SENTINAL_ROLE_ORDER_ENABLED).');
  else if (plan.skipped) lines.push('Role order skipped. No positions were changed.');
  else if (plan.noop || !plan.updates?.length) lines.push('Role order already matches the ladder.');
  else lines.push(`Role order would move ${plan.updates.length} role${plan.updates.length === 1 ? '' : 's'}.`);
  lines.push(`bands colors=${bands.colors} staffBots=${bands.staffBots} game=${bands.game} rest=${bands.rest}`);
  lines.push(`warnings=${plan.warnings?.length ? plan.warnings.map((warning) => oneLine(warning, 180)).join(' | ') : 'none'}`);
  const ladder = Array.isArray(plan.ladder) ? plan.ladder : [];
  if (ladder.length) {
    lines.push('Planned top to bottom:');
    const visible = ladder.slice(0, 40);
    for (const row of visible) {
      const shift = row.from === row.to ? `pos ${row.to}` : `pos ${row.from} -> ${row.to}`;
      lines.push(`- ${row.band} ${oneLine(row.name, 60)} ${shift}`);
    }
    if (ladder.length > visible.length) lines.push(`… ${ladder.length - visible.length} more roles`);
  }
  const text = lines.join('\n');
  return text.length > 1900 ? `${text.slice(0, 1850)}\n… truncated` : text;
}

function disabledPlan() {
  return {
    ok: true,
    skipped: true,
    noop: false,
    reason: 'disabled',
    warnings: ['Role order is disabled (SENTINAL_ROLE_ORDER_ENABLED).'],
    updates: [],
    moved: 0,
    bands: emptyBands(),
    groups: emptyGroups(),
    ladder: [],
    pins: []
  };
}

async function rolesFromGuild(guild) {
  const cache = guild?.roles?.cache;
  if (cache && Number(cache.size || 0) > 0) return valuesOf(cache);
  if (typeof guild?.roles?.fetch === 'function') return valuesOf(await guild.roles.fetch());
  return [];
}

async function botMemberFromGuild(guild, client) {
  if (guild?.members?.me) return guild.members.me;
  const userId = String(client?.user?.id || '');
  if (userId && typeof guild?.members?.fetch === 'function') {
    try { return await guild.members.fetch(userId); } catch { return null; }
  }
  return null;
}

async function reconcileRoleOrder(guild, options = {}) {
  const env = envOf(options);
  if (!roleOrderEnabled(env)) return disabledPlan();
  if (!guild) return skippedPlan('missing-guild', ['Role order could not resolve the Discord guild.']);

  const botMember = options.botMember || await botMemberFromGuild(guild, options.client);
  const roles = options.roles || await rolesFromGuild(guild);
  const sentinalRoleIds = options.sentinalRoleIds || [...(botMember?.roles?.cache?.keys?.() || [])];
  const plan = planRoleOrder({
    roles,
    guildId: String(options.guildId || guild.id || ''),
    canManageRoles: options.canManageRoles !== undefined ? options.canManageRoles : memberCanManageRoles(botMember),
    botHighestPosition: options.botHighestPosition ?? rolePosition(botMember?.roles?.highest),
    botHighestRoleId: options.botHighestRoleId || botMember?.roles?.highest?.id || '',
    sentinalBotId: options.sentinalBotId || botMember?.id || '',
    sentinalRoleIds,
    config: options.config || {},
    menus: options.menus,
    accessRoleNames: options.accessRoleNames || accessRoleNamesFromCatalog(options.config || {}),
    accessRoleIds: options.accessRoleIds || [],
    colorRoleIds: options.colorRoleIds || [],
    gameRoleIds: options.gameRoleIds || [],
    protectedRoleIds: options.protectedRoleIds || [],
    env
  });
  if (!plan.ok || plan.skipped || !plan.updates.length || options.apply === false) return { ...plan, moved: 0 };
  if (typeof guild.roles?.setPositions !== 'function') {
    return skippedPlan('missing-position-batch', ['Guild role position batch is unavailable; nothing was changed.'], plan);
  }
  try {
    await guild.roles.setPositions(plan.updates);
  } catch (error) {
    return {
      ...plan,
      ok: false,
      skipped: true,
      noop: false,
      moved: 0,
      updates: [],
      reason: 'apply-failed',
      warnings: [...plan.warnings, `Role positions were not changed: ${oneLine(error?.message || error, 180)}`]
    };
  }
  return { ...plan, moved: plan.updates.length };
}

module.exports = {
  WARFRAME_CLAN_MEMBER_ID,
  WARFRAME_CLAN_OFFICER_ID,
  AUTHORITY_FLAGS,
  emptyBands,
  roleOrderEnabled,
  parseIdList,
  roleOrderOverrides,
  integrationBotId,
  isBotManagedRole,
  isHumanAuthorityRole,
  memberCanManageRoles,
  menuIsColors,
  isGameSelfRoleMenu,
  accessRoleNamesFromCatalog,
  planRoleOrder,
  formatRoleOrderLog,
  formatRoleOrderPreview,
  reconcileRoleOrder
};
