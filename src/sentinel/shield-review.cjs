'use strict';

const CASE_ID_PATTERN = /^SEC-\d{4,12}$/i;
const ACTIONS = Object.freeze(['safe', 'quarantine', 'timeout', 'escalate', 'close', 'kick', 'ban', 'refresh']);
const DESTRUCTIVE_ACTIONS = Object.freeze(['kick', 'ban']);

function normalizeCaseId(value) {
  const id = String(value || '').trim().toUpperCase();
  return CASE_ID_PATTERN.test(id) ? id : '';
}

function actionId(caseId, action) {
  const id = normalizeCaseId(caseId);
  const value = String(action || '').toLowerCase();
  if (!id || !ACTIONS.includes(value)) return '';
  return `shieldcase:${id}:${value}`;
}

function confirmId(caseId, action) {
  const id = normalizeCaseId(caseId);
  const value = String(action || '').toLowerCase();
  if (!id || !DESTRUCTIVE_ACTIONS.includes(value)) return '';
  return `shieldconfirm:${id}:${value}`;
}

function cancelId(caseId) {
  const id = normalizeCaseId(caseId);
  return id ? `shieldconfirm:${id}:cancel` : '';
}

function parseActionId(value) {
  const match = /^shieldcase:(SEC-\d{4,12}):(safe|quarantine|timeout|escalate|close|kick|ban|refresh)$/i.exec(String(value || ''));
  if (!match) return null;
  return { kind: 'action', caseId: match[1].toUpperCase(), action: match[2].toLowerCase() };
}

function parseConfirmId(value) {
  const match = /^shieldconfirm:(SEC-\d{4,12}):(kick|ban|cancel)$/i.exec(String(value || ''));
  if (!match) return null;
  return { kind: 'confirm', caseId: match[1].toUpperCase(), action: match[2].toLowerCase() };
}

function reportRecommended(record = {}) {
  return Boolean(record.controls?.reportRecommended)
    || (record.actions || []).some((item) => String(item.action || '') === 'discord-report-recommended');
}

function caseButtons(record = {}) {
  const id = normalizeCaseId(record.caseId);
  if (!id || String(record.status || '') !== 'open') return [];
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Mark Safe', custom_id: actionId(id, 'safe') },
        { type: 2, style: 4, label: 'Quarantine 1h', custom_id: actionId(id, 'quarantine') },
        { type: 2, style: 2, label: 'Timeout 24h', custom_id: actionId(id, 'timeout') },
        { type: 2, style: 1, label: reportRecommended(record) ? 'Report Recommended ✓' : 'Escalate', custom_id: actionId(id, 'escalate') },
        { type: 2, style: 2, label: 'Close', custom_id: actionId(id, 'close') }
      ]
    },
    {
      type: 1,
      components: [
        { type: 2, style: 4, label: 'Kick…', custom_id: actionId(id, 'kick') },
        { type: 2, style: 4, label: 'Ban…', custom_id: actionId(id, 'ban') },
        { type: 2, style: 2, label: 'Refresh', custom_id: actionId(id, 'refresh') }
      ]
    }
  ];
}

function confirmationButtons(caseId, action) {
  const id = normalizeCaseId(caseId);
  const value = String(action || '').toLowerCase();
  if (!id || !DESTRUCTIVE_ACTIONS.includes(value)) return [];
  const label = value === 'ban' ? 'Confirm Ban' : 'Confirm Kick';
  return [{
    type: 1,
    components: [
      { type: 2, style: 4, label, custom_id: confirmId(id, value) },
      { type: 2, style: 2, label: 'Cancel', custom_id: cancelId(id) }
    ]
  }];
}

function compactReasons(record = {}) {
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  return reasons.slice(0, 8).map((item) => `\`${String(item || '').slice(0, 80)}\``).join(' • ') || 'No classified signals recorded.';
}

function lastActions(record = {}) {
  const actions = Array.isArray(record.actions) ? record.actions : [];
  if (!actions.length) return 'None yet.';
  return actions.slice(-4).reverse().map((item) => {
    const action = String(item.action || 'action').replace(/-/g, ' ');
    const actor = String(item.actorId || 'sentinal');
    return `• **${action}** by \`${actor}\``;
  }).join('\n');
}

function casePayload(record = {}, options = {}) {
  if (!record?.caseId) return { content: 'Shield case not found.', components: [] };
  const status = String(record.status || 'open').toUpperCase();
  const report = reportRecommended(record) ? ' • **Discord report recommended**' : '';
  const containment = record.controls?.quarantineRoleApplied ? 'quarantine marker active' : 'no quarantine marker';
  const timeout = record.controls?.shieldTimeoutUntil ? ` • Shield timeout until ${record.controls.shieldTimeoutUntil}` : '';
  const resolution = record.resolution ? `\n**Resolution:** ${String(record.resolution).slice(0, 500)}` : '';
  const content = [
    `🛡️ **Sentinal Shield • ${record.caseId}**`,
    `Account: <@${record.userId}> (\`${record.userId}\`)`,
    `Status: **${status}** • Risk: **${String(record.riskState || 'unknown')}** • Score: **${Number(record.score) || 0}/100**${report}`,
    `Containment: ${containment}${timeout}`,
    `Signals: ${compactReasons(record)}`,
    `Evidence records: **${Array.isArray(record.evidence) ? record.evidence.length : 0}**`,
    `**Recent actions**\n${lastActions(record)}`,
    resolution,
    options.notice ? `\n${String(options.notice).slice(0, 500)}` : ''
  ].filter(Boolean).join('\n');
  return { content: content.slice(0, 1950), components: caseButtons(record), allowedMentions: { parse: [] } };
}

function caseListPayload(cases = {}) {
  const records = Object.values(cases || {})
    .filter((item) => String(item.status || '') === 'open')
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, 20);
  if (!records.length) return { content: '🛡️ **Sentinal Shield** — no open security cases.', components: [] };
  const lines = records.map((item) => `• **${item.caseId}** — <@${item.userId}> • ${item.riskState} • ${Number(item.score) || 0}/100${reportRecommended(item) ? ' • report recommended' : ''}`);
  return { content: `🛡️ **Open Sentinal Shield Cases**\n${lines.join('\n')}\n\nUse \`/shield case case_id:SEC-####\` for review controls.`, components: [], allowedMentions: { parse: [] } };
}

module.exports = {
  CASE_ID_PATTERN,
  ACTIONS,
  DESTRUCTIVE_ACTIONS,
  normalizeCaseId,
  actionId,
  confirmId,
  cancelId,
  parseActionId,
  parseConfirmId,
  reportRecommended,
  caseButtons,
  confirmationButtons,
  casePayload,
  caseListPayload
};
