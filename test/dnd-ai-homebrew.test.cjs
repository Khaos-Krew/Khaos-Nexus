'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../shared/dnd-ai-homebrew-input-boundary.cjs').install();
const {
  MAX_INSPIRATION_TOTAL,
  MAX_SHORT_EXCERPT,
  MAX_SUMMARY,
  normalizeHomebrewRequest,
  previewHomebrewRequest,
  parseHomebrewResponse,
  proposalFromGeneration,
  proposalToHomebrewDraft,
  proposalAuditMetadata,
  ensureHomebrewProposalState
} = require('../shared/dnd-ai-homebrew.cjs');

function validInput(overrides = {}) {
  return {
    campaignId: 'campaign-1',
    contentType: 'subclass',
    system: 'D&D 5e-compatible',
    titleHint: 'Emberforged Savant',
    concept: 'An original artificer specialist who channels heat through defensive inventions and must balance protection with escalating risk.',
    targetTier: 'mid',
    powerLevel: 'standard',
    constraints: 'Avoid extra reactions and keep resource tracking simple.',
    inspirations: [],
    ...overrides
  };
}

function servicePayload(overrides = {}) {
  return {
    result: {
      title: 'Emberforged Savant',
      contentType: 'subclass',
      summary: 'An original heat-driven defensive artificer subclass.',
      designGoals: ['Support allies', 'Manage heat risk'],
      sections: [{ heading: 'Level 3: Ember Ward', rulesText: 'Create a protective ward with bounded uses.' }],
      mechanics: [{ name: 'Heat', description: 'Gain and spend heat.', activation: 'When using an infusion', limits: 'Maximum 3 heat', scaling: 'Maximum increases later.' }],
      balance: {
        powerBand: 'standard',
        assumptions: ['One short rest per adventuring day'],
        risks: ['Stacking defenses may slow encounters'],
        playtestChecks: ['Track effective damage prevented']
      },
      provenance: {
        inspirationLabels: ['Owner concept'],
        transformedSignals: ['defensive inventor'],
        rawTextStored: false,
        disclaimer: 'Original proposal generated from authorized high-level signals.'
      },
      originality: { status: 'original', concerns: [] },
      ...overrides
    },
    meta: { provider: 'mock', model: 'deterministic-homebrew', generatedAt: '2026-08-03T06:00:00Z', rawInspirationStored: false }
  };
}

test('homebrew request permits an original concept without inspiration records', () => {
  const normalized = normalizeHomebrewRequest(validInput());
  assert.equal(normalized.campaignId, 'campaign-1');
  assert.deepEqual(normalized.request.inspirations, []);
  assert.equal(normalized.request.contentType, 'subclass');
  assert.equal(normalized.request.targetTier, 'mid');
});

test('authorized inspiration requires confirmation and bounded summaries', () => {
  assert.throws(() => normalizeHomebrewRequest(validInput({ inspirations: [{ label: 'My notes', authorization: 'user-owned', permissionConfirmed: false, summary: 'Original notes.' }] })), /Confirm permission/i);
  assert.throws(() => normalizeHomebrewRequest(validInput({ inspirations: [{ label: 'Excerpt', authorization: 'short-excerpt', permissionConfirmed: true, summary: 'x'.repeat(MAX_SHORT_EXCERPT + 1) }] })), /700-character/i);
  assert.throws(() => normalizeHomebrewRequest(validInput({ inspirations: [{ label: 'Summary', authorization: 'summary-only', permissionConfirmed: true, summary: 'x'.repeat(MAX_SUMMARY + 1) }] })), /1800-character/i);
  const valid = normalizeHomebrewRequest(validInput({ inspirations: [{ label: 'My notes', authorization: 'user-owned', permissionConfirmed: true, summary: 'A heat-based defensive theme.', designSignals: 'heat, defense, inventor' }] }));
  assert.equal(valid.request.inspirations[0].designSignals.length, 3);
  assert.equal(valid.request.inspirations[0].confirmedRightToUse, true);
});

test('combined inspiration is capped and raw material appears only in the transient preview request', () => {
  const inspirations = Array.from({ length: 4 }, (_, index) => ({ label: `Summary ${index}`, authorization: 'summary-only', permissionConfirmed: true, summary: 'x'.repeat(1600) }));
  assert.throws(() => normalizeHomebrewRequest(validInput({ inspirations })), new RegExp(String(MAX_INSPIRATION_TOTAL)));
  const preview = previewHomebrewRequest(validInput({ inspirations: [{ label: 'Owner notes', authorization: 'user-owned', permissionConfirmed: true, summary: 'Original campaign design signal.' }] }));
  assert.match(preview.request.inspirations[0].summary, /Original campaign/);
  assert.equal(preview.policy.rawInspirationStoredLocally, false);
});

