'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { JsonStore, clone } = require('./json-store.cjs');

const TRANSACTION_TYPES = new Set(['INCOME', 'EXPENSE', 'OWNER_CONTRIBUTION', 'TRANSFER', 'REFUND', 'FEE', 'ADJUSTMENT']);
const TRANSACTION_STATUSES = new Set(['PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOID', 'REFUNDED']);
const BALANCE_STATUSES = new Set(['POSTED', 'CLEARED', 'RECONCILED']);
const BILL_FREQUENCIES = new Set(['one-time', 'weekly', 'monthly', 'yearly']);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function id(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function dateOnly(value) {
  const text = cleanText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Date must use YYYY-MM-DD.');
  const [year, month, day] = text.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) throw new Error('Date is not valid.');
  return text;
}

function localDateString(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function utcDayNumber(text) {
  const [year, month, day] = dateOnly(text).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function daysBetween(fromDate, toDate) {
  return utcDayNumber(toDate) - utcDayNumber(fromDate);
}

function daysInMonth(year, monthOneBased) {
  return new Date(Date.UTC(year, monthOneBased, 0)).getUTCDate();
}

function addPeriod(date, frequency) {
  const source = dateOnly(date);
  if (!BILL_FREQUENCIES.has(frequency)) throw new Error(`Unsupported bill frequency: ${frequency}`);
  if (frequency === 'one-time') return source;
  const [year, month, day] = source.split('-').map(Number);
  if (frequency === 'weekly') {
    const next = new Date(Date.UTC(year, month - 1, day + 7));
    return next.toISOString().slice(0, 10);
  }
  if (frequency === 'monthly') {
    let targetYear = year;
    let targetMonth = month + 1;
    if (targetMonth > 12) { targetYear += 1; targetMonth = 1; }
    const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
    return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  }
  const targetYear = year + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, month));
  return `${String(targetYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

function amountCents(input, field = 'amount') {
  if (Number.isSafeInteger(input?.amountCents)) {
    if (input.amountCents <= 0) throw new Error(`${field} must be greater than zero.`);
    return input.amountCents;
  }
  const amount = Number(input?.amount ?? input);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${field} must be greater than zero.`);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error(`${field} is outside the supported range.`);
  return cents;
}

function optionalCents(input, fallback = 0) {
  if (Number.isSafeInteger(input)) return input;
  const amount = Number(input);
  if (!Number.isFinite(amount)) return fallback;
  return Math.round(amount * 100);
}

function normalizeAlertDays(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 3650))].sort((a, b) => b - a);
}

function seedAccounts(nowIso) {
  return [
    { id: 'nexus-operating', name: 'Nexus Operating Fund', provider: 'manual', kind: 'operating', currency: 'USD', connected: true, openingBalanceCents: 0, includeInOperatingBalance: true, active: true, createdAt: nowIso },
    { id: 'discord-stripe-clearing', name: 'Discord / Stripe Clearing', provider: 'stripe', kind: 'clearing', currency: 'USD', connected: false, openingBalanceCents: 0, includeInOperatingBalance: false, active: true, createdAt: nowIso },
    { id: 'khaos-nexus-paypal', name: 'Khaos Nexus PayPal', provider: 'paypal', kind: 'operating', currency: 'USD', connected: false, openingBalanceCents: 0, includeInOperatingBalance: true, active: true, createdAt: nowIso },
    { id: 'owner-contributions', name: 'Owner Contributions', provider: 'manual', kind: 'source', currency: 'USD', connected: true, openingBalanceCents: 0, includeInOperatingBalance: false, active: true, createdAt: nowIso },
    { id: 'cash-manual', name: 'Cash / Manual', provider: 'manual', kind: 'operating', currency: 'USD', connected: true, openingBalanceCents: 0, includeInOperatingBalance: true, active: true, createdAt: nowIso }
  ];
}

