'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  FUNCTIONAL_ROLE,
  COMMAND_POLICY,
  configuredRoleIds,
  principalForInteraction,
  functionalRoleForInteraction,
  requiredRoleForCommand,
  requiredFunctionalRoleForCommand,
  permissionDecision,
  permissionDeniedMessage,
  adapterRoleForInteraction
} = require('../bot/sentinel-permissions.cjs');

const OWNER_ID = '111111111111111111';
const STAFF_ROLE_IDS = Object.freeze({
  OWNER: '900000000000000001',
  COMMUNITY_MANAGER: '900000000000000002',
  ADMIN: '900000000000000003',
  MODERATOR: '900000000000000004'
});

function interaction({ userId = '222222222222222222', administrator = false, roleIds = [] } = {}) {
  return {
    user: { id: userId },
    member: {
      roles: {
        cache: new Map(roleIds.map((id) => [id, { id }]))
      }
    },
    memberPermissions: {
      has(permission) {
        return administrator && permission === PermissionFlagsBits.Administrator;
      }
    }
  };
}

test('configured owner outranks Discord administrator and maps to functional and adapter owner', () => {
  const actor = interaction({ userId: OWNER_ID, administrator: true, roleIds: [STAFF_ROLE_IDS.MODERATOR] });
  assert.equal(functionalRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), FUNCTIONAL_ROLE.OWNER);
  assert.equal(principalForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'owner');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'owner');
});

test('Nexus staff role IDs map to functional roles without relying on display names', () => {
  const cases = [
    [STAFF_ROLE_IDS.OWNER, FUNCTIONAL_ROLE.OWNER, 'administrator', 'operator'],
    [STAFF_ROLE_IDS.COMMUNITY_MANAGER, FUNCTIONAL_ROLE.COMMUNITY_MANAGER, 'administrator', 'operator'],
    [STAFF_ROLE_IDS.ADMIN, FUNCTIONAL_ROLE.ADMIN, 'administrator', 'operator'],
    [STAFF_ROLE_IDS.MODERATOR, FUNCTIONAL_ROLE.MODERATOR, 'member', 'viewer']
  ];

  for (const [roleId, functionalRole, legacyPrincipal, adapterRole] of cases) {
    const actor = interaction({ roleIds: [roleId] });
    assert.equal(functionalRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), functionalRole, roleId);
    assert.equal(principalForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), legacyPrincipal, roleId);
    assert.equal(adapterRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), adapterRole, roleId);
  }
});

test('staff role bindings accept canonical and compatibility keys without duplicates', () => {
  const bindings = {
    ADMIN: ['300', '301'],
    admin: '301',
    administrator: '302'
  };
  assert.deepEqual(configuredRoleIds(bindings, FUNCTIONAL_ROLE.ADMIN), ['300', '301', '302']);
});

test('higher Nexus staff roles outrank lower bindings when a member has several roles', () => {
  const actor = interaction({
    roleIds: [STAFF_ROLE_IDS.MODERATOR, STAFF_ROLE_IDS.ADMIN, STAFF_ROLE_IDS.COMMUNITY_MANAGER]
  });
  assert.equal(
    functionalRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS),
    FUNCTIONAL_ROLE.COMMUNITY_MANAGER
  );
});

test('Discord administrator remains an ADMIN migration fallback and maps to operator', () => {
  const actor = interaction({ administrator: true });
  assert.equal(functionalRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), FUNCTIONAL_ROLE.ADMIN);
  assert.equal(principalForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'administrator');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'operator');
});

test('regular member maps to functional MEMBER and adapter viewer', () => {
  const actor = interaction();
  assert.equal(functionalRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), FUNCTIONAL_ROLE.MEMBER);
  assert.equal(principalForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'member');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID, STAFF_ROLE_IDS), 'viewer');
});

