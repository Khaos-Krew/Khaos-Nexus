'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { OWNER_ROLE_ID, CM_ROLE_ID, COMMUNITY_MANAGER_ROLE_ID } = require('../src/shared/protected-role-ids.cjs');
const { blockedNamedRole } = require('../src/economy-worker/ark-staff-auth.cjs');
const { isCoinShopAdmin } = require('../src/economy-worker/coin-shop-staff.cjs');
const { isArkStaff } = require('../src/sentinel/ark-np-shop-ui.cjs');
const { protectedReportOverwriteIds } = require('../src/sentinel/safety-report-access.cjs');

const USER = '424242424242424242';
const GUILD = '444444444444444444';
const OTHER_USER = '999999999999999999';
const NAMED_OWNER = '777777777777777771';
const RETIRED_OWNER_ROLE_ID = '1616602943670059102';

function memberWith(roleId, name) {
  return {
    user: { id: USER },
    guild: { id: GUILD, ownerId: OTHER_USER },
    member: {
      id: USER,
      guild: { id: GUILD },
      roles: {
        cache: new Map([[roleId, { id: roleId, name, managed: false, permissions: '0' }]])
      }
    },
    memberPermissions: { has: () => false }
  };
}

test('a member holding only the Server Owner role is recognized by id', () => {
  assert.equal(OWNER_ROLE_ID, '1516602930457739354');
  assert.equal(CM_ROLE_ID, '1521219329360920767');
  assert.equal(COMMUNITY_MANAGER_ROLE_ID, CM_ROLE_ID);
  assert.notEqual(OWNER_ROLE_ID, RETIRED_OWNER_ROLE_ID);

  const owner = memberWith(OWNER_ROLE_ID, 'Khaos Lead');
  const noOwners = { discord: { ownerUserIds: [] } };
  assert.equal(isCoinShopAdmin(owner, {}), true);
  assert.equal(isArkStaff(owner, noOwners, {}), true);
  assert.equal(blockedNamedRole({ id: OWNER_ROLE_ID, name: 'Khaos Lead' }), true);
  const protectedIds = protectedReportOverwriteIds(
    { id: GUILD, ownerId: OTHER_USER },
    [
      { id: OWNER_ROLE_ID, name: 'Khaos Lead' },
      { id: NAMED_OWNER, name: 'Server Owner' }
    ],
    {}
  );
  assert.equal(protectedIds.includes(OWNER_ROLE_ID), true);
  assert.equal(protectedIds.includes(CM_ROLE_ID), true);
  assert.equal(protectedIds.includes(NAMED_OWNER), false);

  const namedOnly = memberWith(NAMED_OWNER, 'Server Owner');
  assert.equal(isCoinShopAdmin(namedOnly, {}), false);
  assert.equal(blockedNamedRole({ id: NAMED_OWNER, name: 'Server Owner' }), false);
  assert.equal(isArkStaff(namedOnly, noOwners, {}), false);

  const checked = [
    'src/shared/protected-role-ids.cjs',
    'src/economy-worker/ark-staff-auth.cjs',
    'src/economy-worker/coin-shop-staff.cjs',
    'src/sentinel/safety-report-access.cjs',
    'src/sentinel/staff-workspace.cjs'
  ];
  for (const rel of checked) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.equal(text.includes(RETIRED_OWNER_ROLE_ID), false, rel);
  }
  for (const rel of checked.slice(1)) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.match(text, /protected-role-ids\.cjs/, rel);
  }
});
