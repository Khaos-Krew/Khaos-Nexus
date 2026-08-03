'use strict';

const crypto = require('node:crypto');

const AI_HOMEBREW_PATH = '/api/v1/homebrew/generations';
const CONTENT_TYPES = Object.freeze(['class', 'subclass', 'species', 'background', 'feat', 'spell', 'item', 'monster', 'rule-module', 'other']);
const TARGET_TIERS = Object.freeze(['none', 'tier-1', 'tier-2', 'tier-3', 'tier-4']);
const POWER_LEVELS = Object.freeze(['low', 'standard', 'high']);
const AUTHORIZATIONS = Object.freeze(['user-owned', 'licensed', 'public-domain', 'summary-only', 'short-excerpt']);
const MAX_INSPIRATIONS = 8;
const MAX_INSPIRATION_TOTAL = 6000;
const MAX_SHORT_EXCERPT = 700;
const MAX_SUMMARY = 1800;
const MAX_DESIGN_SIGNALS = 12;
const MAX_SIGNAL_LENGTH = 300;
const MAX_PROPOSALS = 100;

const COPY_REQUEST_PATTERN = /\b(copy|recreate|reconstruct|replicate|trace|transcribe|ocr|scan|duplicate|clone|verbatim|word[- ]for[- ]word|identical)\b.{0,80}\b(book|sourcebook|module|adventure|map|class|subclass|spell|item|monster|stat block|rules?|text|chapter|table|content|published|commercial)\b|\b(full|entire|complete)\b.{0,40}\b(book|sourcebook|chapter|module|adventure|rules?|text|stat block)\b/i;

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

function uniqueLines(value, maximumItems = MAX_DESIGN_SIGNALS, maximumLength = MAX_SIGNAL_LENGTH) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\r\n,]+/);
  return [...new Set(source.map((item) => cleanLine(item, maximumLength)).filter(Boolean))].slice(0, maximumItems);
}

function validationError(message, field, code = 'DND_AI_HOMEBREW_INVALID') {
  return Object.assign(new Error(message), { code, field });
}

function assertOriginalRequest(input = {}) {
  const combined = [input.titleHint, input.concept, input.constraints]
    .concat((input.inspirations || []).flatMap((item) => [item.label, item.summary]))
    .join('\n');
  if (COPY_REQUEST_PATTERN.test(combined)) {
    throw validationError('AI homebrew can use original concepts and authorized high-level inspiration, but it cannot copy or reconstruct published material.', 'concept', 'DND_AI_HOMEBREW_COPY_REQUEST');
  }
  return true;
}

function normalizeInspiration(input = {}, index = 0) {
  const authorization = AUTHORIZATIONS.includes(input.authorization) ? input.authorization : '';
  const label = cleanLine(input.label, 180);
  const summaryLimit = authorization === 'short-excerpt' ? MAX_SHORT_EXCERPT : MAX_SUMMARY;
  const summary = clean(input.summary, summaryLimit);
  if (!label) throw validationError(`Inspiration ${index + 1} requires a label.`, `inspirations.${index}.label`);
  if (!authorization) throw validationError(`Choose an authorization for inspiration ${index + 1}.`, `inspirations.${index}.authorization`);
  if (!input.permissionConfirmed) throw validationError(`Confirm permission for inspiration ${index + 1}.`, `inspirations.${index}.permissionConfirmed`, 'DND_AI_HOMEBREW_PERMISSION_REQUIRED');
  if (!summary) throw validationError(`Inspiration ${index + 1} requires a bounded summary or permitted short excerpt.`, `inspirations.${index}.summary`);
  if (String(input.summary || '').trim().length > summaryLimit) {
    throw validationError(`Inspiration ${index + 1} exceeds the ${summaryLimit}-character ${authorization === 'short-excerpt' ? 'short-excerpt' : 'summary'} limit.`, `inspirations.${index}.summary`, 'DND_AI_HOMEBREW_INSPIRATION_TOO_LONG');
  }
  return {
    label,
    authorization,
    permissionConfirmed: true,
    summary,
    designSignals: uniqueLines(input.designSignals)
  };
}

