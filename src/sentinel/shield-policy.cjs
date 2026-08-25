'use strict';

const RISK_STATES = Object.freeze({
  NORMAL: 'normal',
  WATCH: 'watch',
  SUSPICIOUS: 'suspicious',
  QUARANTINED: 'quarantined'
});

const SECURITY_MODES = Object.freeze({
  NORMAL: 'normal',
  ELEVATED: 'elevated',
  LOCKDOWN: 'lockdown'
});

const JOIN_WINDOWS = Object.freeze({
  SHORT_MS: 60_000,
  LONG_MS: 5 * 60_000,
  ELEVATED_SHORT: 8,
  ELEVATED_LONG: 18,
  LOCKDOWN_SHORT: 20,
  LOCKDOWN_LONG: 40
});

const HIGH_RISK_ATTACHMENT_EXTENSIONS = Object.freeze([
  '.exe', '.scr', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.js', '.jse', '.msi', '.hta', '.lnk'
]);

const ARCHIVE_ATTACHMENT_EXTENSIONS = Object.freeze(['.zip', '.rar', '.7z', '.iso']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, number(value)));
}

function ageMs(timestamp, now = Date.now()) {
  const value = number(timestamp);
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, number(now, Date.now()) - value);
}

function accountAgeMs(createdTimestamp, now = Date.now()) {
  return ageMs(createdTimestamp, now);
}

function membershipAgeMs(joinedTimestamp, now = Date.now()) {
  return ageMs(joinedTimestamp, now);
}

function recentJoinCounts(timestamps = [], now = Date.now()) {
  const current = number(now, Date.now());
  const valid = (Array.isArray(timestamps) ? timestamps : [])
    .map((value) => number(value))
    .filter((value) => value > 0 && value <= current && current - value <= JOIN_WINDOWS.LONG_MS);
  return {
    last60Seconds: valid.filter((value) => current - value <= JOIN_WINDOWS.SHORT_MS).length,
    last5Minutes: valid.length
  };
}

function securityModeForJoinCounts(counts = {}) {
  const short = Math.max(0, number(counts.last60Seconds));
  const long = Math.max(0, number(counts.last5Minutes));
  if (short >= JOIN_WINDOWS.LOCKDOWN_SHORT || long >= JOIN_WINDOWS.LOCKDOWN_LONG) return SECURITY_MODES.LOCKDOWN;
  if (short >= JOIN_WINDOWS.ELEVATED_SHORT || long >= JOIN_WINDOWS.ELEVATED_LONG) return SECURITY_MODES.ELEVATED;
  return SECURITY_MODES.NORMAL;
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/\.+$/, '');
}

function extractDomains(content = '') {
  const text = String(content || '');
  const results = new Set();
  const pattern = /https?:\/\/([^\s<>()\[\]{}"']+)/gi;
  for (const match of text.matchAll(pattern)) {
    const domain = normalizeDomain(match[1]);
    if (domain) results.add(domain);
  }
  return [...results];
}

function domainMatchesBlocklist(content = '', blockedDomains = []) {
  const blocked = (Array.isArray(blockedDomains) ? blockedDomains : []).map(normalizeDomain).filter(Boolean);
  if (!blocked.length) return false;
  return extractDomains(content).some((domain) => blocked.some((item) => domain === item || domain.endsWith(`.${item}`)));
}

function attachmentRisk(attachments = []) {
  const names = (Array.isArray(attachments) ? attachments : [])
    .map((item) => String(item?.name || item || '').trim().toLowerCase())
    .filter(Boolean);
  const executable = names.some((name) => HIGH_RISK_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext)));
  const archive = names.some((name) => ARCHIVE_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext)));
  return { executable, archive };
}

function scamPattern(content = '') {
  const text = String(content || '').toLowerCase();
  if (!text) return false;
  const hasUrl = /https?:\/\//i.test(text);
  if (!hasUrl) return false;
  return [
    /free\s+(discord\s+)?nitro/,
    /nitro\s+(gift|giveaway|claim)/,
    /steam\s+(gift|giveaway|inventory|trade)/,
    /(verify|verification).{0,32}(account|discord|steam|wallet)/,
    /(scan|use).{0,20}(qr|qrcode|qr code)/,
    /(claim|redeem).{0,24}(gift|reward|prize)/,
    /(crypto|wallet).{0,24}(airdrop|verify|connect)/
  ].some((pattern) => pattern.test(text));
}

