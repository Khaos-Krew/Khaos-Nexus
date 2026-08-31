'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACK_PREFIX,
  PANEL_MARKER,
  alertPayload,
  financeCommandDefinition,
  summaryEmbed
} = require('../src/sentinel/finance.cjs');

test('finance command exposes owner ledger and payment-management actions', () => {
  const command = financeCommandDefinition().toJSON();
  assert.equal(command.name, 'finance');
  const subcommands = command.options.map((item) => item.name);
  for (const required of ['summary', 'accounts', 'account-add', 'transaction-add', 'transactions', 'bill-add', 'bills', 'bill-paid', 'bill-disable', 'alerts', 'alert-ack']) {
    assert.ok(subcommands.includes(required), `missing /finance ${required}`);
  }
});

test('finance summary visibly separates owner contributions from revenue', () => {
  const embed = summaryEmbed({
    currency:'USD', timeZone:'America/Chicago', asOfDate:'2026-08-28', fundingStatus:'funded',
    operatingBalanceCents:20000, upcoming30DayExpensesCents:10000, projected30DayBalanceCents:10000,
    revenueMtdCents:5000, expensesMtdCents:2500, ownerContributionsMtdCents:17500, nextBills:[]
  });
  assert.equal(embed.data.footer.text, PANEL_MARKER);
  const fields = Object.fromEntries(embed.data.fields.map((field) => [field.name, field.value]));
  assert.equal(fields['Revenue MTD'], '$50.00');
  assert.equal(fields['Owner Contributions MTD'], '$175.00');
});

test('payment alert shows funding shortfall, autopay state, and acknowledgement control', () => {
  const payload = alertPayload({
    key:'FIN-BILL-ABC123:2026-09-27:3', billId:'FIN-BILL-ABC123',
    vendor:'Citadel Servers', service:'ARK Hosting', amountCents:11500,
    dueDate:'2026-09-27', daysUntil:3, autopay:true,
    accountName:'Khaos Nexus PayPal', accountBalanceCents:8240, shortfallCents:3260,
    currency:'USD'
  }, { mention:'<@123>', mentionUserIds:['123'] });
  assert.equal(payload.embeds[0].data.title, '🚨 Payment Funding Warning');
  const fields = Object.fromEntries(payload.embeds[0].data.fields.map((field) => [field.name, field.value]));
  assert.equal(fields.Payment, '🔁 Autopay');
  assert.match(fields.Funding, /\$32\.60/);
  assert.equal(payload.components[0].components[0].data.custom_id, `${ACK_PREFIX}FIN-BILL-ABC123:2026-09-27:3`);
  assert.deepEqual(payload.allowedMentions.users, ['123']);
});
