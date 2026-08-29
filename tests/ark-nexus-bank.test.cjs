'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NexusBankStore, ArkNexusBankService } = require('../src/sentinel/ark-nexus-bank.cjs');

function tempStore() { return new NexusBankStore(fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bank-'))); }

class FakeRcon {
  constructor(balance = 5000) { this.balance = balance; this.commands = []; this.failNextChange = false; }
  async execute(command) {
    this.commands.push(command);
    if (command.startsWith('GetPlayerPoints ')) return `Player points: ${this.balance}`;
    if (command.startsWith('ChangePoints ')) {
      if (this.failNextChange) { this.failNextChange = false; throw new Error('transport failed'); }
      const delta = Number(command.split(/\s+/).at(-1));
      this.balance += delta;
      return `Points changed: ${this.balance}`;
    }
    throw new Error(`Unexpected command: ${command}`);
  }
}

test('deposit atomically moves points from ArkShop into protected bank balance', async () => {
  const rcon = new FakeRcon(5000);
  const store = tempStore();
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.deposit({ eosId: '0002abc12345', amount: 1200 });
  assert.equal(result.ok, true);
  assert.equal(rcon.balance, 3800);
  assert.equal(bank.bankBalance('0002abc12345'), 1200);
  assert.equal(store.read().transactions.at(-1).state, 'completed');
});

test('deposit refuses insufficient active points without mutating either balance', async () => {
  const rcon = new FakeRcon(50);
  const store = tempStore();
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.deposit({ eosId: '0002abc12345', amount: 100 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-active-points');
  assert.equal(rcon.balance, 50);
  assert.equal(bank.bankBalance('0002abc12345'), 0);
  assert.equal(store.read().transactions.length, 0);
});

test('failed ArkShop deposit debit cancels without crediting bank', async () => {
  const rcon = new FakeRcon(5000);
  rcon.failNextChange = true;
  const store = tempStore();
  const bank = new ArkNexusBankService({ rcon, store });
  await assert.rejects(() => bank.deposit({ eosId: '0002abc12345', amount: 1000 }), /transport failed/);
  assert.equal(rcon.balance, 5000);
  assert.equal(bank.bankBalance('0002abc12345'), 0);
  assert.equal(store.read().transactions.at(-1).state, 'cancelled');
});

test('withdrawal reserves bank funds before ArkShop credit and completes exactly once', async () => {
  const rcon = new FakeRcon(1000);
  const store = tempStore();
  const state = store.read();
  state.accounts['0002abc12345'] = { balance: 2000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.write(state);
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.withdraw({ eosId: '0002abc12345', amount: 750 });
  assert.equal(result.ok, true);
  assert.equal(rcon.balance, 1750);
  assert.equal(bank.bankBalance('0002abc12345'), 1250);
  assert.equal(store.read().transactions.at(-1).state, 'completed');
});

test('failed ArkShop withdrawal credit restores reserved bank funds', async () => {
  const rcon = new FakeRcon(1000);
  rcon.failNextChange = true;
  const store = tempStore();
  const state = store.read();
  state.accounts['0002abc12345'] = { balance: 2000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.write(state);
  const bank = new ArkNexusBankService({ rcon, store });
  await assert.rejects(() => bank.withdraw({ eosId: '0002abc12345', amount: 750 }), /transport failed/);
  assert.equal(rcon.balance, 1000);
  assert.equal(bank.bankBalance('0002abc12345'), 2000);
  assert.equal(store.read().transactions.at(-1).state, 'cancelled');
});

test('recovery completes a deposit when ArkShop debit happened before a process interruption', async () => {
  const rcon = new FakeRcon(4000);
  const store = tempStore();
  const tx = store.prepare({ eosId: '0002abc12345', type: 'deposit', amount: 1000, arkBalanceBefore: 5000 });
  store.transition(tx.id, 'prepared', 'debit_pending');
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.recoverTransaction(tx.id);
  assert.equal(result.recovered, true);
  assert.equal(result.state, 'completed');
  assert.equal(bank.bankBalance('0002abc12345'), 1000);
});

test('recovery retries an uncredited withdrawal only when ArkShop balance is still at recorded baseline', async () => {
  const rcon = new FakeRcon(1000);
  const store = tempStore();
  const state = store.read();
  state.accounts['0002abc12345'] = { balance: 2000, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store.write(state);
  const tx = store.prepare({ eosId: '0002abc12345', type: 'withdrawal', amount: 500, arkBalanceBefore: 1000 });
  store.transition(tx.id, 'prepared', 'credit_pending', ({ account }) => { account.balance -= 500; });
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.recoverTransaction(tx.id);
  assert.equal(result.recovered, true);
  assert.equal(result.state, 'completed');
  assert.equal(rcon.balance, 1500);
  assert.equal(bank.bankBalance('0002abc12345'), 1500);
});

test('ambiguous recovery fails closed into manual_review rather than guessing', async () => {
  const rcon = new FakeRcon(4300);
  const store = tempStore();
  const tx = store.prepare({ eosId: '0002abc12345', type: 'deposit', amount: 1000, arkBalanceBefore: 5000 });
  store.transition(tx.id, 'prepared', 'debit_pending');
  const bank = new ArkNexusBankService({ rcon, store });
  const result = await bank.recoverTransaction(tx.id);
  assert.equal(result.recovered, false);
  assert.equal(result.state, 'manual_review');
  assert.equal(bank.bankBalance('0002abc12345'), 0);
});
