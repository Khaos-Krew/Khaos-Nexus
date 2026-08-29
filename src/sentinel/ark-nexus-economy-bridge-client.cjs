'use strict';

const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

function cleanEosId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('A valid EOS player id is required.');
  return id;
}

function cleanTxId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(id)) throw new Error('A valid Nexus transaction id is required.');
  return id;
}

function cleanBlueprint(value) {
  const blueprint = String(value || '').trim();
  if (!/^Blueprint'[A-Za-z0-9_./-]+\.[A-Za-z0-9_]+?'$/.test(blueprint)) throw new Error('Nexus bridge blueprint is invalid.');
  if (/\s/.test(blueprint)) throw new Error('Nexus bridge blueprint cannot contain whitespace.');
  return blueprint;
}

function safeInt(value, name, { min = 1, max = 100000000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return number;
}

function buildSellCommand({ eosId, blueprint, amount, payout, transactionId } = {}) {
  const player = cleanEosId(eosId);
  const item = cleanBlueprint(blueprint);
  const qty = safeInt(amount, 'Sell amount');
  const points = safeInt(payout, 'Sell payout', { max: 1000000 });
  const tx = cleanTxId(transactionId);
  return `NexusEconomy.Sell ${player} ${item} ${qty} ${points} ${tx}`;
}

function parseBridgeResponse(response, expectedTxId = '') {
  const text = String(response || '').trim();
  const ok = /(?:^|\s)NEXUS_OK(?:\s|$)/.test(text);
  const failed = /(?:^|\s)NEXUS_ERR(?:\s|$)/.test(text);
  const tx = text.match(/(?:^|\s)tx=([^\s]+)/)?.[1] || '';
  const code = text.match(/(?:^|\s)code=([^\s]+)/)?.[1] || '';
  const duplicate = /(?:^|\s)duplicate=true(?:\s|$)/.test(text);
  const removed = Number(text.match(/(?:^|\s)removed=(\d+)/)?.[1] || 0);
  const credited = Number(text.match(/(?:^|\s)credited=(\d+)/)?.[1] || 0);
  const restored = text.match(/(?:^|\s)restored=(true|false)/)?.[1];

  if (!ok && !failed) return { state: 'ambiguous', raw: text.slice(0, 500) };
  if (expectedTxId && tx !== expectedTxId) {
    return {
      state: 'ambiguous',
      reason: tx ? 'transaction-id-mismatch' : 'transaction-id-missing',
      tx,
      raw: text.slice(0, 500)
    };
  }
  if (ok) return { state: 'completed', tx, duplicate, removed, credited, raw: text.slice(0, 500) };
  return { state: 'failed', tx, code: code || 'bridge-error', restored: restored === 'true' ? true : restored === 'false' ? false : null, raw: text.slice(0, 500) };
}

class NexusEconomyBridgeClient {
  constructor({ prefix = 'ARK_GEN1', rcon } = {}) {
    this.prefix = prefix;
    if (rcon) this.rcon = rcon;
    else {
      const server = arkServerFromEnv(prefix);
      this.rcon = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
    }
  }

  async ping() {
    const response = await this.rcon.execute('NexusEconomy.Ping');
    const text = String(response || '').trim();
    return { ok: /NEXUS_OK/.test(text) && /bridge=0\.1\.0/.test(text), response: text.slice(0, 300) };
  }

  async sell(input = {}) {
    const transactionId = cleanTxId(input.transactionId);
    const command = buildSellCommand({ ...input, transactionId });
    let response;
    try {
      response = await this.rcon.execute(command);
    } catch (error) {
      const wrapped = new Error(`Nexus economy bridge result is ambiguous; transaction ${transactionId} must not be retried automatically.`);
      wrapped.code = 'NEXUS_BRIDGE_AMBIGUOUS';
      wrapped.transactionId = transactionId;
      wrapped.cause = error;
      throw wrapped;
    }

    const parsed = parseBridgeResponse(response, transactionId);
    if (parsed.state === 'ambiguous') {
      const error = new Error(`Nexus economy bridge returned an ambiguous response for transaction ${transactionId}; do not retry automatically.`);
      error.code = 'NEXUS_BRIDGE_AMBIGUOUS';
      error.transactionId = transactionId;
      error.response = parsed.raw;
      throw error;
    }
    return parsed;
  }
}

module.exports = {
  cleanEosId,
  cleanTxId,
  cleanBlueprint,
  buildSellCommand,
  parseBridgeResponse,
  NexusEconomyBridgeClient
};