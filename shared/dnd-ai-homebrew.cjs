'use strict';

const crypto = require('node:crypto');

const AI_HOMEBREW_PATH = '/api/v1/homebrew/generations';
const CONTENT_TYPES = Object.freeze(['subclass', 'species', 'feat', 'spell', 'item', 'monster', 'background', 'encounter', 'setting-element']);
const TARGET_TIERS = Object.freeze(['any', 'low', 'mid', 'high', 'epic']);
const POWER_LEVELS = Object.freeze(['conservative', 'standard', 'cinematic']);
const AUTHORIZATIONS = Object.freeze(['user-owned', 'licensed', 'public-domain', 'summary-only', 'short-excerpt']);
const MAX_INSPIRATIONS = 8;
const MAX_INSPIRATION_TOTAL = 6000;
const MAX_SHORT_EXCERPT = 700;
const MAX_SUMMARY = 1800;
const MAX_DESIGN_SIGNALS = 12;
const MAX_SIGNAL_LENGTH = 240;
const MAX_CONSTRAINTS = 20;
const MAX_CONSTRAINT_LENGTH = 400;
const MAX_PROPOSALS = 100;

const COPY_REQUEST_PATTERN = /\b(verbatim|word[- ]for[- ]word|exact text|full text|entire (?:book|chapter|section)|transcribe|scan|ocr)\b|\b(copy|reproduce)\b.{0,50}\b(book|chapter|sourcebook|adventure|module|rules text|stat block)\b|\b(recreate|replicate|clone)\b.{0,50}\b(exact|identical|official|published)\b|\b(ignore|bypass|evade)\b.{0,30}\bcopyright\b/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clean(value, maximum = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maximum);
}

function cleanLine(value, maximum = 1000) {
  return clean(value, maximum).replace(/\s+/g, ' ');
}

function id(prefix = 'ai_homebrew') {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function uniqueLines(value, maximumItems, maximumLength) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(source.map((item) => cleanLine(item, maximumLength)).filter(Boolean))].slice(0, maximumItems);
}

function validationError(message, field, code = 'DND_AI_HOMEBREW_INVALID') {
  return Object.assign(new Error(message), { code, field });
}

function assertLength(value, maximum, message, field, code) {
  if (String(value ?? '').trim().length > maximum) throw validationError(message, field, code);
}

function assertOriginalRequest(input = {}) {
  const combined = [input.titleHint, input.concept]
    .concat(input.constraints || [])
    .concat((input.inspirations || []).flatMap((item) => [item.label, item.summary, ...(item.designSignals || [])]))
    .join('\n');
  if (COPY_REQUEST_PATTERN.test(combined)) {
    throw validationError('Requests to copy or closely reconstruct protected source material are not supported. Describe high-level themes and mechanics for an original design instead.', 'concept', 'DND_AI_HOMEBREW_COPY_REQUEST');
  }
  return true;
}

function normalizeInspiration(input = {}, index = 0) {
  const authorization = AUTHORIZATIONS.includes(input.authorization) ? input.authorization : '';
  const label = cleanLine(input.label, 120);
  const summaryLimit = authorization === 'short-excerpt' ? MAX_SHORT_EXCERPT : MAX_SUMMARY;
  const summary = clean(input.summary, summaryLimit);
  const confirmedRightToUse = input.confirmedRightToUse === true || input.permissionConfirmed === true;
  if (!label) throw validationError(`Inspiration ${index + 1} requires a label.`, `inspirations.${index}.label`);
  if (!authorization) throw validationError(`Choose an authorization for inspiration ${index + 1}.`, `inspirations.${index}.authorization`);
  if (!confirmedRightToUse) throw validationError(`Confirm permission for inspiration ${index + 1}.`, `inspirations.${index}.confirmedRightToUse`, 'DND_AI_HOMEBREW_PERMISSION_REQUIRED');
  if (!summary) throw validationError(`Inspiration ${index + 1} requires a bounded summary or permitted short excerpt.`, `inspirations.${index}.summary`);
  assertLength(input.label, 120, `Inspiration ${index + 1} label exceeds 120 characters.`, `inspirations.${index}.label`, 'DND_AI_HOMEBREW_INSPIRATION_TOO_LONG');
  assertLength(input.summary, summaryLimit, `Inspiration ${index + 1} exceeds the ${summaryLimit}-character ${authorization === 'short-excerpt' ? 'short-excerpt' : 'summary'} limit.`, `inspirations.${index}.summary`, 'DND_AI_HOMEBREW_INSPIRATION_TOO_LONG');
  const designSignals = uniqueLines(input.designSignals, MAX_DESIGN_SIGNALS, MAX_SIGNAL_LENGTH);
  const rawSignals = Array.isArray(input.designSignals) ? input.designSignals : String(input.designSignals || '').split(/[\r\n,]+/);
  if (rawSignals.filter((item) => String(item || '').trim()).length > MAX_DESIGN_SIGNALS) {
    throw validationError(`Inspiration ${index + 1} may contain at most ${MAX_DESIGN_SIGNALS} design signals.`, `inspirations.${index}.designSignals`, 'DND_AI_HOMEBREW_TOO_MANY_SIGNALS');
  }
  rawSignals.forEach((signal, signalIndex) => assertLength(signal, MAX_SIGNAL_LENGTH, `Design signal ${signalIndex + 1} for inspiration ${index + 1} exceeds ${MAX_SIGNAL_LENGTH} characters.`, `inspirations.${index}.designSignals.${signalIndex}`, 'DND_AI_HOMEBREW_SIGNAL_TOO_LONG'));
  return { label, authorization, confirmedRightToUse: true, summary, designSignals };
}

