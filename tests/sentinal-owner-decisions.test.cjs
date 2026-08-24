'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLATFORM_ROLE_MIGRATIONS,
  migrateDuplicateRole
} = require('../src/sentinel/owner-role-decisions.cjs');
const {
  OWNER_RETIRED_LEGACY_BUTTON_IDS,
  messageButtons
} = require('../src/sentinel/self-role-model.cjs');
const {
  isObsoleteGrayApplicationSwatch,
  cleanupObsoleteApplicationSwatches
} = require('../src/sentinel/color-swatch-emojis.cjs');
const { ensurePinnedPanel } = require('../src/sentinel/persistent-panel-extension.cjs');
const { SelfRoleManager } = require('../src/sentinel/aliased-self-role-manager.cjs');

function role(id, name, extras = {}) {
  return { id, name, editable:true, managed:false, members:new Map(), ...extras };
}

test('owner-approved platform role set keeps the original higher role IDs', () => {
  assert.deepEqual(PLATFORM_ROLE_MIGRATIONS.map((item) => item.canonicalRoleId), [
    '1492769364477350030',
    '1492769365588709509',
    '1492769365215416341',
    '1492769367396585534'
  ]);
});

test('duplicate platform role migration moves members before deleting the duplicate', async () => {
  const canonical = role('10001', 'PC');
  let deleted = false;
  const duplicate = role('10002', 'PC', { delete:async () => { deleted = true; } });
  const calls = [];
  const member = {
    id:'20001',
    roles:{
      cache:new Map(),
      add:async (value) => { calls.push(`add:${value.id}`); },
      remove:async (value) => { calls.push(`remove:${value.id}`); }
    }
  };
  duplicate.members.set(member.id, member);
  const roles = new Map([[canonical.id, canonical], [duplicate.id, duplicate]]);
  const result = await migrateDuplicateRole({ roles:{ fetch:async () => roles }, members:{ fetch:async () => new Map() } }, {
    label:'PC', canonicalRoleId:canonical.id, duplicateRoleId:duplicate.id
  }, { roles, memberInventoryReady:true, logger:{ warn(){} } });

  assert.deepEqual(calls, ['add:10001', 'remove:10002']);
  assert.equal(result.membersMigrated, 1);
  assert.equal(result.duplicateDeleted, true);
  assert.equal(deleted, true);
});

test('duplicate platform role is preserved if any member migration fails', async () => {
  const canonical = role('10001', 'PC');
  let deleted = false;
  const duplicate = role('10002', 'PC', { delete:async () => { deleted = true; } });
  duplicate.members.set('20001', {
    id:'20001',
    roles:{ cache:new Map(), add:async () => { throw new Error('nope'); }, remove:async () => {} }
  });
  const roles = new Map([[canonical.id, canonical], [duplicate.id, duplicate]]);
  const result = await migrateDuplicateRole({ roles:{ fetch:async () => roles } }, {
    label:'PC', canonicalRoleId:canonical.id, duplicateRoleId:duplicate.id
  }, { roles, memberInventoryReady:true, logger:{ warn(){} } });

  assert.equal(result.duplicateDeleted, false);
  assert.equal(deleted, false);
  assert.match(result.warning, /preserved/i);
});

test('owner-retired generic LFG legacy button is omitted while module-specific controls remain', () => {
  assert.equal(OWNER_RETIRED_LEGACY_BUTTON_IDS.has('rmb:game_type:lfg'), true);
  const buttons = messageButtons({ components:[{ type:1, components:[
    { type:2, label:'LFG', custom_id:'rmb:game_type:lfg' },
    { type:2, label:'Raider', custom_id:'rmb:game_type:raider' }
  ] }] });
  assert.deepEqual(buttons.map((item) => item.label), ['Raider']);
});

test('obsolete nexus_color application emojis are removed without touching hex-keyed swatches', async () => {
  const deleted = [];
  const old = { id:'30001', name:'nexus_color_crimson', delete:async () => { deleted.push('old'); } };
  const current = { id:'30002', name:'nexus_swatch_dc143c_crimson', delete:async () => { deleted.push('current'); } };
  assert.equal(isObsoleteGrayApplicationSwatch(old), true);
  assert.equal(isObsoleteGrayApplicationSwatch(current), false);
  const cleaned = await cleanupObsoleteApplicationSwatches({}, [old, current], { warn(){} });
  assert.equal(cleaned, 1);
  assert.deepEqual(deleted, ['old']);
});

test('canonical module hub is pinned once', async () => {
  let pins = 0;
  const message = { id:'40001', pinned:false, pin:async () => { pins += 1; } };
  assert.equal(await ensurePinnedPanel(message, 'warframe', { warn(){} }), true);
  assert.equal(pins, 1);
  message.pinned = true;
  assert.equal(await ensurePinnedPanel(message, 'warframe', { warn(){} }), false);
  assert.equal(pins, 1);
});

test('migrated legacy self-role message is deleted instead of left as dead UI', async () => {
  let deleted = false;
  const manager = Object.create(SelfRoleManager.prototype);
  manager.client = { user:{ id:'sentinal' } };
  const message = {
    id:'50001',
    author:{ id:'sentinal', bot:true },
    embeds:[{ footer:{ text:'Khaos Nexus • Click again to remove a role' } }],
    components:[],
    delete:async () => { deleted = true; }
  };
  const result = await manager.retireOneLegacyMessage(message, new Set(), ['50001'], []);
  assert.equal(deleted, true);
  assert.equal(result.buttonsRetired, 1);
});
