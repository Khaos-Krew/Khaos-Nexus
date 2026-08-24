'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const {
  REPORT_BUTTON_ID,
  REPORT_MODAL_ID,
  activeReport,
  controlId,
  createCaseId,
  parseControlId,
  reportChannelName,
  reportModal,
  rulesPanel,
  ticketControls,
  ticketPayload,
  userSelectPayload,
  validCaseId
} = require('../src/sentinel/safety-report-model.cjs');
const { SafetyReportStore } = require('../src/sentinel/safety-report-store.cjs');
const {
  reportCommand,
  reportOverwrites,
  resolveStaffRoleIds,
  staffOnlyOverwrites
} = require('../src/sentinel/safety-report-extension.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-safety-report-')); }

function fakeRole(id, name, permissions = []) {
  return {
    id,
    name,
    managed: false,
    permissions: { has: (permission) => permissions.includes(permission) }
  };
}

test('private report case IDs and channel names are stable and non-identifying', () => {
  const caseId = createCaseId(new Date('2026-08-24T05:30:00Z'), 'ab12');
  assert.equal(caseId, 'NX-20260824-AB12');
  assert.equal(validCaseId(caseId), true);
  assert.equal(reportChannelName(caseId), 'report-nx-20260824-ab12');
  assert.equal(reportChannelName(caseId, true), 'closed-nx-20260824-ab12');
  assert.doesNotMatch(reportChannelName(caseId), /user|reporter|kirito/i);
});

test('/report is intentionally short and opens a five-field private modal', () => {
  const command = reportCommand().toJSON();
  assert.equal(command.name, 'report');
  assert.deepEqual(command.options || [], []);
  const modal = reportModal();
  assert.equal(modal.custom_id, REPORT_MODAL_ID);
  assert.equal(modal.components.length, 5);
  assert.equal(modal.components.every((row) => row.components.length === 1), true);
  assert.equal(modal.components.filter((row) => row.components[0].required).length, 2);
});

test('rules panel states safe-space expectations and exposes a private report button without a website link', () => {
  const payload = rulesPanel();
  const text = JSON.stringify(payload);
  assert.match(text, /safe-space community/i);
  assert.match(text, /harassment is not tolerated/i);
  assert.match(text, /need-to-know/i);
  assert.doesNotMatch(text, /https?:\/\//i);
  const button = payload.components[0].components[0];
  assert.equal(button.custom_id, REPORT_BUTTON_ID);
  assert.equal(button.label, 'Open Private Report');
});

test('ticket controls cover claim, staff/user access, escalation, resolution, and archive closure within Discord row limits', () => {
  const caseId = 'NX-20260824-A1B2';
  const rows = ticketControls(caseId);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.components.length <= 5));
  const ids = rows.flatMap((row) => row.components.map((button) => button.custom_id));
  for (const action of ['claim', 'addstaff', 'adduser', 'escalate', 'resolve', 'close']) {
    const id = controlId(action, caseId);
    assert.ok(ids.includes(id));
    assert.deepEqual(parseControlId(id), { action, caseId });
  }
  assert.equal(parseControlId('nexussafety:delete:NX-20260824-A1B2'), null);
  assert.equal(parseControlId('other:close:NX-20260824-A1B2'), null);
});

test('participant picker uses Discord user-select components instead of asking staff to type member IDs', () => {
  const caseId = 'NX-20260824-A1B2';
  const staff = userSelectPayload(caseId, true);
  const user = userSelectPayload(caseId, false);
  assert.equal(staff.components[0].components[0].type, 5);
  assert.equal(user.components[0].components[0].type, 5);
  assert.match(staff.components[0].components[0].custom_id, /staffselect/);
  assert.match(user.components[0].components[0].custom_id, /userselect/);
});

test('private report payload keeps the report in the private ticket and explicitly documents need-to-know handling', () => {
  const payload = ticketPayload('NX-20260824-A1B2', '100000000000000001', {
    summary: 'Repeated harassment',
    involved: '#general',
    details: 'A member continued contacting me after I asked them to stop.',
    evidence: 'Message link will be attached.',
    support: 'Please review and stop the contact.'
  });
  const text = JSON.stringify(payload);
  assert.match(text, /Repeated harassment/);
  assert.match(text, /need-to-know/i);
  assert.match(text, /attach screenshots\/files/i);
  assert.equal(payload.allowed_mentions.parse.length, 0);
  assert.deepEqual(payload.allowed_mentions.users, ['100000000000000001']);
});

test('safety report store persists metadata while allowing active-case counting without report narrative fields', () => {
  const dir = tempDir();
  try {
    const store = new SafetyReportStore(dir);
    const caseId = 'NX-20260824-A1B2';
    store.set(caseId, {
      reporterId: '100000000000000001',
      channelId: '100000000000000002',
      status: 'open',
      createdAt: '2026-08-24T05:30:00.000Z'
    });
    assert.equal(store.get(caseId).caseId, caseId);
    assert.equal(store.openForReporter('100000000000000001').length, 1);
    assert.equal(activeReport(store.get(caseId)), true);
    const raw = fs.readFileSync(store.file, 'utf8');
    assert.doesNotMatch(raw, /details|evidence|summary/i);
    store.set(caseId, { status: 'closed' });
    assert.equal(store.openForReporter('100000000000000001').length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('report permission plan denies everyone, admits reporter, staff and owners, and keeps archive staff-only', () => {
  const guild = { id: '100000000000000000' };
  const botId = '100000000000000001';
  const reporterId = '100000000000000002';
  const staffRoleId = '100000000000000003';
  const ownerId = '100000000000000004';
  const report = reportOverwrites(guild, botId, reporterId, [staffRoleId], [ownerId]);
  assert.ok(report.find((item) => item.id === guild.id && item.deny.includes(PermissionFlagsBits.ViewChannel)));
  assert.ok(report.find((item) => item.id === reporterId && item.allow.includes(PermissionFlagsBits.ViewChannel)));
  assert.ok(report.find((item) => item.id === staffRoleId && item.allow.includes(PermissionFlagsBits.ManageMessages)));
  assert.ok(report.find((item) => item.id === ownerId && item.allow.includes(PermissionFlagsBits.ViewChannel)));

  const archive = staffOnlyOverwrites(guild, botId, [staffRoleId], [ownerId]);
  assert.equal(archive.some((item) => item.id === reporterId), false);
  assert.ok(archive.find((item) => item.id === staffRoleId));
});

test('configured safety/operator roles are preferred, with moderation roles as safe fallback', async () => {
  const staff = fakeRole('100000000000000010', 'Staff');
  const mod = fakeRole('100000000000000011', 'Moderator', [PermissionFlagsBits.ModerateMembers]);
  const member = fakeRole('100000000000000012', 'Member');
  const guild = {
    id: '100000000000000000',
    roles: { fetch: async () => new Map([[staff.id, staff], [mod.id, mod], [member.id, member]]) }
  };
  assert.deepEqual(await resolveStaffRoleIds(guild, { discord: { safetyStaffRoleIds: [staff.id], operatorRoleIds: [] } }), [staff.id]);
  assert.deepEqual(await resolveStaffRoleIds(guild, { discord: { safetyStaffRoleIds: [], operatorRoleIds: [] } }), [mod.id]);
});