function normalizeConstraints(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\r\n]+/);
  const nonEmpty = raw.filter((item) => String(item || '').trim());
  if (nonEmpty.length > MAX_CONSTRAINTS) throw validationError(`Use no more than ${MAX_CONSTRAINTS} constraints.`, 'constraints', 'DND_AI_HOMEBREW_TOO_MANY_CONSTRAINTS');
  nonEmpty.forEach((item, index) => assertLength(item, MAX_CONSTRAINT_LENGTH, `Constraint ${index + 1} exceeds ${MAX_CONSTRAINT_LENGTH} characters.`, `constraints.${index}`, 'DND_AI_HOMEBREW_CONSTRAINT_TOO_LONG'));
  return nonEmpty.map((item) => clean(item, MAX_CONSTRAINT_LENGTH));
}

function normalizeHomebrewRequest(input = {}) {
  const campaignId = cleanLine(input.campaignId, 100);
  const contentType = CONTENT_TYPES.includes(input.contentType) ? input.contentType : '';
  const targetTier = TARGET_TIERS.includes(input.targetTier) ? input.targetTier : 'any';
  const powerLevel = POWER_LEVELS.includes(input.powerLevel) ? input.powerLevel : 'standard';
  const concept = clean(input.concept, 4000);
  const system = cleanLine(input.system || 'D&D 5e-compatible', 100);
  const titleHint = cleanLine(input.titleHint, 160);
  const constraints = normalizeConstraints(input.constraints);
  const rawInspirations = Array.isArray(input.inspirations) ? input.inspirations : [];
  if (!campaignId) throw validationError('Select a campaign before generating homebrew.', 'campaignId', 'DND_CAMPAIGN_REQUIRED');
  if (!contentType) throw validationError(`Choose a supported homebrew type: ${CONTENT_TYPES.join(', ')}.`, 'contentType', 'DND_AI_HOMEBREW_CONTENT_TYPE_INVALID');
  if (!concept) throw validationError('Describe the original homebrew concept.', 'concept');
  assertLength(input.concept, 4000, 'The homebrew concept must be 4,000 characters or fewer.', 'concept', 'DND_AI_HOMEBREW_CONCEPT_TOO_LONG');
  assertLength(input.system || '', 100, 'The system name must be 100 characters or fewer.', 'system', 'DND_AI_HOMEBREW_SYSTEM_TOO_LONG');
  assertLength(input.titleHint || '', 160, 'The title hint must be 160 characters or fewer.', 'titleHint', 'DND_AI_HOMEBREW_TITLE_TOO_LONG');
  if (rawInspirations.length > MAX_INSPIRATIONS) throw validationError(`Use no more than ${MAX_INSPIRATIONS} inspiration records.`, 'inspirations', 'DND_AI_HOMEBREW_TOO_MANY_INSPIRATIONS');
  const inspirations = rawInspirations.map(normalizeInspiration);
  const inspirationCharacters = inspirations.reduce((total, item) => total + item.summary.length + item.designSignals.join('').length, 0);
  if (inspirationCharacters > MAX_INSPIRATION_TOTAL) {
    throw validationError(`Combined inspiration material exceeds ${MAX_INSPIRATION_TOTAL} characters.`, 'inspirations', 'DND_AI_HOMEBREW_INSPIRATION_TOTAL_TOO_LARGE');
  }
  const request = { contentType, system, titleHint, concept, targetTier, powerLevel, constraints, inspirations };
  assertOriginalRequest(request);
  return { campaignId, request };
}