class FinanceStore {
  constructor(options = {}) {
    const filePath = path.resolve(options.filePath || path.join(process.cwd(), 'data', 'finance.json'));
    const defaultAlertDays = normalizeAlertDays(options.settings?.defaultAlertDays, [14, 7, 3, 1, 0]);
    const majorAlertDays = normalizeAlertDays(options.settings?.majorAlertDays, [30, 14, 7, 3, 1, 0]);
    this.now = options.now || (() => new Date());
    this.settings = {
      currency: cleanText(options.settings?.currency || 'USD', 8).toUpperCase() || 'USD',
      timeZone: cleanText(options.settings?.timeZone || 'America/Chicago', 80) || 'America/Chicago',
      defaultAlertDays,
      majorAlertDays
    };
    this.store = new JsonStore(filePath, {
      version: 1,
      settings: this.settings,
      accounts: [],
      transactions: [],
      recurringBills: [],
      alertReceipts: [],
      auditLog: []
    });
    this.normalizeState();
  }

  normalizeState() {
    const state = this.store.read();
    state.version = 1;
    state.settings = { ...this.settings, ...(state.settings || {}) };
    state.settings.defaultAlertDays = normalizeAlertDays(state.settings.defaultAlertDays, this.settings.defaultAlertDays);
    state.settings.majorAlertDays = normalizeAlertDays(state.settings.majorAlertDays, this.settings.majorAlertDays);
    for (const key of ['accounts', 'transactions', 'recurringBills', 'alertReceipts', 'auditLog']) if (!Array.isArray(state[key])) state[key] = [];
    if (!state.accounts.length) state.accounts = seedAccounts(this.now().toISOString()).map((account) => ({ ...account, currency: state.settings.currency }));
    this.store.save();
  }

  state() { return this.store.read(); }

  audit(action, context = {}, target = {}, details = {}) {
    const entry = {
      id: id('FIN-AUD'),
      action: cleanText(action, 80),
      actorId: cleanText(context.actorId || 'system', 120),
      targetType: cleanText(target.type || '', 40),
      targetId: cleanText(target.id || '', 100),
      details: clone(details || {}),
      createdAt: this.now().toISOString()
    };
    const audit = this.state().auditLog;
    audit.push(entry);
    if (audit.length > 2000) audit.splice(0, audit.length - 2000);
    return entry;
  }

  listAudit(limit = 100) {
    const count = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.state().auditLog.slice(-count).reverse().map(clone);
  }

  listAccounts({ activeOnly = false } = {}) {
    const accounts = this.state().accounts.filter((account) => !activeOnly || account.active !== false);
    return accounts.map((account) => ({ ...clone(account), balanceCents: this.accountBalance(account.id) }));
  }

  getAccount(accountId) {
    return this.state().accounts.find((account) => account.id === cleanText(accountId, 100)) || null;
  }

  requireAccount(accountId) {
    const account = this.getAccount(accountId);
    if (!account || account.active === false) throw new Error(`Finance account ${cleanText(accountId, 100) || '(missing)'} was not found or is inactive.`);
    return account;
  }

  addAccount(input = {}, context = {}) {
    const name = cleanText(input.name, 100);
    if (!name) throw new Error('Account name is required.');
    const accountId = cleanText(input.id, 80).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || id('acct').toLowerCase();
    if (this.getAccount(accountId)) throw new Error(`Finance account ${accountId} already exists.`);
    const provider = cleanText(input.provider || 'manual', 40).toLowerCase() || 'manual';
    const openingBalanceCents = Number.isSafeInteger(input.openingBalanceCents) ? input.openingBalanceCents : optionalCents(input.openingBalance, 0);
    const account = {
      id: accountId,
      name,
      provider,
      kind: cleanText(input.kind || 'operating', 40).toLowerCase() || 'operating',
      currency: cleanText(input.currency || this.state().settings.currency, 8).toUpperCase(),
      connected: input.connected === true,
      openingBalanceCents,
      includeInOperatingBalance: input.includeInOperatingBalance !== false,
      active: input.active !== false,
      createdBy: cleanText(context.actorId || 'owner', 120),
      createdAt: this.now().toISOString()
    };
    this.state().accounts.push(account);
    this.audit('ACCOUNT_ADDED', context, { type: 'account', id: account.id }, { name: account.name, provider: account.provider });
    this.store.save();
    return { ...clone(account), balanceCents: openingBalanceCents };
  }

