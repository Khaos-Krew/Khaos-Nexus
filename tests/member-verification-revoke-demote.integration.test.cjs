'use strict';

/**
 * Integration: install/attach path → /o9verify revoke → demoteIdentityToRestricted (WARDEN B1).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Events, PermissionFlagsBits } = require('discord.js');
const { MemberVerificationStore } = require('../src/sentinel/member-verification-store.cjs');
const {
  attachMemberVerificationListeners,
  handleMemberVerificationInteraction,
  installMemberVerificationExtension
} = require('../src/sentinel/member-verification-extension.cjs');

const ACTOR = '111111111111111111';
const TARGET = '222222222222222222';

function tempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'o9-revoke-demote-'));
  return { root, store: new MemberVerificationStore({ root }) };
}

function fakeRevokeInteraction({ replies }) {
  return {
    isChatInputCommand: () => true,
    commandName: 'o9verify',
    memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
    user: { id: ACTOR },
    options: {
      getSubcommand: () => 'revoke',
      getUser: () => ({ id: TARGET }),
      getString: () => 'abuse'
    },
    async deferReply() { replies.push('defer'); },
    async editReply(payload) { replies.push(payload); },
    async reply(payload) { replies.push(payload); }
  };
}

test('handleMemberVerificationInteraction revoke calls economyClient.demoteIdentityToRestricted', async () => {
  const { store } = tempStore();
  store.ensurePending(TARGET, { actorId: ACTOR });
  assert.equal(store.grant(TARGET, { actorId: ACTOR, reason: 'ok' }).ok, true);

  const demoteCalls = [];
  const economyClient = {
    configured: () => true,
    async demoteIdentityToRestricted(discordUserId) {
      demoteCalls.push(String(discordUserId));
      return { ok: true, result: { status: 'restricted', priorStatus: 'verified' } };
    }
  };
  const replies = [];
  const handled = await handleMemberVerificationInteraction(
    fakeRevokeInteraction({ replies }),
    { storeFactory: () => store, economyClient }
  );
  assert.equal(handled, true);
  assert.deepEqual(demoteCalls, [TARGET]);
  assert.equal(store.get(TARGET).state, 'rejected');
  assert.ok(String(replies.at(-1)?.content || '').includes('restricted'));
});

test('attachMemberVerificationListeners (installMemberVerificationExtension path) revoke calls demoteIdentityToRestricted', async () => {
  const { store } = tempStore();
  store.ensurePending(TARGET, { actorId: ACTOR });
  assert.equal(store.grant(TARGET, { actorId: ACTOR, reason: 'ok' }).ok, true);

  const demoteCalls = [];
  const economyClient = {
    configured: () => true,
    async demoteIdentityToRestricted(discordUserId) {
      demoteCalls.push(String(discordUserId));
      return { ok: true, result: { status: 'restricted' } };
    }
  };

  const client = new EventEmitter();
  attachMemberVerificationListeners(client, {
    economyClient,
    storeFactory: () => store,
    registerOnReady: false
  });

  const replies = [];
  client.emit(Events.InteractionCreate, fakeRevokeInteraction({ replies }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(demoteCalls, [TARGET]);
  assert.equal(store.get(TARGET).state, 'rejected');
});

test('installMemberVerificationExtension is idempotent and wires login hook', () => {
  const { Client } = require('discord.js');
  const INSTALLED = Symbol.for('khaos.nexus.member.verification.extension');
  // Fresh install on a disposable symbol-gated prototype flag
  delete Client.prototype[INSTALLED];
  const before = Client.prototype.login;
  installMemberVerificationExtension({ economyClient: { configured: () => false, demoteIdentityToRestricted: async () => ({}) } });
  assert.equal(Client.prototype[INSTALLED], true);
  assert.notEqual(Client.prototype.login, before);
  installMemberVerificationExtension({ economyClient: { configured: () => false } });
  // second call no-ops (still installed)
  assert.equal(Client.prototype[INSTALLED], true);
});