function messageSignals({ content = '', attachments = [], mentionCount = 0, blockedDomains = [], repeatedMessageCount = 0 } = {}) {
  const attachment = attachmentRisk(attachments);
  const confirmedMaliciousUrl = domainMatchesBlocklist(content, blockedDomains);
  return {
    mentionCount: Math.max(0, number(mentionCount)),
    repeatedMessageCount: Math.max(0, number(repeatedMessageCount)),
    executableAttachment: attachment.executable,
    archiveAttachment: attachment.archive,
    scamPattern: scamPattern(content),
    suspiciousLink: /https?:\/\//i.test(String(content || '')),
    confirmedMaliciousUrl
  };
}

function assessRisk(input = {}) {
  const accountAge = Math.max(0, number(input.accountAgeMs, Number.POSITIVE_INFINITY));
  const membershipAge = Math.max(0, number(input.membershipAgeMs, Number.POSITIVE_INFINITY));
  const automodActions = Math.max(0, number(input.automodActions));
  const mentionCount = Math.max(0, number(input.mentionCount));
  const repeatedMessageCount = Math.max(0, number(input.repeatedMessageCount));
  const mode = Object.values(SECURITY_MODES).includes(input.securityMode) ? input.securityMode : SECURITY_MODES.NORMAL;
  const executableAttachment = Boolean(input.executableAttachment);
  const archiveAttachment = Boolean(input.archiveAttachment);
  const scam = Boolean(input.scamPattern);
  const suspiciousLink = Boolean(input.suspiciousLink);
  const confirmedMaliciousUrl = Boolean(input.confirmedMaliciousUrl);

  let score = 0;
  const reasons = [];
  const behavioral = [];

  // Account age is context only. It can raise review priority, but can never trigger containment by itself.
  if (accountAge < 24 * 60 * 60_000) { score += 10; reasons.push('account-under-24h'); }
  else if (accountAge < 7 * 24 * 60 * 60_000) { score += 5; reasons.push('account-under-7d'); }
  if (membershipAge < 15 * 60_000) { score += 5; reasons.push('joined-under-15m'); }

  if (mode === SECURITY_MODES.ELEVATED) { score += 8; reasons.push('elevated-join-rate'); }
  if (mode === SECURITY_MODES.LOCKDOWN) { score += 16; reasons.push('lockdown-join-rate'); }

  if (automodActions > 0) {
    score += Math.min(48, automodActions * 12);
    reasons.push(`automod-${automodActions}`);
    if (automodActions >= 3) behavioral.push('repeated-automod');
  }
  if (mentionCount >= 8) { score += 25; reasons.push('mass-mentions'); behavioral.push('mass-mentions'); }
  if (repeatedMessageCount >= 4) { score += 25; reasons.push('repeated-message-spam'); behavioral.push('repeated-message-spam'); }
  if (executableAttachment) { score += 20; reasons.push('high-risk-attachment'); behavioral.push('high-risk-attachment'); }
  else if (archiveAttachment) { score += 5; reasons.push('archive-attachment'); }
  if (suspiciousLink) score += 5;
  if (scam) { score += 30; reasons.push('scam-pattern'); behavioral.push('scam-pattern'); }
  if (confirmedMaliciousUrl) { score += 80; reasons.push('blocked-malicious-domain'); behavioral.push('blocked-malicious-domain'); }

  score = clamp(score, 0, 100);
  const youngAndNew = accountAge < 24 * 60 * 60_000 && membershipAge < 15 * 60_000;
  const repeatedNativeAbuse = automodActions >= 5 && youngAndNew;
  const coordinatedSpam = mentionCount >= 10 && repeatedMessageCount >= 4;
  const multipleBehavioralSignals = new Set(behavioral).size >= 2;

  let state = RISK_STATES.NORMAL;
  let action = 'observe';
  if (confirmedMaliciousUrl || repeatedNativeAbuse || coordinatedSpam || (score >= 90 && multipleBehavioralSignals)) {
    state = RISK_STATES.QUARANTINED;
    action = 'contain';
  } else if (score >= 55 || (automodActions >= 3 && score >= 45)) {
    state = RISK_STATES.SUSPICIOUS;
    action = 'review';
  } else if (score >= 25) {
    state = RISK_STATES.WATCH;
    action = 'watch';
  }

  return {
    score,
    state,
    action,
    reasons,
    behavioralSignals: [...new Set(behavioral)],
    containmentRecommended: action === 'contain'
  };
}

module.exports = {
  RISK_STATES,
  SECURITY_MODES,
  JOIN_WINDOWS,
  HIGH_RISK_ATTACHMENT_EXTENSIONS,
  ARCHIVE_ATTACHMENT_EXTENSIONS,
  clamp,
  ageMs,
  accountAgeMs,
  membershipAgeMs,
  recentJoinCounts,
  securityModeForJoinCounts,
  normalizeDomain,
  extractDomains,
  domainMatchesBlocklist,
  attachmentRisk,
  scamPattern,
  messageSignals,
  assessRisk
};
