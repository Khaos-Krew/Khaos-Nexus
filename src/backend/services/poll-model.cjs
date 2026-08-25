'use strict';

const POLL_STATUSES = Object.freeze(['scheduled', 'open', 'closed', 'cancelled', 'runoff']);
const DECISION_RULES = Object.freeze(['plurality', 'majority', 'threshold', 'supermajority', 'informational']);
const TIE_RULES = Object.freeze(['runoff', 'staff-review', 'no-decision', 'extend']);
const VISIBILITY_MODES = Object.freeze(['public', 'results-after-close', 'anonymous-results']);
const POLL_ID_RE = /^POLL-\d{4,}$/;

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeReminderMinutes(values = []) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 7 * 24 * 60))]
    .sort((a, b) => b - a);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerInRange(value, fallback, min, max) {
  const number = Math.trunc(finiteNumber(value, fallback));
  return Math.min(max, Math.max(min, number));
}

function isoTime(value, fallback = '') {
  if (!value && !fallback) return '';
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) throw new Error('Poll timestamps must be valid ISO-compatible dates.');
  return date.toISOString();
}

function normalizeOptions(input = []) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 10) throw new Error('A poll requires 2 to 10 options.');
  const seen = new Set();
  return input.map((raw, index) => {
    const label = cleanText(typeof raw === 'object' ? raw.label : raw, 100);
    if (!label) throw new Error('Poll options cannot be blank.');
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate poll option: ${label}`);
    seen.add(key);
    return { id: `OPT-${index + 1}`, label };
  });
}

function validatePollId(value) {
  const id = String(value || '').toUpperCase();
  if (!POLL_ID_RE.test(id)) throw new Error('Poll ID must use the POLL-#### format.');
  return id;
}

function normalizeRule(value = 'plurality') {
  const rule = String(value || 'plurality').toLowerCase();
  if (!DECISION_RULES.includes(rule)) throw new Error(`Unsupported poll decision rule: ${rule}`);
  return rule;
}

function normalizeTieRule(value = 'no-decision') {
  const rule = String(value || 'no-decision').toLowerCase();
  if (!TIE_RULES.includes(rule)) throw new Error(`Unsupported poll tie rule: ${rule}`);
  return rule;
}

function normalizeVisibility(value = 'public') {
  const mode = String(value || 'public').toLowerCase();
  if (!VISIBILITY_MODES.includes(mode)) throw new Error(`Unsupported poll visibility mode: ${mode}`);
  return mode;
}

function createPollRecord(input = {}, context = {}) {
  const now = isoTime(context.now || new Date());
  const id = validatePollId(context.id || input.id);
  const question = cleanText(input.question || input.title, 240);
  if (!question) throw new Error('Poll question is required.');
  const options = normalizeOptions(input.options || []);
  const opensAt = isoTime(input.opensAt || now);
  const closesAt = isoTime(input.closesAt || new Date(new Date(opensAt).getTime() + 24 * 60 * 60_000));
  if (Date.parse(closesAt) <= Date.parse(opensAt)) throw new Error('Poll close time must be after its open time.');

  const multiSelect = input.multiSelect === true;
  const maxSelections = multiSelect
    ? integerInRange(input.maxSelections, options.length, 1, options.length)
    : 1;
  const decisionRule = normalizeRule(input.decisionRule);
  const thresholdPercent = Math.min(100, Math.max(0, finiteNumber(input.thresholdPercent, decisionRule === 'supermajority' ? 66 : 50)));
  const thresholdOptionId = String(input.thresholdOptionId || options[0].id);
  if (!options.some((option) => option.id === thresholdOptionId)) throw new Error('Threshold option must reference a poll option.');

  const requestedStatus = String(input.status || '').toLowerCase();
  const status = requestedStatus
    ? (POLL_STATUSES.includes(requestedStatus) ? requestedStatus : (() => { throw new Error(`Unsupported poll status: ${requestedStatus}`); })())
    : Date.parse(opensAt) > Date.parse(now) ? 'scheduled' : 'open';

  return {
    id,
    question,
    description: cleanText(input.description || input.context, 1800),
    options,
    creatorId: String(input.creatorId || ''),
    source: cleanText(input.source || 'manual', 80) || 'manual',
    sourceLink: cleanText(input.sourceLink || '', 500),
    guildId: String(input.guildId || ''),
    channelId: String(input.channelId || ''),
    messageId: String(input.messageId || ''),
    profile: cleanText(input.profile || 'community-pulse', 80) || 'community-pulse',
    status,
    opensAt,
    closesAt,
    visibility: normalizeVisibility(input.visibility),
    multiSelect,
    maxSelections,
    eligibleRoleIds: normalizeIds(input.eligibleRoleIds),
    excludedRoleIds: normalizeIds(input.excludedRoleIds),
    excludedUserIds: normalizeIds(input.excludedUserIds),
    excludeCreator: input.excludeCreator === true,
    minVotes: integerInRange(input.minVotes, 0, 0, 1_000_000),
    decisionRule,
    thresholdPercent,
    thresholdOptionId,
    tieRule: normalizeTieRule(input.tieRule),
    extensionMinutes: integerInRange(input.extensionMinutes, 60, 1, 7 * 24 * 60),
    reminderMinutes: normalizeReminderMinutes(input.reminderMinutes),
    remindersSent: [],
    votes: {},
    finalResult: null,
    createdAt: now,
    updatedAt: now,
    openedAt: status === 'open' ? now : '',
    closedAt: '',
    cancelledAt: '',
    cancelledBy: '',
    cancelReason: '',
    audit: [{ action: 'created', actorId: String(input.creatorId || ''), at: now }]
  };
}

function pollOptionIds(poll) {
  return new Set((poll?.options || []).map((option) => String(option.id)));
}

function publicPollRecord(poll, options = {}) {
  if (!poll) return null;
  const includeVotes = options.includeVotes === true;
  const clone = JSON.parse(JSON.stringify(poll));
  if (!includeVotes) delete clone.votes;
  return clone;
}

module.exports = {
  DECISION_RULES,
  POLL_ID_RE,
  POLL_STATUSES,
  TIE_RULES,
  VISIBILITY_MODES,
  cleanText,
  createPollRecord,
  finiteNumber,
  integerInRange,
  isoTime,
  normalizeIds,
  normalizeOptions,
  normalizeReminderMinutes,
  normalizeRule,
  normalizeTieRule,
  normalizeVisibility,
  pollOptionIds,
  publicPollRecord,
  validatePollId
};
