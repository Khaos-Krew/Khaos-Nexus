'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installManageableRoleFallback } = require('../src/sentinel/role-menu-extension.cjs');

test('protected alias roles are left unchanged and replaced by a manageable access role', async () => {
  const protectedRole = { id: '1', name: 'Nexus D&D', editable: false };
  const createdRole = { id: '2', name: 'Nexus D&D Access', editable: true };
  const writes = [];
  const manager = {
    ensureAccessRole: async () => protectedRole
  };
  const state = {
    setAccessRole(moduleId, value) { writes.push({ moduleId, value }); }
  };
  const guild = {
    id: 'guild-1',
    roles: {
      async fetch() { return new Map([['1', protectedRole]]); },
      async create(input) {
        assert.equal(input.name, 'Nexus D&D Access');
        return createdRole;
      }
    }
  };
  installManageableRoleFallback(manager, state);
  const result = await manager.ensureAccessRole(guild, { moduleId: 'dnd', roleName: 'Nexus D&D Access' });
  assert.equal(result, createdRole);
  assert.equal(writes.at(-1).moduleId, 'dnd');
  assert.equal(writes.at(-1).value.roleId, '2');
});

test('editable access roles are reused without creating a replacement', async () => {
  const editableRole = { id: '3', name: 'ARK', editable: true };
  let created = 0;
  const manager = { ensureAccessRole: async () => editableRole };
  const state = { setAccessRole() { throw new Error('unexpected state rewrite'); } };
  const guild = { roles: { async fetch() { return new Map(); }, async create() { created += 1; } } };
  installManageableRoleFallback(manager, state);
  const result = await manager.ensureAccessRole(guild, { moduleId: 'ark', roleName: 'ARK Access' });
  assert.equal(result, editableRole);
  assert.equal(created, 0);
});
