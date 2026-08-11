'use strict';

const CAPABILITIES = Object.freeze({
  'nexus.view': { risk: 'read', description: 'View Nexus state and non-secret configuration.' },
  'modules.view': { risk: 'read', description: 'View module catalog, runtime state, and migration progress.' },
  'modules.manage': { risk: 'high', description: 'Enable, disable, and reconfigure Nexus modules.' },
  'audit.view': { risk: 'read', description: 'View redacted operational and security audit history.' },
  'audit.export': { risk: 'medium', description: 'Export redacted audit or diagnostic records.' },
  'game.server.read': { risk: 'read', description: 'Read configured game server status and player summaries.' },
  'game.server.save': { risk: 'medium', description: 'Request a game server world save.' },
  'game.server.broadcast': { risk: 'medium', description: 'Send a game server announcement.' },
  'game.server.restart': { risk: 'high', description: 'Run a guarded game server restart workflow.' },
  'game.player.moderate': { risk: 'high', description: 'Kick, ban, unban, or otherwise moderate game players.' },
  'game.console.raw': { risk: 'critical', description: 'Execute an owner-approved raw game console command.' },
  'hosted.power': { risk: 'high', description: 'Start, stop, or restart a hosted game server.' },
  'hosted.kill': { risk: 'critical', description: 'Force-kill a hosted game server process.' },
  'scheduler.view': { risk: 'read', description: 'View shared scheduler jobs and execution history.' },
  'scheduler.manage': { risk: 'high', description: 'Create, edit, run, cancel, or remove shared scheduler jobs.' },
  'discord.read': { risk: 'read', description: 'Read permitted Discord configuration and runtime summaries.' },
  'discord.content.manage': { risk: 'medium', description: 'Manage embeds, announcements, tickets, and community content.' },
  'discord.roles.manage': { risk: 'high', description: 'Manage permitted Discord self-role and community-role configuration.' },
  'discord.structure.manage': { risk: 'high', description: 'Manage permitted Discord categories, channels, and layout.' },
  'discord.members.moderate': { risk: 'high', description: 'Run permitted Discord member moderation actions.' },
  'backup.create': { risk: 'medium', description: 'Create and verify a Nexus backup.' },
  'backup.restore': { risk: 'critical', description: 'Restore Nexus state from a verified backup.' },
  'access.manage': { risk: 'critical', description: 'Change Nexus access-control assignments and owner-protected delegation.' },
  'secrets.manage': { risk: 'critical', description: 'Write, rotate, or remove protected credentials.' },
  'updates.install': { risk: 'critical', description: 'Download and install a Nexus desktop update after backup verification.' },
  'ai.use': { risk: 'medium', description: 'Use enabled AI assistants through scoped Nexus tools.' },
  'ai.manage': { risk: 'high', description: 'Configure AI assistants, models, and tool grants.' },
  'mobile.manage': { risk: 'high', description: 'Manage private mobile companion pairing and revocation.' },
  'cloud.manage': { risk: 'high', description: 'Configure optional cloud adjunct services such as Railway-backed relays.' },
  'release.manage': { risk: 'critical', description: 'Authorize production release operations and release-channel changes.' }
});

const ROLE_CAPABILITIES = Object.freeze({
  locked: Object.freeze([]),
  viewer: Object.freeze([
    'nexus.view',
    'modules.view',
    'audit.view',
    'game.server.read',
    'scheduler.view',
    'discord.read'
  ]),
  operator: Object.freeze([
    'nexus.view',
    'modules.view',
    'audit.view',
    'audit.export',
    'game.server.read',
    'game.server.save',
    'game.server.broadcast',
    'game.server.restart',
    'game.player.moderate',
    'scheduler.view',
    'scheduler.manage',
    'discord.read',
    'discord.content.manage',
    'discord.roles.manage',
    'discord.structure.manage',
    'discord.members.moderate',
    'backup.create',
    'ai.use'
  ]),
  'community-manager': Object.freeze([
    'nexus.view',
    'modules.view',
    'audit.view',
    'audit.export',
    'game.server.read',
    'scheduler.view',
    'discord.read',
    'discord.content.manage',
    'discord.roles.manage',
    'discord.structure.manage',
    'discord.members.moderate',
    'ai.use'
  ]),
  owner: Object.freeze(Object.keys(CAPABILITIES)),
  'local-admin': Object.freeze(Object.keys(CAPABILITIES))
});

function policyError(message, code = 'NEXUS_CAPABILITY_POLICY_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function knownCapability(name) {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, String(name || ''));
}

function normalizeList(values, field) {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw policyError(`${field} must be an array.`);
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
}

function capabilitiesForRole(role) {
  const key = String(role || 'locked');
  const configured = ROLE_CAPABILITIES[key];
  if (!configured) return Object.freeze([]);
  return Object.freeze(configured.slice().sort());
}

function evaluateCapabilities(subject = {}, requiredInput = []) {
  const required = normalizeList(requiredInput, 'requiredCapabilities');
  const unknown = required.filter((capability) => !knownCapability(capability));
  if (unknown.length) {
    return Object.freeze({
      allowed: false,
      role: String(subject.role || 'locked'),
      required: Object.freeze(required),
      granted: Object.freeze([]),
      denied: Object.freeze(unknown),
      unknown: Object.freeze(unknown),
      reason: 'unknown-capability'
    });
  }

  const base = new Set(capabilitiesForRole(subject.role));
  for (const capability of normalizeList(subject.grantedCapabilities, 'grantedCapabilities')) {
    if (!knownCapability(capability)) throw policyError(`Unknown granted capability: ${capability}.`);
    base.add(capability);
  }
  const explicitDenials = new Set(normalizeList(subject.deniedCapabilities, 'deniedCapabilities'));
  for (const capability of explicitDenials) {
    if (!knownCapability(capability)) throw policyError(`Unknown denied capability: ${capability}.`);
    base.delete(capability);
  }

  const denied = required.filter((capability) => !base.has(capability));
  return Object.freeze({
    allowed: denied.length === 0,
    role: String(subject.role || 'locked'),
    required: Object.freeze(required),
    granted: Object.freeze([...base].sort()),
    denied: Object.freeze(denied),
    unknown: Object.freeze([]),
    reason: denied.length ? 'missing-capability' : 'allowed'
  });
}

function assertCapabilities(subject, required, action = 'This action') {
  const decision = evaluateCapabilities(subject, required);
  if (decision.allowed) return decision;
  const error = policyError(`${action} requires capabilities: ${decision.denied.join(', ')}.`, 'NEXUS_CAPABILITY_DENIED');
  error.decision = decision;
  throw error;
}

module.exports = {
  CAPABILITIES,
  ROLE_CAPABILITIES,
  knownCapability,
  capabilitiesForRole,
  evaluateCapabilities,
  assertCapabilities
};
