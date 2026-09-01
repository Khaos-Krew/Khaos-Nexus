'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkIdentityStore } = require('../src/sentinel/ark-identity-store.cjs');
const { chatIdentity, parseArkChatLines, resolveChatIdentity, resolveGuildRankConfig, highestConfiguredRankForMember, ArkAccountLinkService } = require('../src/sentinel/ark-account-linking.cjs');

test('ARK chat parser extracts verification codes without trusting an unverified player name as an EOS id', () => {
  const messages = parseArkChatLines('[12:00] Survivor: !link ABCD2345\nnoise\nOther (0002abc123): !link WXYZ6789');
  assert.deepEqual(messages.map((item) => [item.playerName, item.eosId, item.code]), [
    ['Survivor', '', 'ABCD2345'],
    ['Other', '0002abc123', 'WXYZ6789']
  ]);
  assert.equal(resolveChatIdentity(messages[0], [{ name: 'Survivor', eosId: '0002survivor' }]).player.eosId, '0002survivor');
  assert.equal(resolveChatIdentity(messages[0], [{ name: 'Survivor', eosId: 'one_12345' }, { name: 'survivor', eosId: 'two_12345' }]).reason, 'ambiguous-player-name');
});

test('ARK chat parser honors the configured player-facing link command', () => {
  assert.equal(parseArkChatLines('Survivor: !verify ABCD2345', '!verify')[0].code, 'ABCD2345');
  assert.deepEqual(parseArkChatLines('Survivor: !link ABCD2345', '!verify'), []);
});

test('ASA GetChat account and quoted character names resolve safely against ListPlayers', () => {
  const message = parseArkChatLines('PlatformAccount ("Khaos_Kirito"): !link ABCD2345')[0];
  assert.deepEqual([message.playerName, message.characterName, message.eosId], ['PlatformAccount', 'Khaos_Kirito', '']);
  const resolved = resolveChatIdentity(message, [{ name: 'Khaos_Kirito', eosId: '0002kirito123' }]);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.player.eosId, '0002kirito123');
});

test('ASA chat identity with platform name and tribe tag resolves against ListPlayers', () => {
  const message = parseArkChatLines('Khaos_Kirito (Khaos Kirito) [Khaos Nexus]: !link ABCD2345')[0];
  assert.deepEqual(message, {
    line: 'Khaos_Kirito (Khaos Kirito) [Khaos Nexus]: !link ABCD2345',
    playerName: 'Khaos_Kirito',
    characterName: 'Khaos Kirito',
    eosId: '',
    code: 'ABCD2345'
  });
  assert.deepEqual(resolveChatIdentity(message, [
    { name: 'Khaos_Kirito', eosId: '0002a40e51924102ac4ca03aaa9a237e' }
  ]), {
    ok: true,
    player: { name: 'Khaos_Kirito', eosId: '0002a40e51924102ac4ca03aaa9a237e' }
  });
});

test('ASA ShooterGame log prefixes do not become part of the player identity', () => {
  assert.deepEqual(chatIdentity('2026.08.31_12.34.56: LogServer: PlatformAccount ("Survivor")'), {
    playerName: 'PlatformAccount', characterName: 'Survivor', eosId: ''
  });
  assert.deepEqual(chatIdentity('Global Chat: Survivor'), { playerName: 'Survivor', characterName: '', eosId: '' });
});

test('multiple online identities matching account or character names fail closed', () => {
  const message = parseArkChatLines('SharedName ("Survivor"): !link ABCD2345')[0];
  const resolved = resolveChatIdentity(message, [
    { name: 'SharedName', eosId: '0002account123' },
    { name: 'Survivor', eosId: '0002character123' }
  ]);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'ambiguous-player-name');
});

test('chat consumption verifies only an online player and suppresses replayed chat history', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-link-service-'));
  const store = new ArkIdentityStore({ root, secret: 'test-secret-with-at-least-thirty-two-characters' });
  const service = new ArkAccountLinkService({ store });
  const challenge = store.issueChallenge('123456789012345678');
  const chat = `Survivor: !link ${challenge.code}`;
  const first = service.consumeChat(chat, { players: [{ name: 'Survivor', eosId: '0002survivor' }], mapId: 'gen1' });
  assert.equal(first[0].ok, true);
  assert.deepEqual(service.consumeChat(chat, { players: [{ name: 'Survivor', eosId: '0002survivor' }], mapId: 'gen1' }), []);
});

test('rank resolution includes all six Nexus ranks and preserves legacy Origin Founder as highest', () => {
  const config = { discord: { rankRoles: {
    'shadow-recruit': '10001', 'cipher-runner': '10002', 'nexus-raider': '10003',
    'khaos-warden': '10004', 'blackout-legend': '10005', 'origin-founder': '10006'
  } } };
  const member = { roles: { cache: new Map([['10002', {}], ['10006', {}]]) } };
  assert.equal(highestConfiguredRankForMember(member, config).id, 'origin-founder');
});

test('rank resolution safely falls back to official role names only when no role id is configured', () => {
  const named = { roles: { cache: new Map([['role-a', { id: 'role-a', name: '🔻 Cipher Runner' }], ['role-b', { id: 'role-b', name: 'Nexus Raider' }]]) } };
  assert.equal(highestConfiguredRankForMember(named, { discord: { rankRoles: {} } }).id, 'nexus-raider');
  assert.equal(highestConfiguredRankForMember(named, { discord: { rankRoles: { 'nexus-raider': 'different-id' } } }).id, 'cipher-runner');
});

test('guild rank resolution recovers stale saved ids from unique canonical Discord roles', () => {
  const roles = new Map([
    ['10001', { id: '10001', name: '🌑 Shadow Recruit' }],
    ['10005', { id: '10005', name: 'Blackout Legend' }]
  ]);
  const config = resolveGuildRankConfig({ discord: { rankRoles: { 'blackout-legend': 'stale-role-id' } } }, roles);
  const member = { roles: { cache: new Map([['10001', roles.get('10001')], ['10005', roles.get('10005')]]) } };
  assert.equal(config.discord.rankRoles['blackout-legend'], '10005');
  assert.equal(highestConfiguredRankForMember(member, config).id, 'blackout-legend');
});

test('guild rank resolution fails closed when canonical role names are ambiguous', () => {
  const roles = new Map([
    ['10005', { id: '10005', name: 'Blackout Legend' }],
    ['20005', { id: '20005', name: '⚡ Blackout Legend' }]
  ]);
  const config = resolveGuildRankConfig({ discord: { rankRoles: {} } }, roles);
  const member = { roles: { cache: new Map([['10005', roles.get('10005')]]) } };
  assert.equal(highestConfiguredRankForMember(member, config).id, 'shadow-recruit');
});