test('read-only server commands remain available to members', () => {
  const actor = interaction();
  for (const commandName of ['status', 'players', 'settings', 'metrics', 'snapshot', 'listservers']) {
    const decision = permissionDecision({
      interaction: actor,
      commandName,
      ownerUserId: OWNER_ID,
      staffRoleIds: STAFF_ROLE_IDS
    });
    assert.equal(decision.allowed, true, commandName);
    assert.equal(decision.requiredRole, 'member', commandName);
    assert.equal(decision.requiredFunctionalRole, FUNCTIONAL_ROLE.MEMBER, commandName);
  }
});

test('operator-safe commands allow Nexus Prime/Architect/Command and Discord administrator but deny Warden/member', () => {
  const allowedActors = [
    interaction({ roleIds: [STAFF_ROLE_IDS.OWNER] }),
    interaction({ roleIds: [STAFF_ROLE_IDS.ADMIN] }),
    interaction({ roleIds: [STAFF_ROLE_IDS.COMMUNITY_MANAGER] }),
    interaction({ administrator: true })
  ];
  const deniedActors = [
    interaction({ roleIds: [STAFF_ROLE_IDS.MODERATOR] }),
    interaction()
  ];

  for (const commandName of ['saveworld', 'broadcast', 'kick', 'managerrestart']) {
    for (const actor of allowedActors) {
      assert.equal(permissionDecision({
        interaction: actor,
        commandName,
        ownerUserId: OWNER_ID,
        staffRoleIds: STAFF_ROLE_IDS
      }).allowed, true, commandName);
    }
    for (const actor of deniedActors) {
      assert.equal(permissionDecision({
        interaction: actor,
        commandName,
        ownerUserId: OWNER_ID,
        staffRoleIds: STAFF_ROLE_IDS
      }).allowed, false, commandName);
    }
  }
});

test('destructive capabilities require configured owner identity even when Nexus Prime role is present', () => {
  const ownerAccount = interaction({ userId: OWNER_ID });
  const nexusPrime = interaction({ roleIds: [STAFF_ROLE_IDS.OWNER] });
  const architect = interaction({ roleIds: [STAFF_ROLE_IDS.COMMUNITY_MANAGER] });
  const discordAdmin = interaction({ administrator: true });

  for (const commandName of ['ban', 'unban', 'shutdown', 'forcestop', 'rcon']) {
    assert.equal(requiredRoleForCommand(commandName), 'owner', commandName);
    assert.equal(requiredFunctionalRoleForCommand(commandName), FUNCTIONAL_ROLE.OWNER, commandName);
    assert.equal(permissionDecision({
      interaction: ownerAccount,
      commandName,
      ownerUserId: OWNER_ID,
      staffRoleIds: STAFF_ROLE_IDS
    }).allowed, true, commandName);

    for (const actor of [nexusPrime, architect, discordAdmin]) {
      const denied = permissionDecision({
        interaction: actor,
        commandName,
        ownerUserId: OWNER_ID,
        staffRoleIds: STAFF_ROLE_IDS
      });
      assert.equal(denied.allowed, false, commandName);
      assert.equal(permissionDeniedMessage(denied), 'This command is restricted to the configured Khaos Nexus Owner account.');
    }
  }
});

test('unknown commands fail closed and decisions never expose actor IDs', () => {
  const decision = permissionDecision({
    interaction: interaction({ userId: OWNER_ID }),
    commandName: 'definitely-not-a-command',
    ownerUserId: OWNER_ID,
    staffRoleIds: STAFF_ROLE_IDS
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'UNKNOWN_COMMAND');
  assert.equal(decision.requiredRole, null);
  assert.equal(decision.requiredFunctionalRole, null);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, 'userId'), false);
  assert.equal(JSON.stringify(decision).includes(OWNER_ID), false);
});

test('every currently registered core command has an explicit permission declaration', () => {
  const commands = [
    'ping', 'health', 'status', 'players', 'settings', 'metrics', 'snapshot',
    'saveworld', 'broadcast', 'kick', 'ban', 'unban', 'shutdown', 'forcestop',
    'rcon', 'listservers', 'managerrestart', 'campaign', 'character', 'roll',
    'initiative', 'session', 'quest'
  ];
  assert.deepEqual(commands.filter((command) => !COMMAND_POLICY[command]), []);
});
