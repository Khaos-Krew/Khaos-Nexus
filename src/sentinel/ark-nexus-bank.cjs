'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { cleanEosId, parsePointsResponse } = require('./ark-dino-cache-purchase.cjs');

const STORE_VERSION = 1;
const MAX_TRANSACTIONS = 10000;
const MAX_TRANSFER = 1_000_000;
const TRANSACTION_TYPES = new Set(['deposit', 'withdrawal']);
const TRANSACTION_STATES = new Set(['prepared', 'debit_pending', 'debited', 'credit_pending', 'completed', 'cancelled', 'manual_review']);

function safeAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_TRANSFER) {
    throw new Error(`Nexus Bank amount must be a whole number from 1 to ${MAX_TRANSFER}.`);
  }
  return amount;
}

function cleanError(error) {
  return String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertPersistedState(state) {
  if (!isPlainObject(state)) throw new Error('Nexus Bank persisted state is invalid.');
  if (state.version !== STORE_VERSION) throw new Error('Nexus Bank persisted state version is unsupported.');
  if (!isPlainObject(state.accounts)) throw new Error('Nexus Bank persisted accounts are invalid.');
  if (!Array.isArray(state.transactions)) throw new Error('Nexus Bank persisted transactions are invalid.');

  for (const [eosId, account] of Object.entries(state.accounts)) {
    if (cleanEosId(eosId) !== eosId || !isPlainObject(account)) throw new Error('Nexus Bank persisted account is invalid.');
    if (!Number.isSafeInteger(account.balance) || account.balance < 0) throw new Error('Nexus Bank persisted account balance is invalid.');
  }

  const ids = new Set();
  for (const tx of state.transactions) {
    if (!isPlainObject(tx) || typeof tx.id !== 'string' || !tx.id || ids.has(tx.id)) throw new Error('Nexus Bank persisted transaction is invalid.');
    ids.add(tx.id);
    if (cleanEosId(tx.eosId) !== tx.eosId) throw new Error('Nexus Bank persisted transaction account is invalid.');
    if (!TRANSACTION_TYPES.has(tx.type) || !TRANSACTION_STATES.has(tx.state)) throw new Error('Nexus Bank persisted transaction state is invalid.');
    if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0 || tx.amount > MAX_TRANSFER) throw new Error('Nexus Bank persisted transaction amount is invalid.');
    if (!Number.isSafeInteger(tx.bankBalanceBefore) || tx.bankBalanceBefore < 0) throw new Error('Nexus Bank persisted transaction balance is invalid.');
    if (!Number.isSafeInteger(tx.arkBalanceBefore) || tx.arkBalanceBefore < 0) throw new Error('Nexus Bank persisted transaction balance is invalid.');
  }

  return state;
}

class NexusBankStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-nexus-bank.json');
  }

  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: STORE_VERSION, accounts: {}, transactions: [] };
      throw new Error('Nexus Bank persisted state is unreadable.');
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Nexus Bank persisted state is malformed.');
    }

    assertPersistedState(parsed);
    return {
      version: STORE_VERSION,
      accounts: parsed.accounts,
      transactions: parsed.transactions.slice(-MAX_TRANSACTIONS)
    };
  }

  health() {
    try {
      const state = this.read();
      return {
        ok: true,
        version: STORE_VERSION,
        accountCount: Object.keys(state.accounts).length,
        transactionCount: state.transactions.length
      };
    } catch {
      return { ok: false, version: STORE_VERSION, accountCount: 0, transactionCount: 0 };
    }
  }

  write(state) {
    const candidate = {
      version: STORE_VERSION,
      accounts: state?.accounts,
      transactions: state?.transactions
    };
    assertPersistedState(candidate);
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = {
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
      accounts: candidate.accounts,
      transactions: candidate.transactions.slice(-MAX_TRANSACTIONS)
    };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
    return safe;
  }

  balance(eosId) {
    const player = cleanEosId(eosId);
    const account = this.read().accounts[player];
    return account?.balance || 0;
  }

  prepare({ eosId, type, amount, arkBalanceBefore } = {}) {
    const player = cleanEosId(eosId);
    const value = safeAmount(amount);
    if (!TRANSACTION_TYPES.has(type)) throw new Error('Nexus Bank transaction type is invalid.');
    const state = this.read();
    state.accounts[player] ||= { balance: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const tx = {
      id: crypto.randomUUID(),
      eosId: player,
      type,
      amount: value,
      state: 'prepared',
      arkBalanceBefore: Number(arkBalanceBefore),
      bankBalanceBefore: state.accounts[player].balance,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: ''
    };
    state.transactions.push(tx);
    this.write(state);
    return JSON.parse(JSON.stringify(tx));
  }

  transition(id, expectedState, nextState, mutate = null, error = '') {
    const state = this.read();
    const tx = state.transactions.find((entry) => entry.id === id);
    if (!tx) throw new Error('Unknown Nexus Bank transaction.');
    if (tx.state !== expectedState) throw new Error(`Nexus Bank transaction state changed unexpectedly: expected ${expectedState}, found ${tx.state}.`);
    if (!TRANSACTION_STATES.has(nextState)) throw new Error('Nexus Bank transaction state is invalid.');
    const account = state.accounts[tx.eosId] || { balance: 0, createdAt: new Date().toISOString() };
    if (typeof mutate === 'function') mutate({ tx, account, state });
    if (!Number.isSafeInteger(account.balance) || account.balance < 0) throw new Error('Nexus Bank balance mutation is invalid.');
    account.updatedAt = new Date().toISOString();
    state.accounts[tx.eosId] = account;
    tx.state = nextState;
    tx.updatedAt = new Date().toISOString();
    tx.error = cleanError(error);
    this.write(state);
    return JSON.parse(JSON.stringify(tx));
  }

  listPending() {
    return this.read().transactions.filter((tx) => ['debit_pending', 'debited', 'credit_pending', 'manual_review'].includes(tx.state));
  }
}

class ArkNexusBankService {
  constructor({ prefix = 'ARK_GEN1', rcon, store } = {}) {
    this.prefix = prefix;
    this.store = store || new NexusBankStore();
    this.locks = new Map();
    if (rcon) this.rcon = rcon;
    else {
      const connection = arkServerFromEnv(prefix);
      this.rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
    }
  }

  async withPlayerLock(eosId, fn) {
    const player = cleanEosId(eosId);
    const prior = this.locks.get(player) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    this.locks.set(player, tail);
    await prior;
    try { return await fn(player); }
    finally {
      release();
      if (this.locks.get(player) === tail) this.locks.delete(player);
    }
  }

  async arkBalance(eosId) {
    return parsePointsResponse(await this.rcon.execute(`GetPlayerPoints ${cleanEosId(eosId)}`));
  }

