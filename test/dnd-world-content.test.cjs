'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureWorldCollections,
  normalizeWorldRecord,
  normalizeLoot,
  normalizeContentEntry,
  saveHomebrew,
  createDesktopRoll,
  contentHash
} = require('../shared/dnd-world-content.cjs');
const {
  validateWorldDraft,
  validateLootDraft,
  validateContentDraft,
  validateHomebrewDraft,
  validateRollDraft,
  parseDetails
} = require('../renderer/dnd-world-content.js');
const { collectionForWorldType } = require('../main/dnd-world-content-extension.cjs');

test('world collections are added without replacing existing D&D state', () => {
  const state = { campaigns: [{ id: 'campaign' }], rolls: [] };
  ensureWorldCollections(state);
  assert.equal(state.campaigns.length, 1);
  for (const key of ['npcs', 'locations', 'factions', 'contentEntries', 'homebrew', 'loot', 'rolls']) assert.ok(Array.isArray(state[key]));
});

test('world records keep public summaries separate from GM notes and reveal state', () => {
  const draft = validateWorldDraft({ type: 'npc', campaignId: 'campaign', name: 'Keeper', publicSummary: 'Friendly merchant', gmNotes: 'Secret spy', revealed: false });
  const record = normalizeWorldRecord('npc', draft);
  assert.equal(record.publicSummary, 'Friendly merchant');
  assert.equal(record.gmNotes, 'Secret spy');
  assert.equal(record.revealed, false);
  assert.equal(collectionForWorldType('location'), 'locations');
});

test('loot supports shared assigned and GM-only records with positive quantities', () => {
  const value = normalizeLoot(validateLootDraft({ campaignId: 'campaign', name: 'Healing Potion', quantity: '3', shared: true, gmOnly: false }));
  assert.equal(value.quantity, 3);
  assert.equal(value.shared, true);
  assert.throws(() => validateLootDraft({ campaignId: 'campaign', name: 'Bad', quantity: 0 }), /greater than zero/);
});

test('content full text requires both a permitted origin and an explicitly licensed source', () => {
  const state = {
    sources: [
      { id: 'srd', isFullTextAllowed: true },
      { id: 'link', isFullTextAllowed: false }
    ]
  };
  const allowed = normalizeContentEntry(state, validateContentDraft({ sourceId: 'srd', name: 'Rule', contentOrigin: 'srd', fullText: 'Licensed text.' }));
  assert.equal(allowed.fullText, 'Licensed text.');
  assert.equal(allowed.contentHash.length, 64);
  assert.equal(allowed.contentHash, contentHash({
    sourceId: allowed.sourceId, contentType: allowed.contentType, name: allowed.name,
    summary: allowed.summary, fullText: allowed.fullText, contentOrigin: allowed.contentOrigin,
    externalReferenceUrl: allowed.externalReferenceUrl
  }));
  assert.throws(() => normalizeContentEntry(state, { sourceId: 'link', name: 'No', contentOrigin: 'external_link', fullText: 'Blocked' }), (error) => error.code === 'DND_CONTENT_FULL_TEXT_RESTRICTED');
  assert.throws(() => normalizeContentEntry(state, { sourceId: 'link', name: 'No', contentOrigin: 'user_authored', fullText: 'Blocked' }), (error) => error.code === 'DND_SOURCE_FULL_TEXT_RESTRICTED');
});

