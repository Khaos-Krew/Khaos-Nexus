'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FinanceStore, addPeriod } = require('../src/backend/core/finance-store.cjs');

function fixture(t, start = '2026-08-28T12:00:00Z') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-finance-'));
  t.after(() => fs.rmSync(directory, { recursive:true, force:true }));
  let now = new Date(start);
  const finance = new FinanceStore({
    filePath:path.join(directory, 'finance.json'),
    now:() => now,
    settings:{ timeZone:'America/Chicago' }
  });
  return { finance, setNow(value) { now = new Date(value); } };
}

test('finance ledger keeps owner contributions separate from Nexus revenue', (t) => {
  const { finance } = fixture(t);
  finance.addTransaction({ type:'OWNER_CONTRIBUTION', accountId:'nexus-operating', amount:200 }, { actorId:'owner' });
  finance.addTransaction({ type:'INCOME', accountId:'nexus-operating', amount:50, vendor:'Discord Shop', tags:['ARK'] }, { actorId:'owner' });
  finance.addTransaction({ type:'EXPENSE', accountId:'nexus-operating', amount:75, vendor:'Citadel Servers', tags:['ARK'] }, { actorId:'owner' });

  const summary = finance.summary();
  assert.equal(summary.operatingBalanceCents, 17500);
  assert.equal(summary.revenueMtdCents, 5000);
  assert.equal(summary.expensesMtdCents, 7500);
  assert.equal(summary.ownerContributionsMtdCents, 20000);
  assert.equal(summary.netOperationsMtdCents, -2500);
  assert.deepEqual(summary.tagBreakdown.ARK, { incomeCents:5000, expenseCents:7500, ownerContributionCents:0 });

  const paypal = finance.listAccounts().find((account) => account.id === 'khaos-nexus-paypal');
  assert.equal(paypal.provider, 'paypal');
  assert.equal(paypal.connected, false);
});

test('major recurring bills alert at 30 days, report shortfall, and suppress duplicate delivery', (t) => {
  const { finance, setNow } = fixture(t);
  finance.addTransaction({ type:'OWNER_CONTRIBUTION', accountId:'nexus-operating', amount:100 }, { actorId:'owner' });
  const bill = finance.addRecurringBill({
    vendor:'Citadel Servers',
    service:'ARK Cluster Hosting',
    amount:125,
    accountId:'nexus-operating',
    frequency:'monthly',
    dueDate:'2026-09-27',
    autopay:true,
    major:true,
    tags:['ARK']
  }, { actorId:'owner' });

  assert.deepEqual(bill.alertDays, [30, 14, 7, 3, 1, 0]);
  const [alert] = finance.dueAlerts();
  assert.equal(alert.billId, bill.id);
  assert.equal(alert.daysUntil, 30);
  assert.equal(alert.shortfallCents, 2500);
  assert.equal(alert.fundingStatus, 'shortfall');
  assert.equal(alert.autopay, true);
  assert.equal(alert.accountName, 'Nexus Operating Fund');

  const receipt = finance.recordAlertDispatch({ ...alert, channelId:'finance-channel', messageId:'message-1' }, { actorId:'sentinel' });
  assert.equal(receipt.status, 'delivered');
  assert.equal(finance.dueAlerts().length, 0);
  const acknowledged = finance.acknowledgeAlert({ id:receipt.id }, { actorId:'owner' });
  assert.equal(acknowledged.status, 'acknowledged');
  assert.equal(finance.listAlerts({ activeOnly:true }).length, 0);

  setNow('2026-09-13T12:00:00Z');
  const [nextAlert] = finance.dueAlerts();
  assert.equal(nextAlert.daysUntil, 14, 'later lead-time stages must still alert after the 30-day reminder was acknowledged');
});

test('marking a bill paid creates an expense and rolls the next due date', (t) => {
  const { finance, setNow } = fixture(t, '2026-09-27T12:00:00Z');
  finance.addTransaction({ type:'OWNER_CONTRIBUTION', accountId:'nexus-operating', amount:500 }, { actorId:'owner' });
  const bill = finance.addRecurringBill({
    vendor:'Citadel Servers', service:'ARK Hosting', amount:115,
    accountId:'nexus-operating', frequency:'monthly', dueDate:'2026-09-27', autopay:true
  }, { actorId:'owner' });

  const paid = finance.markBillPaid(bill.id, { amount:112.50 }, { actorId:'owner' });
  assert.equal(paid.transaction.type, 'EXPENSE');
  assert.equal(paid.transaction.amountCents, 11250);
  assert.equal(paid.bill.lastPaidDueDate, '2026-09-27');
  assert.equal(paid.bill.nextDueDate, '2026-10-27');
  assert.equal(paid.bill.enabled, true);

  setNow('2026-10-27T12:00:00Z');
  assert.equal(finance.summary().expensesMtdCents, 0, 'September payment must not be counted in October MTD');
  assert.throws(() => finance.markBillPaid(bill.id, {}, { actorId:'owner' }), /already marked paid|Bill/);
});

test('one-time bills close after payment and calendar rollovers clamp safely', (t) => {
  const { finance } = fixture(t);
  const bill = finance.addRecurringBill({
    vendor:'Domain Registrar', service:'One-time domain transfer', amount:20,
    accountId:'nexus-operating', frequency:'one-time', dueDate:'2026-08-28', autopay:false
  }, { actorId:'owner' });
  const paid = finance.markBillPaid(bill.id, {}, { actorId:'owner' });
  assert.equal(paid.bill.enabled, false);
  assert.equal(finance.listBills({ enabledOnly:true }).some((item) => item.id === bill.id), false);

  assert.equal(addPeriod('2027-01-31', 'monthly'), '2027-02-28');
  assert.equal(addPeriod('2028-02-29', 'yearly'), '2029-02-28');
});
