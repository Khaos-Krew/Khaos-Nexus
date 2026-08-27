'use strict';

const { createCommands, COMMAND_MODULES } = require('./commands.cjs');
const {
  FUNCTIONAL_ROLE,
  FUNCTIONAL_ROLE_DISPLAY,
  requiredFunctionalRoleForCommand,
  isPrivilegedCommand,
} = require('./sentinel-permissions.cjs');

const OWNER_HIGH_RISK = new Set(['ban', 'unban', 'shutdown', 'forcestop', 'rcon']);
const EXCLUDED_SURFACES = new Set(['dnd-workspace']);

function clean(value, max = 200) {
  return String(value || '').replace(/\u0000/g, '').trim().slice(0, max);
}

function adminCommandCatalog({ isModuleEnabled = () => true } = {}) {
  return createCommands({ isModuleEnabled })
    .filter((command) => isPrivilegedCommand(command.name))
    .filter((command) => !EXCLUDED_SURFACES.has(COMMAND_MODULES[command.name]))
    .map((command) => {
      const role = requiredFunctionalRoleForCommand(command.name);
      return Object.freeze({
        name: command.name,
        description: clean(command.description, 160),
        moduleId: COMMAND_MODULES[command.name] || 'discord-runtime',
        requiredFunctionalRole: role,
        requiredDisplayRole: FUNCTIONAL_ROLE_DISPLAY[role] || role,
        ownerIdentityRequired: role === FUNCTIONAL_ROLE.OWNER,
        highRisk: OWNER_HIGH_RISK.has(command.name),
      });
    });
}

function renderAdminCommandPanel(options = {}) {
  const commands = adminCommandCatalog(options);
  const groups = new Map();
  for (const command of commands) {
    const key = command.requiredFunctionalRole || FUNCTIONAL_ROLE.ADMIN;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(command);
  }

  const fields = [];
  for (const role of [FUNCTIONAL_ROLE.ADMIN, FUNCTIONAL_ROLE.COMMUNITY_MANAGER, FUNCTIONAL_ROLE.OWNER]) {
    const entries = groups.get(role) || [];
    if (!entries.length) continue;
    const value = entries.map((command) => {
      const guard = command.ownerIdentityRequired ? ' • Owner identity required' : '';
      const risk = command.highRisk ? ' ⚠️' : '';
      return `\`/${command.name}\`${risk} — ${command.description}${guard}`;
    }).join('\n').slice(0, 1024);
    fields.push({
      name: role === FUNCTIONAL_ROLE.OWNER ? 'Nexus Prime — Owner Identity' : `${FUNCTIONAL_ROLE_DISPLAY[role] || role} Commands`,
      value,
      inline: false,
    });
  }

  return Object.freeze({
    embeds: [Object.freeze({
      title: 'Nexus Sentinel • Admin Commands',
      description: 'Administrative commands currently exposed by Sentinel. Access is enforced by the same functional-role policy used at command execution time. Thora controls are intentionally excluded from this surface.',
      color: 0xe3264f,
      fields,
      footer: { text: 'Khaos Nexus • Permissions are enforced server-side' },
    })],
    allowed_mentions: Object.freeze({ parse: [] }),
  });
}

module.exports = {
  OWNER_HIGH_RISK,
  EXCLUDED_SURFACES,
  adminCommandCatalog,
  renderAdminCommandPanel,
};
