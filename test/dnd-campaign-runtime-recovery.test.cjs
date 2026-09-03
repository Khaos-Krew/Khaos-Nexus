'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');

function recoveryState() {
  return {
    campaigns: [{ id: 'campaign-1', active: true }],
    campaignRuns: [{
      id: 'run-1', campaignId: 'campaign-1', status: 'active',
      currentSceneId: 'missing-scene', currentTurnCycleId: 'missing-turn'
    }],
    scenes: [
      { id: 'scene-old', campaignId: 'campaign-1', runId: 'run-1', status: 'completed' },
      { id: 'scene-live', campaignId: 'campaign-1', runId: 'run-1', status: 'active' }
    ],
    turnCycles: [
      { id: 'turn-old', campaignId: 'campaign-1', runId: 'run-1', sceneId: 'scene-old', status: 'completed' },
      { id: 'turn-live', campaignId: 'campaign-1', runId: 'run-1', sceneId: 'scene-live', status: 'locked' }
    ]
  };
}

test('runtime recovery repairs stale active run scene and turn pointers', () => {
  const state = recoveryState();
  runtime.ensureCampaignRuntimeState(state);
  assert.equal(state.campaignRuns[0].currentSceneId, 'scene-live');
  assert.equal(state.campaignRuns[0].currentTurnCycleId, 'turn-live');
});

test('runtime recovery never revives a turn whose scene is no longer active', () => {
  const state = recoveryState();
  state.turnCycles[1].sceneId = 'scene-old';
  runtime.ensureCampaignRuntimeState(state);
  assert.equal(state.campaignRuns[0].currentSceneId, 'scene-live');
  assert.equal(state.campaignRuns[0].currentTurnCycleId, '');
});

test('runtime recovery prefers the live turn scene over a stale but still-active scene pointer', () => {
  const state = recoveryState();
  state.scenes.push({ id: 'scene-other', campaignId: 'campaign-1', runId: 'run-1', status: 'active' });
  state.campaignRuns[0].currentSceneId = 'scene-other';
  state.campaignRuns[0].currentTurnCycleId = 'turn-live';
  runtime.ensureCampaignRuntimeState(state);
  assert.equal(state.campaignRuns[0].currentSceneId, 'scene-live');
  assert.equal(state.campaignRuns[0].currentTurnCycleId, 'turn-live');
});

test('runtime recovery is campaign and run scoped', () => {
  const state = recoveryState();
  state.scenes.push({ id: 'foreign-scene', campaignId: 'campaign-2', runId: 'run-1', status: 'active' });
  state.turnCycles.push({ id: 'foreign-turn', campaignId: 'campaign-2', runId: 'run-1', sceneId: 'foreign-scene', status: 'collecting' });
  state.campaignRuns[0].currentSceneId = 'foreign-scene';
  state.campaignRuns[0].currentTurnCycleId = 'foreign-turn';
  runtime.ensureCampaignRuntimeState(state);
  assert.equal(state.campaignRuns[0].currentSceneId, 'scene-live');
  assert.equal(state.campaignRuns[0].currentTurnCycleId, 'turn-live');
});

test('runtime recovery does not rewrite historical completed run pointers', () => {
  const state = recoveryState();
  state.campaignRuns[0].status = 'completed';
  runtime.ensureCampaignRuntimeState(state);
  assert.equal(state.campaignRuns[0].currentSceneId, 'missing-scene');
  assert.equal(state.campaignRuns[0].currentTurnCycleId, 'missing-turn');
});

test('packaged runtime normalizes and persists recovered pointers during ConfigStore construction', () => {
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'dnd-campaign-runtime-extension.cjs'), 'utf8');
  const campaignExtension = fs.readFileSync(path.join(__dirname, '..', 'main', 'dnd-campaign-extension.cjs'), 'utf8');
  assert.match(extension, /constructor\(\.\.\.args\)[\s\S]*super\(\.\.\.args\)[\s\S]*this\.mutateDnd\(\(state\) => \{ runtime\.ensureCampaignRuntimeState\(state\); return true; \}\)/);
  assert.match(campaignExtension, /mutateDnd\(mutator\)[\s\S]*const result = mutator\(this\.config\.dnd\)[\s\S]*this\.saveConfig\(\)/);
});