test('approved homebrew remains immutable and edits create a draft revision', () => {
  const state = { homebrew: [] };
  let result = saveHomebrew(state, validateHomebrewDraft({ campaignId: 'campaign', name: 'Storm Blade', contentType: 'item', description: 'Draft' }), 'owner');
  const id = result.record.id;
  result = saveHomebrew(state, { ...result.record, status: 'submitted' }, 'owner');
  result = saveHomebrew(state, { ...result.record, status: 'under_review' }, 'owner');
  result = saveHomebrew(state, { ...result.record, status: 'approved' }, 'owner');
  assert.equal(result.record.approvedBy, 'owner');
  assert.ok(result.record.approvedAt);
  assert.deepEqual(result.record.submittedSnapshot, { description: 'Draft' });
  const revision = saveHomebrew(state, { ...result.record, name: 'Storm Blade Revised', body: { description: 'Changed' } }, 'owner');
  assert.equal(revision.createdRevision, true);
  assert.equal(revision.record.status, 'draft');
  assert.equal(revision.record.revision, 2);
  assert.notEqual(revision.record.id, id);
  assert.equal(state.homebrew.find((item) => item.id === id).status, 'approved');
});

test('homebrew lifecycle rejects invalid transitions and preserves submitted snapshots', () => {
  const state = { homebrew: [] };
  const draft = saveHomebrew(state, { campaignId: 'campaign', name: 'Spell', body: { description: 'One' }, status: 'draft' }, 'owner').record;
  assert.throws(() => saveHomebrew(state, { ...draft, status: 'approved' }, 'owner'), (error) => error.code === 'DND_HOMEBREW_TRANSITION_INVALID');
  const submitted = saveHomebrew(state, { ...draft, status: 'submitted' }, 'owner').record;
  assert.deepEqual(submitted.submittedSnapshot, { description: 'One' });
});

test('desktop dice uses strict notation, persists individual rolls, and rejects blind rolls', () => {
  const values = [4, 18];
  const state = { rolls: [] };
  const record = createDesktopRoll(state, validateRollDraft({ campaignId: 'campaign', expression: '2d20kh1+5', privacy: 'dm_only' }), 'owner', () => values.shift());
  assert.deepEqual(record.rolls, [4, 18]);
  assert.deepEqual(record.keptIndexes, [1]);
  assert.equal(record.total, 23);
  assert.equal(record.privacy, 'dm_only');
  assert.equal(record.parserVersion, '1');
  assert.equal(state.rolls.length, 1);
  assert.throws(() => createDesktopRoll(state, { campaignId: 'campaign', expression: 'd20', privacy: 'blind' }, 'owner'), (error) => error.code === 'MISSING_DM_ROLL_DESTINATION');
  assert.throws(() => createDesktopRoll(state, { campaignId: 'campaign', expression: 'eval(1)', privacy: 'public' }, 'owner'), (error) => error.code === 'INVALID_DICE_EXPRESSION');
});

test('homebrew details require an object-shaped JSON value', () => {
  assert.deepEqual(parseDetails('{"damage":"1d8"}'), { damage: '1d8' });
  assert.throws(() => parseDetails('[1,2]'), /must be an object/);
  assert.throws(() => parseDetails('{bad'), /valid JSON/);
});

test('production startup loads final workflow after core workflow and before access policy', () => {
  const source = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const core = source.indexOf("require('./dnd-owner-workflows-extension.cjs').install()");
  const world = source.indexOf("require('./dnd-world-content-extension.cjs').install()");
  const access = source.indexOf("require('./dnd-access-policy-extension.cjs').install()");
  assert.ok(core >= 0 && core < world && world < access);
});

test('world/content extension exposes only Owner-audited mutation channels', () => {
  const source = fs.readFileSync(require.resolve('../main/dnd-world-content-extension.cjs'), 'utf8');
  for (const channel of ['dnd:world-save', 'dnd:loot-save', 'dnd:content-save', 'dnd:homebrew-save', 'dnd:dice-roll']) assert.match(source, new RegExp(channel));
  assert.match(source, /assertOwner/);
  assert.match(source, /appendDndAudit/);
  assert.doesNotMatch(source, /botToken|discordToken/);
});

test('renderer includes actual World Loot Library Homebrew and Dice surfaces', () => {
  const source = fs.readFileSync(require.resolve('../renderer/dnd-world-content.js'), 'utf8');
  for (const label of ['World', 'Loot', 'Library', 'Dice', 'Create Homebrew', 'Roll dice']) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /placeholder data/i);
});
