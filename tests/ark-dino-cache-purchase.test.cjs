'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DinoCacheJournal } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {
  parsePointsResponse, buildDinoDepotCommand, assertDeliverableRoll, ArkDinoCachePurchaseService
} = require('../src/sentinel/ark-dino-cache-purchase.cjs');

function sequence(values) { let index = 0; return () => values[index++ % values.length]; }
function tempJournal() { return new DinoCacheJournal(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cache-purchase-'))); }

class FakeRcon {
  constructor({ balance = 5000, failDelivery = false, failRefund = false } = {}) {
    this.balance = balance;
    this.failDelivery = failDelivery;
    this.failRefund = failRefund;
    this.commands = [];
  }
  async execute(command) {
    this.commands.push(command);
    if (command.startsWith('GetPlayerPoints ')) return `Player points: ${this.balance}`;
    if (command.startsWith('ChangePoints ')) {
      const amount = Number(command.split(/\s+/).at(-1));
      if (amount > 0 && this.failRefund) throw new Error('refund transport failed');
      this.balance += amount;
      return `Points changed: ${this.balance}`;
    }
    if (command.startsWith('ScriptCommand SpawnDinoInBall ')) {
      if (this.failDelivery) throw new Error('delivery failed');
      return 'ok';
    }
    throw new Error(`Unexpected command: ${command}`);
  }
}

test('points response parser accepts ArkShop text but rejects unreadable balances', () => {
  assert.equal(parsePointsResponse('Player points: 1234'), 1234);
  assert.equal(parsePointsResponse('1234'), 1234);
  assert.throws(() => parsePointsResponse('no balance'), /readable/);
});

test('Dino Depot command uses documented targeted exact-level arguments and stays bounded', () => {
  const command = buildDinoDepotCommand({ eosId: '0002abc12345', blueprint: '/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP', level: 275 });
  assert.equal(command, 'ScriptCommand SpawnDinoInBall -p=0002abc12345 -t=/Game/PrimalEarth/Dinos/Para/Para_Character_BP.Para_Character_BP -l=275 -i=1 -a=1');
  assert.ok(command.length <= 290);
  assert.match(buildDinoDepotCommand({ eosId: '0002abc12345', blueprint: '/SDinoVariants/S-Rex/S-Rex_Character_BP.S-Rex_Character_BP', level: 275 }), /-t=\/SDinoVariants\/S-Rex\//);
});

test('only mapped X/S and normal outcomes pass the pre-charge delivery gate', () => {
  assert.throws(() => assertDeliverableRoll({ variant: 'x', blueprint: '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP', shiny: false }), /verified X blueprint/);
  assert.throws(() => assertDeliverableRoll({ variant: 's', blueprint: '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP', shiny: false }), /verified S blueprint/);
  assert.equal(assertDeliverableRoll({ variant: 'x', blueprint: '/Game/Genesis/Dinos/BiomeVariants/Volcano_Rex/Volcano_Rex_Character_BP.Volcano_Rex_Character_BP', shiny: false }), true);
  assert.equal(assertDeliverableRoll({ variant: 's', blueprint: '/SDinoVariants/S-Rex/S-Rex_Character_BP.S-Rex_Character_BP', shiny: false }), true);
  assert.throws(() => assertDeliverableRoll({ variant: 'normal', shiny: true }), /Shiny/);
  assert.equal(assertDeliverableRoll({ variant: 'normal', shiny: false }), true);
});

test('successful purchase checks balance, charges once, then delivers exact rolled dino', async () => {
  const rcon = new FakeRcon({ balance: 2000 });
  const service = new ArkDinoCachePurchaseService({ rcon, journal: tempJournal(), rng: sequence([0, 0, 0, 0, 0, 0.5]) });
  const result = await service.purchase({ eosId: '0002abc12345', cacheId: 'coastal' });
  assert.equal(result.ok, true);
  assert.equal(rcon.balance, 1200);
  assert.match(rcon.commands[2], /^ScriptCommand SpawnDinoInBall .* -l=200 -i=1 -a=1$/);
  assert.equal(rcon.commands.filter((cmd) => cmd.startsWith('ChangePoints ')).length, 1);
});

test('insufficient points never creates a charge or delivery command', async () => {
  const rcon = new FakeRcon({ balance: 10 });
  const service = new ArkDinoCachePurchaseService({ rcon, journal: tempJournal(), rng: sequence([0, 0, 0, 0, 0, 0.5]) });
  const result = await service.purchase({ eosId: '0002abc12345', cacheId: 'coastal' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-points');
  assert.deepEqual(rcon.commands, ['GetPlayerPoints 0002abc12345']);
});

test('delivery failure refunds exactly the charged cache price and journals refunded state', async () => {
  const rcon = new FakeRcon({ balance: 2000, failDelivery: true });
  const journal = tempJournal();
  const service = new ArkDinoCachePurchaseService({ rcon, journal, rng: sequence([0, 0, 0, 0, 0, 0.5]) });
  await assert.rejects(() => service.purchase({ eosId: '0002abc12345', cacheId: 'coastal' }), /800 points were refunded/);
  assert.equal(rcon.balance, 2000);
  assert.equal(journal.read().transactions.at(-1).state, 'refunded');
});

test('refund transport failure remains refund_pending for operator recovery', async () => {
  const rcon = new FakeRcon({ balance: 2000, failDelivery: true, failRefund: true });
  const journal = tempJournal();
  const service = new ArkDinoCachePurchaseService({ rcon, journal, rng: sequence([0, 0, 0, 0, 0, 0.5]) });
  await assert.rejects(() => service.purchase({ eosId: '0002abc12345', cacheId: 'coastal' }), /refund is still pending/);
  assert.equal(journal.read().transactions.at(-1).state, 'refund_pending');
});