function normalizeHomebrewRequest(input = {}) {
  const campaignId = cleanLine(input.campaignId, 100);
  const contentType = CONTENT_TYPES.includes(input.contentType) ? input.contentType : 'other';
  const targetTier = TARGET_TIERS.includes(input.targetTier) ? input.targetTier : 'none';
  const powerLevel = POWER_LEVELS.includes(input.powerLevel) ? input.powerLevel : 'standard';
  const concept = clean(input.concept, 6000);
  const system = cleanLine(input.system || 'D&D 5e-compatible', 120);
  const titleHint = cleanLine(input.titleHint, 180);
  const constraints = clean(input.constraints, 3000);
  const rawInspirations = Array.isArray(input.inspirations) ? input.inspirations.filter((item) => item && Object.values(item).some((value) => String(value ?? '').trim())) : [];
  if (!campaignId) throw validationError('Select a campaign before generating homebrew.', 'campaignId', 'DND_CAMPAIGN_REQUIRED');
  if (!concept) throw validationError('Describe the original homebrew concept.', 'concept');
  if (rawInspirations.length > MAX_INSPIRATIONS) throw validationError(`Use no more than ${MAX_INSPIRATIONS} inspiration records.`, 'inspirations', 'DND_AI_HOMEBREW_TOO_MANY_INSPIRATIONS');
  const inspirations = rawInspirations.map(normalizeInspiration);
  const inspirationCharacters = inspirations.reduce((total, item) => total + item.summary.length + item.designSignals.join('').length, 0);
  if (inspirationCharacters > MAX_INSPIRATION_TOTAL) {
    throw validationError(`Combined inspiration material exceeds ${MAX_INSPIRATION_TOTAL} characters.`, 'inspirations', 'DND_AI_HOMEBREW_INSPIRATION_TOTAL_TOO_LARGE');
  }
  const request = {
    contentType,
    system,
    titleHint,
    concept,
    targetTier,
    powerLevel,
    constraints,
    inspirations
  };
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

function normalizeStringArray(value, maximumItems = 30, maximumLength = 2000) {
  return (Array.isArray(value) ? value : []).slice(0, maximumItems).map((item) => clean(item, maximumLength)).filter(Boolean);
}

function normalizeSections(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    heading: cleanLine(item?.heading, 180),
    rulesText: clean(item?.rulesText, 12000)
  })).filter((item) => item.heading || item.rulesText);
}

function normalizeMechanics(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => ({
    name: cleanLine(item?.name, 180),
    description: clean(item?.description, 5000),
    activation: clean(item?.activation, 3000),
    limits: clean(item?.limits, 3000),
    scaling: clean(item?.scaling, 3000)
  })).filter((item) => item.name || item.description);
}

function normalizeHomebrewResult(input = {}) {
  const contentType = CONTENT_TYPES.includes(input.contentType) ? input.contentType : 'other';
  const title = cleanLine(input.title, 180);
  const summary = clean(input.summary, 8000);
  if (!title) throw validationError('Khaos Nexus AI returned homebrew without a title.', 'result.title', 'DND_AI_HOMEBREW_RESULT_INVALID');
  if (!summary) throw validationError('Khaos Nexus AI returned homebrew without a summary.', 'result.summary', 'DND_AI_HOMEBREW_RESULT_INVALID');
  const originalityStatus = input.originality?.status === 'needs-review' ? 'needs-review' : 'original';
  return {
    title,
    contentType,
    summary,
    designGoals: normalizeStringArray(input.designGoals, 20, 2000),
    sections: normalizeSections(input.sections),
    mechanics: normalizeMechanics(input.mechanics),
    balance: {
      powerBand: cleanLine(input.balance?.powerBand, 80),
      assumptions: normalizeStringArray(input.balance?.assumptions, 30, 2000),
      risks: normalizeStringArray(input.balance?.risks, 30, 2000),
      playtestChecks: normalizeStringArray(input.balance?.playtestChecks, 30, 2000)
    },
    provenance: {
      inspirationLabels: normalizeStringArray(input.provenance?.inspirationLabels, MAX_INSPIRATIONS, 180),
      transformedSignals: normalizeStringArray(input.provenance?.transformedSignals, 30, 1000),
      rawTextStored: false,
      disclaimer: clean(input.provenance?.disclaimer, 4000)
    },
    originality: {
      status: originalityStatus,
      concerns: normalizeStringArray(input.originality?.concerns, 30, 2000)
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
      system: cleanLine(input.requestSummary?.system, 120),
      titleHint: cleanLine(input.requestSummary?.titleHint, 180),
      concept: clean(input.requestSummary?.concept, 6000),
      targetTier: TARGET_TIERS.includes(input.requestSummary?.targetTier) ? input.requestSummary.targetTier : 'none',
      powerLevel: POWER_LEVELS.includes(input.requestSummary?.powerLevel) ? input.requestSummary.powerLevel : 'standard',
      constraints: clean(input.requestSummary?.constraints, 3000)
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

function mapContentType(contentType) {
  if (contentType === 'rule-module') return 'rule';
  return contentType === 'species' ? 'species' : CONTENT_TYPES.includes(contentType) ? contentType : 'other';
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
    contentType: mapContentType(result.contentType),
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
  COPY_REQUEST_PATTERN,
  normalizeInspiration,
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