  async changePoints(eosId, delta) {
    const amount = Number(delta);
    if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > MAX_TRANSFER) throw new Error('Nexus Bank ArkShop point delta is invalid.');
    return this.rcon.execute(`ChangePoints ${cleanEosId(eosId)} ${amount}`);
  }

  bankBalance(eosId) {
    return this.store.balance(eosId);
  }

  async deposit({ eosId, amount } = {}) {
    const value = safeAmount(amount);
    return this.withPlayerLock(eosId, async (player) => {
      this.store.read();
      const arkBefore = await this.arkBalance(player);
      if (arkBefore < value) return { ok: false, reason: 'insufficient-active-points', activeBalance: arkBefore, bankBalance: this.store.balance(player) };

      const tx = this.store.prepare({ eosId: player, type: 'deposit', amount: value, arkBalanceBefore: arkBefore });
      this.store.transition(tx.id, 'prepared', 'debit_pending');
      try {
        await this.changePoints(player, -value);
      } catch (error) {
        this.store.transition(tx.id, 'debit_pending', 'cancelled', null, error);
        throw error;
      }
      this.store.transition(tx.id, 'debit_pending', 'debited');
      const completed = this.store.transition(tx.id, 'debited', 'completed', ({ account }) => { account.balance += value; });
      return { ok: true, transactionId: completed.id, deposited: value, activeBalance: arkBefore - value, bankBalance: this.store.balance(player) };
    });
  }

  async withdraw({ eosId, amount } = {}) {
    const value = safeAmount(amount);
    return this.withPlayerLock(eosId, async (player) => {
      const bankBefore = this.store.balance(player);
      if (bankBefore < value) return { ok: false, reason: 'insufficient-bank-balance', bankBalance: bankBefore };
      const arkBefore = await this.arkBalance(player);
      const tx = this.store.prepare({ eosId: player, type: 'withdrawal', amount: value, arkBalanceBefore: arkBefore });

      this.store.transition(tx.id, 'prepared', 'credit_pending', ({ account }) => {
        if (account.balance < value) throw new Error('Nexus Bank balance changed before withdrawal reservation.');
        account.balance -= value;
      });

      try {
        await this.changePoints(player, value);
      } catch (error) {
        this.store.transition(tx.id, 'credit_pending', 'cancelled', ({ account }) => { account.balance += value; }, error);
        throw error;
      }

      const completed = this.store.transition(tx.id, 'credit_pending', 'completed');
      return { ok: true, transactionId: completed.id, withdrawn: value, activeBalance: arkBefore + value, bankBalance: this.store.balance(player) };
    });
  }

  async recoverTransaction(transactionId) {
    const state = this.store.read();
    const tx = state.transactions.find((entry) => entry.id === transactionId);
    if (!tx) throw new Error('Unknown Nexus Bank transaction.');
    if (!['debit_pending', 'debited', 'credit_pending'].includes(tx.state)) return { recovered: false, state: tx.state };

    return this.withPlayerLock(tx.eosId, async (player) => {
      const fresh = this.store.read().transactions.find((entry) => entry.id === transactionId);
      if (!fresh || !['debit_pending', 'debited', 'credit_pending'].includes(fresh.state)) return { recovered: false, state: fresh?.state || 'missing' };
      const currentArk = await this.arkBalance(player);

      if (fresh.type === 'deposit') {
        if (fresh.state === 'debited' || currentArk === fresh.arkBalanceBefore - fresh.amount) {
          if (fresh.state === 'debit_pending') this.store.transition(fresh.id, 'debit_pending', 'debited');
          this.store.transition(fresh.id, 'debited', 'completed', ({ account }) => { account.balance += fresh.amount; });
          return { recovered: true, state: 'completed' };
        }
        if (currentArk === fresh.arkBalanceBefore) {
          this.store.transition(fresh.id, 'debit_pending', 'cancelled', null, 'Recovery confirmed ArkShop debit did not occur.');
          return { recovered: true, state: 'cancelled' };
        }
      }

      if (fresh.type === 'withdrawal' && fresh.state === 'credit_pending') {
        if (currentArk === fresh.arkBalanceBefore + fresh.amount) {
          this.store.transition(fresh.id, 'credit_pending', 'completed');
          return { recovered: true, state: 'completed' };
        }
        if (currentArk === fresh.arkBalanceBefore) {
          try {
            await this.changePoints(player, fresh.amount);
            this.store.transition(fresh.id, 'credit_pending', 'completed');
            return { recovered: true, state: 'completed' };
          } catch (error) {
            return { recovered: false, state: 'credit_pending', error: cleanError(error) };
          }
        }
      }

      const expected = fresh.type === 'deposit' ? 'debit_pending' : 'credit_pending';
      this.store.transition(fresh.id, expected, 'manual_review', null, `Recovery found unexpected ArkShop balance ${currentArk}; expected baseline ${fresh.arkBalanceBefore}.`);
      return { recovered: false, state: 'manual_review' };
    });
  }
}

module.exports = {
  STORE_VERSION,
  MAX_TRANSFER,
  safeAmount,
  assertPersistedState,
  NexusBankStore,
  ArkNexusBankService
};