function previewHomebrewRequest(input = {}) {
  const normalized = normalizeHomebrewRequest(input);
  const requestCharacters = JSON.stringify(normalized.request).length;
  const inspirationCharacters = normalized.request.inspirations.reduce((total, item) => total + item.summary.length + item.designSignals.join('').length, 0);
  return {
    campaignId: normalized.campaignId,
    request: normalized.request,
    metrics: {
      requestCharacters,
      inspirations: normalized.request.inspirations.length,
      inspirationCharacters,
      inspirationLimit: MAX_INSPIRATION_TOTAL,
      shortExcerptLimit: MAX_SHORT_EXCERPT,
      summaryLimit: MAX_SUMMARY
    },
    policy: {
      rawInspirationStoredLocally: false,
      rawInspirationExpectedFromService: false,
      autoApproval: false,
      autoPublication: false
    }
  };
}

function normalizeStringArray(value, maximumItems = 12, maximumLength = 500) {
  return (Array.isArray(value) ? value : []).slice(0, maximumItems).map((item) => clean(item, maximumLength)).filter(Boolean);
}

function normalizeSections(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    heading: cleanLine(item?.heading, 120),
    rulesText: clean(item?.rulesText, 2500)
  })).filter((item) => item.heading || item.rulesText);
}

function normalizeMechanics(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    name: cleanLine(item?.name, 120),
    description: clean(item?.description, 1500),
    activation: clean(item?.activation, 500),
    limits: clean(item?.limits, 500),
    scaling: clean(item?.scaling, 700)
  })).filter((item) => item.name || item.description);
}

function normalizeHomebrewResult(input = {}) {
  const contentType = CONTENT_TYPES.includes(input.contentType) ? input.contentType : '';
  const title = cleanLine(input.title, 160);
  const summary = clean(input.summary, 2000);
  if (!title) throw validationError('Khaos Nexus AI returned homebrew without a title.', 'result.title', 'DND_AI_HOMEBREW_RESULT_INVALID');
  if (!contentType) throw validationError('Khaos Nexus AI returned an unsupported homebrew content type.', 'result.contentType', 'DND_AI_HOMEBREW_RESULT_INVALID');
  if (!summary) throw validationError('Khaos Nexus AI returned homebrew without a summary.', 'result.summary', 'DND_AI_HOMEBREW_RESULT_INVALID');
  const originalityStatus = input.originality?.status === 'needs-review' ? 'needs-review' : 'original';
  const powerBand = POWER_LEVELS.includes(input.balance?.powerBand) ? input.balance.powerBand : 'standard';
  return {
    title,
    contentType,
    summary,
    designGoals: normalizeStringArray(input.designGoals, 10, 500),
    sections: normalizeSections(input.sections),
    mechanics: normalizeMechanics(input.mechanics),
    balance: {
      powerBand,
      assumptions: normalizeStringArray(input.balance?.assumptions),
      risks: normalizeStringArray(input.balance?.risks),
      playtestChecks: normalizeStringArray(input.balance?.playtestChecks)
    },
    provenance: {
      inspirationLabels: normalizeStringArray(input.provenance?.inspirationLabels, MAX_INSPIRATIONS, 120),
      transformedSignals: normalizeStringArray(input.provenance?.transformedSignals, 20, 300),
      rawTextStored: false,
      disclaimer: clean(input.provenance?.disclaimer, 800)
    },
    originality: {
      status: originalityStatus,
      concerns: normalizeStringArray(input.originality?.concerns)
    }
  };
}

function parseHomebrewResponse(payload = {}) {
  const result = normalizeHomebrewResult(payload.result || payload.homebrew || payload);
  return {
    result,
    provider: cleanLine(payload.meta?.provider || payload.provider, 80),
    model: cleanLine(payload.meta?.model || payload.model, 120),
    generatedAt: payload.meta?.generatedAt || nowIso(),
    rawInspirationStored: false
  };
}

function normalizeProposal(input = {}) {
  const result = normalizeHomebrewResult(input.result || {});
  const createdAt = input.createdAt || nowIso();
  return {
    id: cleanLine(input.id, 100) || id(),
    campaignId: cleanLine(input.campaignId, 100),
    requestSummary: {
      contentType: CONTENT_TYPES.includes(input.requestSummary?.contentType) ? input.requestSummary.contentType : result.contentType,
      system: cleanLine(input.requestSummary?.system, 100),
      titleHint: cleanLine(input.requestSummary?.titleHint, 160),
      concept: clean(input.requestSummary?.concept, 4000),
      targetTier: TARGET_TIERS.includes(input.requestSummary?.targetTier) ? input.requestSummary.targetTier : 'any',
      powerLevel: POWER_LEVELS.includes(input.requestSummary?.powerLevel) ? input.requestSummary.powerLevel : 'standard',
      constraints: normalizeConstraints(input.requestSummary?.constraints)
    },
    result,
    provider: cleanLine(input.provider, 80),
    model: cleanLine(input.model, 120),
    generatedAt: input.generatedAt || createdAt,
    createdAt,
    updatedAt: input.updatedAt || createdAt
  };
}

