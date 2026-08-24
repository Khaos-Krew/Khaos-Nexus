'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const REPORT_BUTTON_ID = 'nexussafety:open';
const REPORT_MODAL_ID = 'nexussafety:submit';
const CONTROL_PREFIX = 'nexussafety';
const REPORT_CATEGORY_NAMES = Object.freeze(['private reports', 'safety reports', 'reports']);
const RULES_CHANNEL_NAMES = Object.freeze(['rules', 'server-rules', 'community-rules', 'rules-and-info', 'rules-and-safety']);
const ACTIVE_STATUSES = new Set(['open', 'claimed', 'escalated', 'resolved']);

function clean(value, max = 1000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function compact(value, max = 120) {
  return clean(value, max).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '')).filter((value) => /^\d{15,24}$/.test(value)))];
}

function createCaseId(now = new Date(), suffix = '') {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('A valid case date is required.');
  const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
  const token = compact(suffix || crypto.randomBytes(2).toString('hex'), 8).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, '0');
  return `NX-${stamp}-${token}`;
}

function validCaseId(value) {
  return /^NX-\d{8}-[A-Z0-9]{4}$/.test(String(value || '').toUpperCase());
}

function reportChannelName(caseId, closed = false) {
  if (!validCaseId(caseId)) throw new Error('Invalid Nexus report case ID.');
  return `${closed ? 'closed' : 'report'}-${String(caseId).toLowerCase()}`.slice(0, 100);
}

function controlId(action, caseId) {
  const safeAction = String(action || '').toLowerCase();
  if (!['claim', 'addstaff', 'adduser', 'escalate', 'resolve', 'close', 'staffselect', 'userselect'].includes(safeAction)) throw new Error('Unknown report control action.');
  if (!validCaseId(caseId)) throw new Error('Invalid Nexus report case ID.');
  return `${CONTROL_PREFIX}:${safeAction}:${String(caseId).toUpperCase()}`;
}

function parseControlId(value) {
  const match = /^nexussafety:(claim|addstaff|adduser|escalate|resolve|close|staffselect|userselect):(NX-\d{8}-[A-Z0-9]{4})$/i.exec(String(value || ''));
  return match ? { action: match[1].toLowerCase(), caseId: match[2].toUpperCase() } : null;
}

function reportModal() {
  const input = (id, label, style, required, maxLength, placeholder = '') => new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId(id)
      .setLabel(label.slice(0, 45))
      .setStyle(style)
      .setRequired(required)
      .setMaxLength(maxLength)
      .setPlaceholder(placeholder.slice(0, 100))
  );
  return new ModalBuilder()
    .setCustomId(REPORT_MODAL_ID)
    .setTitle('Open a Private Report')
    .addComponents(
      input('summary', 'Short summary', TextInputStyle.Short, true, 120, 'Example: harassment in voice chat'),
      input('involved', 'Person(s) or area involved', TextInputStyle.Short, false, 160, 'Names, channel, game server, or event'),
      input('details', 'What happened?', TextInputStyle.Paragraph, true, 1800, 'Include the important context. Staff can ask follow-up questions privately.'),
      input('evidence', 'Evidence or message links (optional)', TextInputStyle.Paragraph, false, 1000, 'Links, timestamps, filenames, or a note that you will attach screenshots in the ticket'),
      input('support', 'What support would help? (optional)', TextInputStyle.Paragraph, false, 800, 'Example: stop contact, review messages, staff follow-up')
    );
}