test('copy, reconstruction, OCR, and full-book requests are rejected locally', () => {
  for (const concept of [
    'Copy the complete published subclass exactly.',
    'Reconstruct the full sourcebook chapter.',
    'OCR this commercial adventure and turn it into a subclass.',
    'Replicate an identical published monster stat block.'
  ]) {
    assert.throws(() => normalizeHomebrewRequest(validInput({ concept })), /copy or closely reconstruct/i);
  }
});

test('service response becomes a private proposal without raw inspiration text', () => {
  const response = parseHomebrewResponse(servicePayload());
  const request = normalizeHomebrewRequest(validInput({ inspirations: [{ label: 'Owner concept', authorization: 'user-owned', permissionConfirmed: true, summary: 'Sensitive raw inspiration text.' }] })).request;
  const proposal = proposalFromGeneration({ campaignId: 'campaign-1', request, response });
  const serialized = JSON.stringify(proposal);
  assert.doesNotMatch(serialized, /Sensitive raw inspiration text/);
  assert.equal(proposal.result.provenance.rawTextStored, false);
  assert.equal(proposal.provider, 'mock');
  assert.equal(proposal.requestSummary.concept, validInput().concept);
});

test('proposal conversion always creates an ordinary draft and preserves review evidence', () => {
  const response = parseHomebrewResponse(servicePayload());
  const proposal = proposalFromGeneration({ campaignId: 'campaign-1', request: normalizeHomebrewRequest(validInput()).request, response });
  const draft = proposalToHomebrewDraft(proposal);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.contentType, 'subclass');
  assert.equal(draft.body.aiGenerated, true);
  assert.equal(draft.body.provenance.rawTextStored, false);
  assert.match(draft.reviewNotes, /Playtest checks/i);
});

test('needs-review originality blocks conversion until explicitly acknowledged', () => {
  const response = parseHomebrewResponse(servicePayload({ originality: { status: 'needs-review', concerns: ['Name may be too close to a known product term.'] } }));
  const proposal = proposalFromGeneration({ campaignId: 'campaign-1', request: normalizeHomebrewRequest(validInput()).request, response });
  assert.throws(() => proposalToHomebrewDraft(proposal), /Acknowledge the originality concerns/i);
  assert.equal(proposalToHomebrewDraft(proposal, { acknowledgedOriginality: true }).status, 'draft');
});

test('audit metadata excludes prompts, constraints, and raw inspiration', () => {
  const response = parseHomebrewResponse(servicePayload());
  const proposal = proposalFromGeneration({ campaignId: 'campaign-1', request: normalizeHomebrewRequest(validInput()).request, response });
  const metadata = proposalAuditMetadata(proposal);
  const serialized = JSON.stringify(metadata);
  assert.equal(metadata.rawInspirationStored, false);
  assert.doesNotMatch(serialized, /channels heat|Avoid extra reactions|sourcebook|summary/i);
});

test('proposal state is bounded and normalizes persisted proposals', () => {
  const response = parseHomebrewResponse(servicePayload());
  const proposal = proposalFromGeneration({ campaignId: 'campaign-1', request: normalizeHomebrewRequest(validInput()).request, response });
  const state = { aiHomebrewProposals: Array.from({ length: 120 }, (_, index) => ({ ...proposal, id: `proposal-${index}` })) };
  ensureHomebrewProposalState(state);
  assert.equal(state.aiHomebrewProposals.length, 100);
});

test('entry loads AI homebrew after private persistence and renderer remains explicit', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const persistence = entry.indexOf("require('./dnd-co-dm-persistence-extension.cjs').install()");
  const homebrew = entry.indexOf("require('./dnd-ai-homebrew-extension.cjs').install()");
  const uiContract = entry.indexOf("require('./dnd-ai-homebrew-ui-contract-extension.cjs').install()");
  assert.ok(persistence >= 0);
  assert.ok(homebrew > persistence);
  assert.ok(uiContract > homebrew);

  const renderer = fs.readFileSync(path.join(root, 'renderer', 'dnd-ai-homebrew.js'), 'utf8');
  assert.doesNotMatch(renderer, /setInterval/);
  assert.match(renderer, /Generate Proposal/);
  assert.match(renderer, /Convert to Homebrew Draft/);
  assert.match(renderer, /Never auto-approved/);
  assert.doesNotMatch(renderer, /dnd:homebrew-transition|status:\s*['"]approved/);
});