  accountBalance(accountId) {
    const account = this.getAccount(accountId);
    if (!account) return 0;
    let balance = Number(account.openingBalanceCents || 0);
    for (const tx of this.state().transactions) {
      if (!BALANCE_STATUSES.has(tx.status)) continue;
      if (tx.type === 'TRANSFER') {
        if (tx.accountId === accountId) balance -= tx.amountCents;
        if (tx.counterpartyAccountId === accountId) balance += tx.amountCents;
        continue;
      }
      if (tx.accountId !== accountId) continue;
      if (['INCOME', 'OWNER_CONTRIBUTION', 'REFUND'].includes(tx.type)) balance += tx.amountCents;
      else if (['EXPENSE', 'FEE'].includes(tx.type)) balance -= tx.amountCents;
      else if (tx.type === 'ADJUSTMENT') balance += tx.direction === 'debit' ? -tx.amountCents : tx.amountCents;
    }
    return balance;
  }

  listTransactions(filters = {}) {
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
    const accountId = cleanText(filters.accountId || filters.account, 100);
    const type = cleanText(filters.type, 40).toUpperCase();
    const status = cleanText(filters.status, 40).toUpperCase();
    return this.state().transactions
      .filter((tx) => !accountId || tx.accountId === accountId || tx.counterpartyAccountId === accountId)
      .filter((tx) => !type || tx.type === type)
      .filter((tx) => !status || tx.status === status)
      .slice(-limit)
      .reverse()
      .map(clone);
  }

