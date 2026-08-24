'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { blockedButtonSummary, exactRoleCandidates } = require('../src/sentinel/aliased-self-role-manager.cjs');

function button(label, customId) {
  return { type: 2, label, custom_id: customId };
}

test('duplicate exact role diagnostics keep ids and hierarchy metadata visible without choosing one', () => {
  const roles = [
    { id: '111111111111111111', name: 'PC', position: 12, editable: true, managed: false },
    { id: '222222222222222222', name: 'PC', position: 5, editable: true, managed: false }
  ];
  assert.equal(exactRoleCandidates('PC', roles).length, 2);
  const summary = blockedButtonSummary({
    components: [{ type: 1, components: [button('PC', 'legacy:platform:pc')] }]
  }, ['PC'], roles);
  assert.match(summary, /legacy:platform:pc/);
  assert.match(summary, /111111111111111111/);
  assert.match(summary, /222222222222222222/);
  assert.match(summary, /pos=12/);
});

test('unrelated labels are not included in a blocked-button diagnostic', () => {
  const summary = blockedButtonSummary({
    components: [{ type: 1, components: [button('PC', 'legacy:pc'), button('Xbox', 'legacy:xbox')] }]
  }, ['PC'], [{ id: '1', name: 'PC', position: 1 }]);
  assert.match(summary, /PC/);
  assert.doesNotMatch(summary, /Xbox/);
});
