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

  save(now = Date.now()) {
    const updatedAt = finiteNonNegative(now, 'Protocol receipt store save time');
    if (this.state.receipts.length > this.maxReceipts) {
      throw new Error('Protocol executor receipt store exceeds safe capacity');
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.state.version = RECEIPT_STORE_VERSION;
    this.state.revision += 1;
    this.state.updatedAt = updatedAt;
    buildReceiptIndex(this.state.receipts);
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.file);
    return this.snapshot();
  }

  append(input) {
    const receipt = normalizeExecutorReceipt(input);
    const index = buildReceiptIndex(this.state.receipts);
    const existing = index.byActionId.get(receipt.actionId);
    if (existing) {
      if (existing.digest !== receipt.digest) throw new Error('Conflicting Protocol executor receipt replay');
      return clone(existing);
    }
    if (receipt.idempotencyKey) {
      const existingKey = index.byIdempotencyKey.get(receipt.idempotencyKey);
      if (existingKey && existingKey.actionId !== receipt.actionId) {
        throw new Error('Protocol executor idempotency key reused by another action');
      }
    }
    if (this.state.receipts.length >= this.maxReceipts) {
      throw new Error('Protocol executor receipt store is full; reconciliation or archival is required');
    }
    this.state.receipts.push(receipt);
    return clone(receipt);
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