function rulesPanel() {
  return {
    embeds: [{
      title: 'KHAOS NEXUS • COMMUNITY RULES',
      description: '**Khaos Nexus is a safe-space community.** Everyone is expected to treat other members with dignity, respect boundaries, and help keep the community welcoming. Harassment is not tolerated.',
      fields: [
        { name: '1 • Respect people and boundaries', value: 'No harassment, bullying, hate, threats, stalking, doxxing, sexual harassment, targeted humiliation, or repeated unwanted contact.' },
        { name: '2 • Keep conflict from becoming abuse', value: 'Disagreements happen. Personal attacks, dog-piling, intimidation, retaliation, and attempts to drive someone out of the community do not belong here.' },
        { name: '3 • Protect privacy and consent', value: 'Do not expose private information, repost private conversations to shame someone, or share personal media without permission.' },
        { name: '4 • Use channels responsibly', value: 'Follow channel topics, avoid spam or disruptive behavior, and respect staff direction when moderation is needed.' },
        { name: '5 • Report concerns privately', value: 'Use **Open Private Report** below or `/report`. Reports are handled on a need-to-know basis by authorized staff. Good-faith reports and requests for help must not be retaliated against.' },
        { name: 'Evidence', value: 'If relevant, preserve message links, screenshots, timestamps, usernames, or other context. You can attach files after the private ticket opens.' }
      ],
      footer: { text: 'Khaos Nexus • Safety, respect, privacy, and accountability' }
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 4, label: 'Open Private Report', custom_id: REPORT_BUTTON_ID, emoji: { name: '🛡️' } }]
    }],
    allowed_mentions: { parse: [] }
  };
}

function ticketControls(caseId, disabled = false) {
  const button = (action, label, style, emoji) => ({
    type: 2, style, label, custom_id: controlId(action, caseId), disabled, ...(emoji ? { emoji: { name: emoji } } : {})
  });
  return [
    { type: 1, components: [
      button('claim', 'Claim', 1, '✋'),
      button('addstaff', 'Add Staff', 2, '🛡️'),
      button('adduser', 'Add User', 2, '➕'),
      button('escalate', 'Escalate', 4, '⚠️'),
      button('resolve', 'Resolve', 3, '✅')
    ] },
    { type: 1, components: [button('close', 'Close & Archive', 4, '🔒')] }
  ];
}

function userSelectPayload(caseId, staffOnly = false) {
  return {
    content: staffOnly ? 'Choose the staff member to add to this private report.' : 'Choose the member to add to this private report.',
    components: [{
      type: 1,
      components: [{
        type: 5,
        custom_id: controlId(staffOnly ? 'staffselect' : 'userselect', caseId),
        placeholder: staffOnly ? 'Select staff member' : 'Select member',
        min_values: 1,
        max_values: 1
      }]
    }]
  };
}

function reportFields(input = {}) {
  return {
    summary: compact(input.summary, 120),
    involved: compact(input.involved, 160),
    details: clean(input.details, 1800),
    evidence: clean(input.evidence, 1000),
    support: clean(input.support, 800)
  };
}

function ticketPayload(caseId, reporterId, input = {}) {
  const fields = reportFields(input);
  if (!fields.summary || !fields.details) throw new Error('A summary and report details are required.');
  const embedFields = [
    { name: 'Summary', value: fields.summary },
    { name: 'Reporter', value: `<@${String(reporterId)}>`, inline: true },
    { name: 'Status', value: 'OPEN', inline: true }
  ];
  if (fields.involved) embedFields.push({ name: 'Person(s) / area involved', value: fields.involved });
  embedFields.push({ name: 'What happened', value: fields.details });
  if (fields.evidence) embedFields.push({ name: 'Evidence / references', value: fields.evidence });
  if (fields.support) embedFields.push({ name: 'Requested support', value: fields.support });
  embedFields.push({ name: 'Next steps', value: 'Authorized staff can claim this case, add only necessary participants, escalate it, resolve it, or close it. You may attach screenshots/files here. Please keep report details inside this private channel.' });
  return {
    content: `<@${String(reporterId)}> your private report is open.`,
    embeds: [{ title: `PRIVATE REPORT • ${caseId}`, fields: embedFields, footer: { text: 'Need-to-know access • Report details are not posted to public logs' } }],
    components: ticketControls(caseId),
    allowed_mentions: { users: [String(reporterId)], roles: [], parse: [] }
  };
}

function activeReport(report) {
  return Boolean(report && ACTIVE_STATUSES.has(String(report.status || '').toLowerCase()));
}

module.exports = {
  ACTIVE_STATUSES,
  CONTROL_PREFIX,
  REPORT_BUTTON_ID,
  REPORT_CATEGORY_NAMES,
  REPORT_MODAL_ID,
  RULES_CHANNEL_NAMES,
  activeReport,
  clean,
  compact,
  controlId,
  createCaseId,
  normalizeIds,
  parseControlId,
  reportChannelName,
  reportFields,
  reportModal,
  rulesPanel,
  ticketControls,
  ticketPayload,
  userSelectPayload,
  validCaseId
};
