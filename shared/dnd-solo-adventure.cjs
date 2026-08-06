'use strict';

const core = require('./dnd-combat-core.cjs');
const { runtime } = core;

function startSoloAdventure(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const campaignId = runtime.clean(input.campaignId, 100);
  const characterId = runtime.clean(input.characterId, 100);
  const character = (state.characters || []).find((item) => item.id === characterId && item.campaignId === campaignId && item.active !== false);
  if (!character) runtime.fail('Select an active character for solo play.', 'DND_SOLO_CHARACTER_REQUIRED');
  const profile = state.playProfiles.find((item) => item.campaignId === campaignId && item.enabled);
  if (!profile || !['solo_ai_dm', 'hybrid'].includes(profile.mode)) runtime.fail('Enable a Solo AI DM or Hybrid play profile first.', 'DND_SOLO_PROFILE_REQUIRED');

  let playerSeat = state.playerSeats.find((item) => item.campaignId === campaignId && item.characterId === characterId && item.active !== false);
  if (!playerSeat) playerSeat = runtime.upsertPlayerSeat(state, {
    campaignId, characterId, memberId: runtime.clean(input.memberId, 100), type: 'human_player',
    displayName: runtime.clean(input.displayName || character.name, 120), ready: true
  });

  const companionSeats = [];
  for (const companion of input.companions || []) {
    const companionCharacterId = runtime.clean(companion.characterId, 100);
    if (companionCharacterId && !(state.characters || []).some((item) => item.id === companionCharacterId && item.campaignId === campaignId && item.active !== false)) {
      runtime.fail(`AI companion character ${companionCharacterId} was not found.`, 'DND_SOLO_COMPANION_NOT_FOUND');
    }
    let seat = state.playerSeats.find((item) => item.campaignId === campaignId && item.characterId === companionCharacterId && item.type === 'ai_companion' && item.active !== false);
    if (!seat) seat = runtime.upsertPlayerSeat(state, {
      campaignId, characterId: companionCharacterId, type: 'ai_companion',
      displayName: runtime.clean(companion.displayName || 'AI companion', 120), ready: true
    });
    companionSeats.push({ seatId: seat.id, policy: {
      autonomy: ['full', 'tactical_orders', 'ask_before_resources'].includes(companion.policy?.autonomy) ? companion.policy.autonomy : 'tactical_orders',
      riskTolerance: ['cautious', 'balanced', 'bold'].includes(companion.policy?.riskTolerance) ? companion.policy.riskTolerance : 'balanced',
      protectPlayer: companion.policy?.protectPlayer !== false,
      allowPermanentDeath: companion.policy?.allowPermanentDeath === true
    }});
  }

  const run = runtime.startCampaignRun(state, {
    campaignId, actorId: runtime.clean(input.actorId, 100), worldTime: input.worldTime || 'Day 1', branch: input.branch || 'solo-main'
  });
  let scene = state.scenes.find((item) => item.runId === run.id && item.status === 'active');
  if (!scene) scene = runtime.startScene(state, {
    campaignId, runId: run.id, actorId: runtime.clean(input.actorId, 100),
    locationName: input.locationName || 'The Beginning', publicDescription: input.publicDescription || 'Your adventure begins.',
    worldTime: input.worldTime || run.worldTime, participantSeatIds: [playerSeat.id, ...companionSeats.map((item) => item.seatId)]
  });

  const existing = state.soloAdventures.find((item) => item.campaignId === campaignId && item.status === 'active');
  const adventure = existing || {
    id: runtime.makeId('solo_adventure'), campaignId, runId: run.id, playerSeatId: playerSeat.id,
    companionSeats, status: 'active', createdAt: runtime.nowIso(), updatedAt: runtime.nowIso()
  };
  if (existing) Object.assign(existing, { runId: run.id, playerSeatId: playerSeat.id, companionSeats, updatedAt: runtime.nowIso() });
  else state.soloAdventures.push(adventure);

  const checkpoint = runtime.createCheckpoint(state, {
    campaignId, runId: run.id, label: input.checkpointLabel || 'Solo adventure start', createdBy: input.actorId || 'owner'
  });
  return { adventure: runtime.clone(adventure), run: runtime.clone(run), scene: runtime.clone(scene), checkpoint };
}

function recordMemory(state, input = {}) {
  core.ensureSoloCombatState(state);
  runtime.assertOwnerPreview(state);
  const campaignId = runtime.clean(input.campaignId, 100);
  if (!runtime.campaignExists(state, campaignId)) runtime.fail('Campaign not found.', 'DND_RUNTIME_CAMPAIGN_NOT_FOUND');
  const memory = {
    id: runtime.clean(input.id, 100) || runtime.makeId('memory'), campaignId, runId: runtime.clean(input.runId, 100),
    text: runtime.clean(input.text, 4000),
    status: ['correct', 'incorrect', 'outdated', 'forgotten'].includes(input.status) ? input.status : 'correct',
    visibility: ['party', 'selected_characters', 'dm_only'].includes(input.visibility) ? input.visibility : 'party',
    characterIds: [...new Set((input.characterIds || []).map((item) => runtime.clean(item, 100)).filter(Boolean))],
    source: runtime.clean(input.source || 'manual', 80), createdAt: runtime.nowIso(), updatedAt: runtime.nowIso()
  };
  if (!memory.text) runtime.fail('Memory text is required.', 'DND_MEMORY_TEXT_REQUIRED');
  const existing = state.runtimeMemories.find((item) => item.id === memory.id);
  if (existing) Object.assign(existing, memory, { createdAt: existing.createdAt }); else state.runtimeMemories.push(memory);
  return runtime.clone(existing || memory);
}

module.exports = { startSoloAdventure, recordMemory };
