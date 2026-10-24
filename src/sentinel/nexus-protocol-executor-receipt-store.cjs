'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  normalizeExecutorReceipt,
  buildReceiptIndex,
  classifyExecutionAttempt
} = require('./nexus-protocol-executor-receipts.cjs');

const RECEIPT_STORE_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function normalizedCapacity(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 20000 ? parsed : 5000;
}

function emptyReceiptState() {
  return {
    version: RECEIPT_STORE_VERSION,
    revision: 0,
    updatedAt: 0,
    receipts: []
  };
}

function normalizeReceiptState(input, maxReceipts = 5000) {
  const capacity = normalizedCapacity(maxReceipts);
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (raw.version !== undefined && Number(raw.version) !== RECEIPT_STORE_VERSION) {
    throw new Error('Unsupported Protocol executor receipt store version');
  }
  const receipts = Array.isArray(raw.receipts)
    ? raw.receipts.map((receipt) => normalizeExecutorReceipt(receipt))
    : [];
  if (receipts.length > capacity) throw new Error('Protocol executor receipt store exceeds safe capacity');
  buildReceiptIndex(receipts);
  return {
    version: RECEIPT_STORE_VERSION,
    revision: Math.floor(finiteNonNegative(raw.revision, 'Protocol receipt store revision')),
    updatedAt: finiteNonNegative(raw.updatedAt, 'Protocol receipt store updated time'),
    receipts
  };
}

function validateReceiptAppend(receipts, input, maxReceipts) {
  const receipt = normalizeExecutorReceipt(input);
  const index = buildReceiptIndex(receipts);
  const existing = index.byActionId.get(receipt.actionId);
  if (existing) {
    if (existing.digest !== receipt.digest) throw new Error('Conflicting Protocol executor receipt replay');
    return { receipt: clone(existing), duplicate: true };
  }
  if (receipt.idempotencyKey) {
    const existingKey = index.byIdempotencyKey.get(receipt.idempotencyKey);
    if (existingKey && existingKey.actionId !== receipt.actionId) {
      throw new Error('Protocol executor idempotency key reused by another action');
    }
  }
  if (receipts.length >= maxReceipts) {
    throw new Error('Protocol executor receipt store is full; reconciliation or archival is required');
  }
  return { receipt, duplicate: false };
}

class NexusProtocolExecutorReceiptStore {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.maxReceipts = normalizedCapacity(options.maxReceipts ?? 5000);
    this.state = emptyReceiptState();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.state = emptyReceiptState();
      return this.snapshot();
    }
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.state = normalizeReceiptState(parsed, this.maxReceipts);
    return this.snapshot();
  }

  snapshot() {
    return clone(this.state);
  }

  #persistState(nextState) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(nextState, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temp, this.file);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch {}
      throw error;
    }
    this.state = nextState;
    return this.snapshot();
  }

  save(now = Date.now()) {
    const updatedAt = finiteNonNegative(now, 'Protocol receipt store save time');
    if (this.state.receipts.length > this.maxReceipts) {
      throw new Error('Protocol executor receipt store exceeds safe capacity');
    }
    buildReceiptIndex(this.state.receipts);
    const nextState = {
      version: RECEIPT_STORE_VERSION,
      revision: this.state.revision + 1,
      updatedAt,
      receipts: clone(this.state.receipts)
    };
    return this.#persistState(nextState);
  }

  append(input) {
    const checked = validateReceiptAppend(this.state.receipts, input, this.maxReceipts);
    if (checked.duplicate) return checked.receipt;
    this.state.receipts.push(checked.receipt);
    return clone(checked.receipt);
  }

  compareAndAppend(expectedRevision, input, now = Date.now()) {
    const revision = Number(expectedRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Invalid Protocol receipt store expected revision');
    }
    if (revision !== this.state.revision) {
      throw new Error('Protocol receipt store revision changed before atomic append');
    }
    const updatedAt = finiteNonNegative(now, 'Protocol receipt store compare-and-append time');
    const checked = validateReceiptAppend(this.state.receipts, input, this.maxReceipts);
    if (checked.duplicate) {
      return Object.freeze({ appended: false, duplicate: true, receipt: checked.receipt, state: this.snapshot() });
    }
    const nextState = {
      version: RECEIPT_STORE_VERSION,
      revision: this.state.revision + 1,
      updatedAt,
      receipts: [...clone(this.state.receipts), checked.receipt]
    };
    buildReceiptIndex(nextState.receipts);
    const state = this.#persistState(nextState);
    return Object.freeze({ appended: true, duplicate: false, receipt: clone(checked.receipt), state });
  }

  classify(envelope, actionIndex) {
    return classifyExecutionAttempt(envelope, actionIndex, this.state.receipts);
  }
}

module.exports = {
  RECEIPT_STORE_VERSION,
  emptyReceiptState,
  normalizeReceiptState,
  NexusProtocolExecutorReceiptStore
};
