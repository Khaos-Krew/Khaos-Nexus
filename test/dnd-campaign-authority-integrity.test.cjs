'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMemberAuthority } = require('../bot/dnd-runtime-policy.cjs');
const { requireCampaignRole } = require('../shared/dnd-discord.cjs');

const USER_ID = '100000000000000010';
const OTHER_USER_ID = '100000000000000011';

function runtimeWith(members) {
  return {
    getBootstrap: () => ({
      config: {
        dnd: { members }
      }
    })
  };
}

function campaignUseInteraction(campaignId = 'campaign-1', userId = USER_ID) {
  return {
    user: { id: userId },
    isChatInputCommand: () => true,
    commandName: 'campaign',
    options: {
      getSubcommand: () => 'use',
      getString: (name) => name === 'campaign' ? campaignId : null
    }
  };
}

function member({ id, campaignId = 'campaign-1', discordUserId = USER_ID, role = 'player', active = true }) {
  return { id, campaignId, discordUserId, role, active };
}

test('canonical campaign management roles remain admin, dm, and assistant_dm only', () => {
  for (const role of ['admin', 'dm', 'assistant_dm']) {
    const state = { members: [member({ id: `member-${role}`, role })] };
    assert.equal(requireCampaignRole(state, 'campaign-1', USER_ID, { manage: true }), role);
  }
  for (const role of ['player', 'viewer']) {
    const state = { members: [member({ id: `member-${role}`, role })] };
    assert.throws(
      () => requireCampaignRole(state, 'campaign-1', USER_ID, { manage: true }),
      (error) => error.code === 'INSUFFICIENT_CAMPAIGN_ROLE'
    );
  }
});

test('single active campaign membership passes the authority preflight', () => {
  const runtime = runtimeWith([member({ id: 'member-1', role: 'dm' })]);
  assert.doesNotThrow(() => validateMemberAuthority(campaignUseInteraction(), runtime));
});

test('inactive duplicate membership does not create authority ambiguity', () => {
  const runtime = runtimeWith([
    member({ id: 'member-1', role: 'dm' }),
    member({ id: 'member-2', role: 'player', active: false })
  ]);
  assert.doesNotThrow(() => validateMemberAuthority(campaignUseInteraction(), runtime));
});

test('duplicate active same-role memberships fail closed', () => {
  const runtime = runtimeWith([
    member({ id: 'member-1', role: 'dm' }),
    member({ id: 'member-2', role: 'dm' })
  ]);
  assert.throws(
    () => validateMemberAuthority(campaignUseInteraction(), runtime),
    (error) => error.code === 'AMBIGUOUS_CAMPAIGN_MEMBERSHIP' && /duplicated/i.test(error.message)
  );
});

test('conflicting active member roles fail closed regardless of persisted order', () => {
  for (const roles of [['player', 'dm'], ['dm', 'player']]) {
    const runtime = runtimeWith(roles.map((role, index) => member({ id: `member-${index}`, role })));
    assert.throws(
      () => validateMemberAuthority(campaignUseInteraction(), runtime),
      (error) => error.code === 'AMBIGUOUS_CAMPAIGN_MEMBERSHIP' && /conflicting/i.test(error.message)
    );
  }
});

test('memberships from another campaign or user do not contaminate selected campaign authority', () => {
  const runtime = runtimeWith([
    member({ id: 'member-1', role: 'assistant_dm' }),
    member({ id: 'member-2', campaignId: 'campaign-2', role: 'admin' }),
    member({ id: 'member-3', discordUserId: OTHER_USER_ID, role: 'dm' })
  ]);
  assert.doesNotThrow(() => validateMemberAuthority(campaignUseInteraction(), runtime));
});
