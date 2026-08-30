'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  DEFAULT_RANK_GROUPS, rankGroupsFromEnv, parseListGroups, parsePlayerGroups, effectiveRankConfig,
  ArkRankSyncJournal, ArkPermissionRankSync
} = require('../src/sentinel/ark-permission-rank-sync.cjs');

function fakeRcon(initialGroups = [], playerGroups = []) {
  const groups = new Set(initialGroups);
  const players = new Map([['0002player123', new Set(playerGroups)]]);
  const commands = [];
  return {
    groups, players, commands,
    async execute(command) {
      commands.push(command);
      const [name, arg1, arg2] = command.split(' ');
      if (name === 'Permissions.ListGroups') return [...groups].map((group, index) => `${index + 1}) ${group} - `).join('\n');
      if (name === 'Permissions.AddGroup') { groups.add(arg1); return 'Successfully added group'; }
      if (name === 'Permissions.PlayerGroups') return [...(players.get(arg1) || [])].join(', ');
      if (name === 'Permissions.Add') { const current = players.get(arg1) || new Set(); current.add(arg2); players.set(arg1, current); return 'Successfully added player.'; }
      if (name === 'Permissions.Remove') { players.get(arg1)?.delete(arg2); return 'Successfully removed player.'; }
      throw new Error(`Unexpected command: ${command}`);
    }
  };
}

function service(rcon, provisionGroups = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-rank-sync-'));
  return new ArkPermissionRankSync({ rcon, provisionGroups, journal: new ArkRankSyncJournal({ root }) });
}

test('rank group mapping is complete, unique, and rejects unsafe group names', () => {
  assert.equal(Object.keys(rankGroupsFromEnv()).length, 6);
  assert.throws(() => rankGroupsFromEnv('{'), /valid JSON/);
  assert.throws(() => rankGroupsFromEnv(JSON.stringify({ 'cipher-runner': 'Admins,Premiums' })), /Invalid ARK Permissions group/);
  assert.throws(() => rankGroupsFromEnv(JSON.stringify({ 'cipher-runner': DEFAULT_RANK_GROUPS['shadow-recruit'] })), /unique/);
});

test('official Permissions list and player response formats are parsed', () => {
  assert.deepEqual([...parseListGroups('1) Default - \n2) NexusRaider - ArkShop.VIP; ')], ['Default', 'NexusRaider']);
  assert.deepEqual([...parsePlayerGroups('Default, NexusRaider\nNexusTimed - Ends in 2 Hrs')], ['Default', 'NexusRaider', 'NexusTimed']);
});

test('saved Sentinel rank role mappings override static defaults', () => {
  const config = effectiveRankConfig({ discord: { rankRoles: { 'cipher-runner': 'old', 'khaos-warden': 'static' } } }, { rankRoles: { 'cipher-runner': 'saved', 'nexus-raider': 'raider', 'khaos-warden': '' } });
  assert.deepEqual(config.discord.rankRoles, { 'cipher-runner': 'saved', 'khaos-warden': 'static', 'nexus-raider': 'raider' });
});

test('rank sync adds desired group first, removes only stale Nexus groups, and verifies readback', async () => {
  const rcon = fakeRcon(Object.values(DEFAULT_RANK_GROUPS), ['Default', 'Admins', DEFAULT_RANK_GROUPS['cipher-runner']]);
  const result = await service(rcon).reconcile({ eosId: '0002player123', rankId: 'nexus-raider', discordUserId: '123456789012345678' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.added, [DEFAULT_RANK_GROUPS['nexus-raider']]);
  assert.deepEqual(result.removed, [DEFAULT_RANK_GROUPS['cipher-runner']]);
  assert.equal(rcon.players.get('0002player123').has('Default'), true);
  assert.equal(rcon.players.get('0002player123').has('Admins'), true);
  assert.ok(rcon.commands.indexOf(`Permissions.Add 0002player123 ${DEFAULT_RANK_GROUPS['nexus-raider']}`) < rcon.commands.indexOf(`Permissions.Remove 0002player123 ${DEFAULT_RANK_GROUPS['cipher-runner']}`));
});

test('missing managed groups fail closed unless explicit provisioning is enabled', async () => {
  const blocked = fakeRcon(['Default']);
  assert.equal((await service(blocked).ensureGroups()).reason, 'managed-groups-missing');
  assert.equal(blocked.commands.some((command) => command.startsWith('Permissions.AddGroup')), false);
  const allowed = fakeRcon(['Default']);
  const result = await service(allowed, true).ensureGroups();
  assert.equal(result.ok, true);
  assert.equal(result.created.length, 6);
});

test('unlink revokes all managed Nexus ranks without touching unrelated groups', async () => {
  const rcon = fakeRcon(Object.values(DEFAULT_RANK_GROUPS), ['Default', 'Admins', DEFAULT_RANK_GROUPS['origin-founder']]);
  const result = await service(rcon).revoke({ eosId: '0002player123', discordUserId: '123456789012345678' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, [DEFAULT_RANK_GROUPS['origin-founder']]);
  assert.deepEqual([...rcon.players.get('0002player123')], ['Default', 'Admins']);
});
