'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  COMMAND_POLICY,
  principalForInteraction,
  requiredRoleForCommand,
  permissionDecision,
  permissionDeniedMessage,
  adapterRoleForInteraction
} = require('../bot/sentinel-permissions.cjs');

const OWNER_ID = '111111111111111111';

function interaction({ userId = '222222222222222222', administrator = false } = {}) {
  return {
    user: { id: userId },
    memberPermissions: {
      has(permission) {
        return administrator && permission === PermissionFlagsBits.Administrator;
      }
    }
  };
}

test('configured owner outranks Discord administrator and maps to adapter owner', () => {
  const actor = interaction({ userId: OWNER_ID, administrator: false });
  assert.equal(principalForInteraction(actor, OWNER_ID), 'owner');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID), 'owner');
});

test('Discord administrator maps to operator rather than adapter owner', () => {
  const actor = interaction({ administrator: true });
  assert.equal(principalForInteraction(actor, OWNER_ID), 'administrator');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID), 'operator');
});

test('regular member maps to viewer', () => {
  const actor = interaction();
  assert.equal(principalForInteraction(actor, OWNER_ID), 'member');
  assert.equal(adapterRoleForInteraction(actor, OWNER_ID), 'viewer');
});

test('read-only server commands remain available to members', () => {
  const actor = interaction();
  for (const commandName of ['status', 'players', 'settings', 'metrics', 'snapshot', 'listservers']) {
    const decision = permissionDecision({ interaction: actor, commandName, ownerUserId: OWNER_ID });
    assert.equal(decision.allowed, true, commandName);
    assert.equal(decision.requiredRole, 'member', commandName);
  }
});

test('operator-safe server commands allow Discord administrators but deny regular members', () => {
  const admin = interaction({ administrator: true });
  const member = interaction();
  for (const commandName of ['saveworld', 'broadcast', 'kick', 'managerrestart']) {
    assert.equal(permissionDecision({ interaction: admin, commandName, ownerUserId: OWNER_ID }).allowed, true, commandName);
    assert.equal(permissionDecision({ interaction: member, commandName, ownerUserId: OWNER_ID }).allowed, false, commandName);
  }
});

test('destructive owner capabilities stay owner-only', () => {
  const owner = interaction({ userId: OWNER_ID });
  const admin = interaction({ administrator: true });
  for (const commandName of ['ban', 'unban', 'shutdown', 'forcestop', 'rcon']) {
    assert.equal(requiredRoleForCommand(commandName), 'owner', commandName);
    assert.equal(permissionDecision({ interaction: owner, commandName, ownerUserId: OWNER_ID }).allowed, true, commandName);
    const denied = permissionDecision({ interaction: admin, commandName, ownerUserId: OWNER_ID });
    assert.equal(denied.allowed, false, commandName);
    assert.equal(permissionDeniedMessage(denied), 'This command is restricted to the configured Khaos Nexus Owner account.');
  }
});

test('unknown commands fail closed and decisions never expose actor IDs', () => {
  const decision = permissionDecision({
    interaction: interaction({ userId: OWNER_ID }),
    commandName: 'definitely-not-a-command',
    ownerUserId: OWNER_ID
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'UNKNOWN_COMMAND');
  assert.equal(decision.requiredRole, null);
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