  addTransaction(input = {}, context = {}) {
    const type = cleanText(input.type, 40).toUpperCase();
    if (!TRANSACTION_TYPES.has(type)) throw new Error(`Unsupported transaction type: ${type || '(missing)'}.`);
    const status = cleanText(input.status || 'POSTED', 40).toUpperCase();
    if (!TRANSACTION_STATUSES.has(status)) throw new Error(`Unsupported transaction status: ${status}.`);
    const account = this.requireAccount(input.accountId || input.account);
    const cents = amountCents(input);
    let counterpartyAccountId = '';
    if (type === 'TRANSFER') {
      const counterparty = this.requireAccount(input.counterpartyAccountId || input.toAccountId);
      if (counterparty.id === account.id) throw new Error('Transfer source and destination accounts must be different.');
      counterpartyAccountId = counterparty.id;
    }
    const direction = type === 'ADJUSTMENT' && cleanText(input.direction, 10).toLowerCase() === 'debit' ? 'debit' : 'credit';
    const transaction = {
      id: id('FIN-TX'),
      type,
      status,
      accountId: account.id,
      counterpartyAccountId,
      direction,
      amountCents: cents,
      currency: account.currency || this.state().settings.currency,
      vendor: cleanText(input.vendor, 120),
      category: cleanText(input.category || (type === 'OWNER_CONTRIBUTION' ? 'Owner Contribution' : ''), 100),
      tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => cleanText(tag, 50)).filter(Boolean))].slice(0, 20) : [],
      note: cleanText(input.note, 1000),
      externalId: cleanText(input.externalId, 160),
      recurringBillId: cleanText(input.recurringBillId, 100),
      occurredAt: input.occurredAt ? new Date(input.occurredAt).toISOString() : this.now().toISOString(),
      createdBy: cleanText(context.actorId || 'owner', 120),
      createdAt: this.now().toISOString()
    };
    this.state().transactions.push(transaction);
    this.audit('TRANSACTION_ADDED', context, { type: 'transaction', id: transaction.id }, { type, status, amountCents: cents, accountId: account.id });
    this.store.save();
    return clone(transaction);
  }

  listBills({ enabledOnly = false } = {}) {
    return this.state().recurringBills
      .filter((bill) => !enabledOnly || bill.enabled !== false)
      .sort((a, b) => String(a.nextDueDate).localeCompare(String(b.nextDueDate)))
      .map((bill) => ({ ...clone(bill), account: clone(this.getAccount(bill.accountId)), funding: this.billFunding(bill) }));
  }

  getBill(billId) {
    return this.state().recurringBills.find((bill) => bill.id === cleanText(billId, 100).toUpperCase()) || null;
  }

  addRecurringBill(input = {}, context = {}) {
    const vendor = cleanText(input.vendor, 120);
    const service = cleanText(input.service || input.name, 160);
    if (!vendor) throw new Error('Bill vendor is required.');
    if (!service) throw new Error('Bill service/name is required.');
    const account = this.requireAccount(input.accountId || input.account);
    const frequency = cleanText(input.frequency || 'monthly', 30).toLowerCase();
    if (!BILL_FREQUENCIES.has(frequency)) throw new Error(`Unsupported bill frequency: ${frequency}.`);
    const nextDueDate = dateOnly(input.nextDueDate || input.dueDate);
    const major = input.major === true || frequency === 'yearly';
    const configuredDays = major ? this.state().settings.majorAlertDays : this.state().settings.defaultAlertDays;
    const bill = {
      id: id('FIN-BILL'),
      vendor,
      service,
      amountCents: amountCents(input),
      currency: account.currency || this.state().settings.currency,
      accountId: account.id,
      category: cleanText(input.category || 'Operating Expense', 100),
      tags: Array.isArray(input.tags) ? [...new Set(input.tags.map((tag) => cleanText(tag, 50)).filter(Boolean))].slice(0, 20) : [],
      frequency,
      nextDueDate,
      autopay: input.autopay === true,
      major,
      alertDays: normalizeAlertDays(input.alertDays, configuredDays),
      enabled: input.enabled !== false,
      note: cleanText(input.note, 1000),
      createdBy: cleanText(context.actorId || 'owner', 120),
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString()
    };
    this.state().recurringBills.push(bill);
    this.audit('BILL_ADDED', context, { type: 'bill', id: bill.id }, { vendor, service, amountCents: bill.amountCents, nextDueDate, frequency });
    this.store.save();
    return clone(bill);
  }

  disableBill(billId, context = {}) {
    const bill = this.getBill(billId);
    if (!bill) throw new Error(`Bill ${cleanText(billId, 100)} was not found.`);
    bill.enabled = false;
    bill.updatedAt = this.now().toISOString();
    this.audit('BILL_DISABLED', context, { type: 'bill', id: bill.id });
    this.store.save();
    return clone(bill);
  }

  markBillPaid(billId, input = {}, context = {}) {
    const bill = this.getBill(billId);
    if (!bill) throw new Error(`Bill ${cleanText(billId, 100)} was not found.`);
    if (bill.enabled === false && bill.frequency !== 'one-time') throw new Error(`Bill ${bill.id} is disabled.`);
    const paidDueDate = bill.nextDueDate;
    if (bill.lastPaidDueDate === paidDueDate) throw new Error(`Bill ${bill.id} is already marked paid for ${paidDueDate}.`);
    const tx = this.addTransaction({
      type: 'EXPENSE',
      status: cleanText(input.status || 'POSTED', 40).toUpperCase(),
      accountId: bill.accountId,
      amountCents: Number.isSafeInteger(input.amountCents) ? input.amountCents : (input.amount ? amountCents(input) : bill.amountCents),
      vendor: bill.vendor,
      category: bill.category,
      tags: bill.tags,
      note: cleanText(input.note || `${bill.service} payment for ${paidDueDate}`, 1000),
      recurringBillId: bill.id,
      occurredAt: input.occurredAt
    }, context);
    bill.lastPaidAt = tx.occurredAt;
    bill.lastPaidDueDate = paidDueDate;
    bill.lastPaymentTransactionId = tx.id;
    if (bill.frequency === 'one-time') bill.enabled = false;
    else bill.nextDueDate = addPeriod(paidDueDate, bill.frequency);
    bill.updatedAt = this.now().toISOString();
    this.audit('BILL_MARKED_PAID', context, { type: 'bill', id: bill.id }, { paidDueDate, transactionId: tx.id, nextDueDate: bill.nextDueDate, enabled: bill.enabled });
    this.store.save();
    return { bill: clone(bill), transaction: tx };
  }

  billFunding(bill) {
    const balanceCents = this.accountBalance(bill.accountId);
    const shortfallCents = Math.max(0, Number(bill.amountCents || 0) - balanceCents);
    return {
      accountBalanceCents: balanceCents,
      status: shortfallCents > 0 ? 'shortfall' : 'fully-funded',
      shortfallCents
    };
  }

  alertKey(bill, dueDate, daysUntil) {
    return `${bill.id}:${dueDate}:${daysUntil}`;
  }

  dueAlerts({ now = this.now() } = {}) {
    const state = this.state();
    const today = localDateString(now, state.settings.timeZone || this.settings.timeZone);
    const dispatched = new Set(state.alertReceipts.filter((receipt) => receipt.status === 'delivered' || receipt.status === 'acknowledged').map((receipt) => receipt.key));
    const alerts = [];
    for (const bill of state.recurringBills) {
      if (bill.enabled === false) continue;
      const daysUntil = daysBetween(today, bill.nextDueDate);
      if (!bill.alertDays.includes(daysUntil)) continue;
      const key = this.alertKey(bill, bill.nextDueDate, daysUntil);
      if (dispatched.has(key)) continue;
      const account = this.getAccount(bill.accountId);
      const funding = this.billFunding(bill);
      alerts.push({
        key,
        billId: bill.id,
        vendor: bill.vendor,
        service: bill.service,
        amountCents: bill.amountCents,
        currency: bill.currency,
        dueDate: bill.nextDueDate,
        daysUntil,
        autopay: bill.autopay === true,
        major: bill.major === true,
        accountId: bill.accountId,
        accountName: account?.name || bill.accountId,
        fundingStatus: funding.status,
        accountBalanceCents: funding.accountBalanceCents,
        shortfallCents: funding.shortfallCents,
        severity: funding.shortfallCents > 0 ? 'warning' : (daysUntil === 0 ? 'due' : 'info')
      });
    }
    return alerts.sort((a, b) => a.daysUntil - b.daysUntil || b.shortfallCents - a.shortfallCents);
  }

  recordAlertDispatch(input = {}, context = {}) {
    const key = cleanText(input.key, 240);
    if (!key) throw new Error('Alert key is required.');
    const existing = this.state().alertReceipts.find((receipt) => receipt.key === key);
    if (existing) {
      if (existing.status !== 'acknowledged') existing.status = 'delivered';
      existing.messageId = cleanText(input.messageId || existing.messageId, 120);
      existing.channelId = cleanText(input.channelId || existing.channelId, 120);
      existing.deliveredAt = existing.deliveredAt || this.now().toISOString();
      this.store.save();
      return clone(existing);
    }
    const receipt = {
      id: id('FIN-ALERT'),
      key,
      billId: cleanText(input.billId, 100).toUpperCase(),
      dueDate: dateOnly(input.dueDate),
      daysUntil: Number(input.daysUntil),
      status: 'delivered',
      channelId: cleanText(input.channelId, 120),
      messageId: cleanText(input.messageId, 120),
      deliveredAt: this.now().toISOString(),
      acknowledgedAt: '',
      acknowledgedBy: ''
    };
    this.state().alertReceipts.push(receipt);
    if (this.state().alertReceipts.length > 5000) this.state().alertReceipts.splice(0, this.state().alertReceipts.length - 5000);
    this.audit('ALERT_DELIVERED', context, { type: 'alert', id: receipt.id }, { key, billId: receipt.billId, dueDate: receipt.dueDate, daysUntil: receipt.daysUntil });
    this.store.save();
    return clone(receipt);
  }

  acknowledgeAlert(input = {}, context = {}) {
    const key = cleanText(input.key, 240);
    const alertId = cleanText(input.id || input.alertId, 100).toUpperCase();
    const receipt = this.state().alertReceipts.find((item) => (key && item.key === key) || (alertId && item.id === alertId));
    if (!receipt) throw new Error('Finance alert was not found or has not been delivered yet.');
    receipt.status = 'acknowledged';
    receipt.acknowledgedAt = this.now().toISOString();
    receipt.acknowledgedBy = cleanText(context.actorId || input.actorId || 'owner', 120);
    this.audit('ALERT_ACKNOWLEDGED', context, { type: 'alert', id: receipt.id }, { key: receipt.key });
    this.store.save();
    return clone(receipt);
  }

  listAlerts({ limit = 100, activeOnly = false } = {}) {
    const count = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.state().alertReceipts
      .filter((receipt) => !activeOnly || receipt.status !== 'acknowledged')
      .slice(-count)
      .reverse()
      .map(clone);
  }

  summary({ now = this.now() } = {}) {
    const state = this.state();
    const today = localDateString(now, state.settings.timeZone || this.settings.timeZone);
    const monthPrefix = today.slice(0, 7);
    const operatingAccounts = state.accounts.filter((account) => account.active !== false && account.includeInOperatingBalance !== false);
    const operatingBalanceCents = operatingAccounts.reduce((sum, account) => sum + this.accountBalance(account.id), 0);
    let revenueMtdCents = 0;
    let expensesMtdCents = 0;
    let ownerContributionsMtdCents = 0;
    const tagBreakdown = {};
    for (const tx of state.transactions) {
      if (!BALANCE_STATUSES.has(tx.status)) continue;
      const txDate = localDateString(new Date(tx.occurredAt), state.settings.timeZone || this.settings.timeZone);
      if (txDate.startsWith(monthPrefix)) {
        if (tx.type === 'INCOME') revenueMtdCents += tx.amountCents;
        else if (tx.type === 'OWNER_CONTRIBUTION') ownerContributionsMtdCents += tx.amountCents;
        else if (['EXPENSE', 'FEE'].includes(tx.type)) expensesMtdCents += tx.amountCents;
      }
      for (const tag of tx.tags || []) {
        tagBreakdown[tag] ||= { incomeCents: 0, expenseCents: 0, ownerContributionCents: 0 };
        if (tx.type === 'INCOME') tagBreakdown[tag].incomeCents += tx.amountCents;
        else if (tx.type === 'OWNER_CONTRIBUTION') tagBreakdown[tag].ownerContributionCents += tx.amountCents;
        else if (['EXPENSE', 'FEE'].includes(tx.type)) tagBreakdown[tag].expenseCents += tx.amountCents;
      }
    }
    const upcoming = state.recurringBills
      .filter((bill) => bill.enabled !== false)
      .map((bill) => ({ bill, daysUntil: daysBetween(today, bill.nextDueDate) }))
      .filter((item) => item.daysUntil >= 0 && item.daysUntil <= 30)
      .sort((a, b) => a.daysUntil - b.daysUntil);
    const upcoming30DayExpensesCents = upcoming.reduce((sum, item) => sum + item.bill.amountCents, 0);
    const nextBills = upcoming.slice(0, 10).map(({ bill, daysUntil }) => ({
      id: bill.id,
      vendor: bill.vendor,
      service: bill.service,
      amountCents: bill.amountCents,
      dueDate: bill.nextDueDate,
      daysUntil,
      autopay: bill.autopay,
      accountId: bill.accountId,
      funding: this.billFunding(bill)
    }));
    return {
      currency: state.settings.currency,
      timeZone: state.settings.timeZone,
      asOfDate: today,
      operatingBalanceCents,
      revenueMtdCents,
      expensesMtdCents,
      ownerContributionsMtdCents,
      netOperationsMtdCents: revenueMtdCents - expensesMtdCents,
      upcoming30DayExpensesCents,
      projected30DayBalanceCents: operatingBalanceCents - upcoming30DayExpensesCents,
      fundingStatus: operatingBalanceCents >= upcoming30DayExpensesCents ? 'funded' : 'shortfall',
      nextBills,
      accounts: this.listAccounts({ activeOnly: true }),
      tagBreakdown
    };
  }
}

module.exports = {
  FinanceStore,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  BILL_FREQUENCIES,
  cleanText,
  dateOnly,
  localDateString,
  daysBetween,
  addPeriod,
  amountCents,
  normalizeAlertDays
};