function ensureHomebrewProposalState(state) {
  if (!state || typeof state !== 'object') throw new Error('D&D state is unavailable.');
  if (!Array.isArray(state.aiHomebrewProposals)) state.aiHomebrewProposals = [];
  state.aiHomebrewProposals = state.aiHomebrewProposals.map((item) => {
    try { return normalizeProposal(item); } catch { return null; }
  }).filter(Boolean).slice(-MAX_PROPOSALS);
  return state;
}

function proposalFromGeneration({ campaignId, request, response }) {
  return normalizeProposal({
    campaignId,
    requestSummary: {
      contentType: request.contentType,
      system: request.system,
      titleHint: request.titleHint,
      concept: request.concept,
      targetTier: request.targetTier,
      powerLevel: request.powerLevel,
      constraints: request.constraints
    },
    result: response.result,
    provider: response.provider,
    model: response.model,
    generatedAt: response.generatedAt
  });
}

function proposalToHomebrewDraft(proposalInput = {}, { acknowledgedOriginality = false } = {}) {
  const proposal = normalizeProposal(proposalInput);
  if (proposal.result.originality.status === 'needs-review' && !acknowledgedOriginality) {
    throw validationError('Acknowledge the originality concerns before converting this AI proposal into a homebrew draft.', 'acknowledgedOriginality', 'DND_AI_HOMEBREW_ORIGINALITY_ACK_REQUIRED');
  }
  const result = proposal.result;
  const reviewLines = [
    result.provenance.disclaimer,
    result.originality.concerns.length ? `Originality concerns:\n- ${result.originality.concerns.join('\n- ')}` : '',
    result.balance.risks.length ? `Balance risks:\n- ${result.balance.risks.join('\n- ')}` : '',
    result.balance.playtestChecks.length ? `Playtest checks:\n- ${result.balance.playtestChecks.join('\n- ')}` : ''
  ].filter(Boolean);
  return {
    campaignId: proposal.campaignId,
    contentType: result.contentType,
    name: result.title,
    status: 'draft',
    body: {
      description: result.summary,
      aiGenerated: true,
      designGoals: clone(result.designGoals),
      sections: clone(result.sections),
      mechanics: clone(result.mechanics),
      balance: clone(result.balance),
      provenance: clone(result.provenance),
      originality: clone(result.originality),
      generation: {
        proposalId: proposal.id,
        provider: proposal.provider,
        model: proposal.model,
        generatedAt: proposal.generatedAt,
        system: proposal.requestSummary.system,
        targetTier: proposal.requestSummary.targetTier,
        powerLevel: proposal.requestSummary.powerLevel
      }
    },
    reviewNotes: clean(reviewLines.join('\n\n'), 8000)
  };
}

function proposalAuditMetadata(proposalInput = {}) {
  const proposal = normalizeProposal(proposalInput);
  return {
    contentType: proposal.result.contentType,
    originalityStatus: proposal.result.originality.status,
    provider: proposal.provider,
    model: proposal.model,
    resultCharacters: JSON.stringify(proposal.result).length,
    inspirationLabels: proposal.result.provenance.inspirationLabels.length,
    rawInspirationStored: false
  };
}

module.exports = {
  AI_HOMEBREW_PATH,
  CONTENT_TYPES,
  TARGET_TIERS,
  POWER_LEVELS,
  AUTHORIZATIONS,
  MAX_INSPIRATIONS,
  MAX_INSPIRATION_TOTAL,
  MAX_SHORT_EXCERPT,
  MAX_SUMMARY,
  MAX_DESIGN_SIGNALS,
  MAX_SIGNAL_LENGTH,
  MAX_CONSTRAINTS,
  MAX_CONSTRAINT_LENGTH,
  COPY_REQUEST_PATTERN,
  normalizeInspiration,
  normalizeConstraints,
  normalizeHomebrewRequest,
  previewHomebrewRequest,
  normalizeHomebrewResult,
  parseHomebrewResponse,
  normalizeProposal,
  ensureHomebrewProposalState,
  proposalFromGeneration,
  proposalToHomebrewDraft,
  proposalAuditMetadata,
  assertOriginalRequest,
  clean,
  cleanLine,
  clone,
  id,
  nowIso
};
