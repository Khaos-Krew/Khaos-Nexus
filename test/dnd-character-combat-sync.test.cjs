'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../shared/dnd-campaign-runtime.cjs');
const solo = require('../shared/dnd-solo-combat.cjs');

function activeCombatState() {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    members: [{ id: 'member-1', campaignId: 'campaign-1', displayName: 'Kirito', role: 'player', active: true }],
    characters: [{
      id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true,
      hp: 20, maxHp: 20, armorClass: 16, initiativeModifier: 2, conditions: [], spellSlots: { 1: 2 }
    }],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
  solo.ensureSoloCombatState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, {campaignId:'campaign-1',enabled:true,mode:'solo_ai_dm',pace:'live',automationLevel:'automatic_combat'});
  const adventure = solo.startSoloAdventure(state, {campaignId:'campaign-1',characterId:'hero',actorId:'owner',locationName:'Forge Gate',publicDescription:'Ash falls.'});
  const combat = solo.startCombat(state, {
    campaignId:'campaign-1',runId:adventure.run.id,sceneId:adventure.scene.id,actorId:'owner',clientCombatId:'character-sync-combat',
    combatants:[
      { id:'hero-c',characterId:'hero',actorType:'player',name:'Vorkesh',hp:20,maxHp:20,initiativeRoll:20 },
      { id:'enemy-c',actorType:'enemy',name:'Ash Wraith',hp:12,maxHp:12,initiativeRoll:1 }
    ]
  }, () => 0.5).combat;
  return { state, combat };
}

function knockHeroOut(state, combatId) {
  const persistedCombat = state.runtimeCombats.find((item) => item.id === combatId);
  const combatant = persistedCombat.combatants.find((item) => item.id === 'hero-c');
  const character = state.characters.find((item) => item.id === 'hero');
  combatant.currentHp = 0;
  if (!combatant.conditions.includes('unconscious')) combatant.conditions.push('unconscious');
  character.hp = 0;
  if (!character.conditions.includes('unconscious')) character.conditions.push('unconscious');
  return { combatant, character };
}

test('natural twenty death save synchronizes revived HP and consciousness to the canonical character', () => {
  const { state, combat } = activeCombatState();
  const { combatant, character } = knockHeroOut(state, combat.id);
  const result = solo.resolveDeathSave(state, {combatId:combat.id,combatantId:'hero-c',idempotencyKey:'natural-20-recovery'}, () => 0.999999);
  assert.equal(result.natural,20); assert.equal(combatant.currentHp,1); assert.equal(character.hp,1);
  assert.equal(combatant.conditions.includes('unconscious'),false); assert.equal(character.conditions.includes('unconscious'),false);
  assert.equal(state.stateEvents.filter((item)=>item.idempotencyKey==='natural-20-recovery:revive').length,1);
  assert.equal(state.stateEvents.filter((item)=>item.idempotencyKey==='natural-20-recovery:conscious').length,1);
  const duplicate=solo.resolveDeathSave(state,{combatId:combat.id,combatantId:'hero-c',idempotencyKey:'natural-20-recovery'},()=>0);
  assert.equal(duplicate.natural,20); assert.equal(character.hp,1); assert.equal(character.conditions.includes('unconscious'),false);
  assert.equal(state.stateEvents.filter((item)=>item.idempotencyKey==='natural-20-recovery:conscious').length,1);
});

test('revived character and combatant remain synchronized after a persisted restart round trip', () => {
  const { state, combat } = activeCombatState(); knockHeroOut(state, combat.id);
  solo.resolveDeathSave(state,{combatId:combat.id,combatantId:'hero-c',idempotencyKey:'restart-natural-20-recovery'},()=>0.999999);
  const reloaded=JSON.parse(JSON.stringify(state)); runtime.ensureCampaignRuntimeState(reloaded); solo.ensureSoloCombatState(reloaded);
  const restoredCombat=reloaded.runtimeCombats.find((item)=>item.id===combat.id); const restoredCombatant=restoredCombat.combatants.find((item)=>item.id==='hero-c'); const restoredCharacter=reloaded.characters.find((item)=>item.id==='hero');
  assert.equal(restoredCombat.status,'active'); assert.equal(restoredCombatant.currentHp,1); assert.equal(restoredCharacter.hp,1);
  assert.equal(restoredCombatant.conditions.includes('unconscious'),false); assert.equal(restoredCharacter.conditions.includes('unconscious'),false);
  assert.equal(reloaded.stateEvents.filter((item)=>item.idempotencyKey==='restart-natural-20-recovery:revive').length,1);
  assert.equal(reloaded.stateEvents.filter((item)=>item.idempotencyKey==='restart-natural-20-recovery:conscious').length,1);
  const replay=solo.resolveDeathSave(reloaded,{combatId:combat.id,combatantId:'hero-c',idempotencyKey:'restart-natural-20-recovery'},()=>0);
  assert.equal(replay.natural,20); assert.equal(restoredCharacter.hp,1); assert.equal(restoredCharacter.conditions.includes('unconscious'),false);
  assert.equal(reloaded.stateEvents.filter((item)=>item.idempotencyKey==='restart-natural-20-recovery:revive').length,1);
  assert.equal(reloaded.stateEvents.filter((item)=>item.idempotencyKey==='restart-natural-20-recovery:conscious').length,1);
});

test('linked character spell slots hydrate into combat and spent slots survive restart without duplicate consumption', () => {
  const { state, combat } = activeCombatState();
  const liveCombat = state.runtimeCombats.find((item) => item.id === combat.id);
  const heroCombatant = liveCombat.combatants.find((item) => item.id === 'hero-c');
  const hero = state.characters.find((item) => item.id === 'hero');
  assert.equal(heroCombatant.spellSlots[1], 2);

  const cast = solo.castSpell(state, {combatId:combat.id,actorId:'hero-c',spellName:'Shield of Embers',level:1,idempotencyKey:'cast-level-one'});
  assert.equal(cast.level,1); assert.equal(heroCombatant.spellSlots[1],1); assert.equal(hero.spellSlots[1],1);
  assert.equal(state.stateEvents.filter((item)=>item.idempotencyKey==='cast-level-one:slot:1').length,1);

  const reloaded=JSON.parse(JSON.stringify(state)); runtime.ensureCampaignRuntimeState(reloaded); solo.ensureSoloCombatState(reloaded);
  const restoredCombatant=reloaded.runtimeCombats.find((item)=>item.id===combat.id).combatants.find((item)=>item.id==='hero-c');
  const restoredHero=reloaded.characters.find((item)=>item.id==='hero');
  assert.equal(restoredCombatant.spellSlots[1],1); assert.equal(restoredHero.spellSlots[1],1);

  const replay=solo.castSpell(reloaded,{combatId:combat.id,actorId:'hero-c',spellName:'Shield of Embers',level:1,idempotencyKey:'cast-level-one'});
  assert.equal(replay.level,1); assert.equal(restoredCombatant.spellSlots[1],1); assert.equal(restoredHero.spellSlots[1],1);
  assert.equal(reloaded.stateEvents.filter((item)=>item.idempotencyKey==='cast-level-one:slot:1').length,1);
});

test('canonical linked-character resources override stale caller payloads when combat starts', () => {
  const state = {
    campaigns: [{ id: 'campaign-1', name: 'Emberfall', status: 'active', active: true }],
    characters: [{
      id: 'hero', campaignId: 'campaign-1', name: 'Vorkesh', active: true,
      hp: 7, maxHp: 20, armorClass: 16, initiativeModifier: 2,
      conditions: ['poisoned'], spellSlots: { 1: 1 }, savingThrows: { constitution: 5 }
    }],
    quests: [], loot: [], encounters: [], combatants: [], sessions: [], aiGmSessions: []
  };
  solo.ensureSoloCombatState(state);
  runtime.enableOwnerPreview(state, 'owner');
  runtime.upsertPlayProfile(state, {campaignId:'campaign-1',enabled:true,mode:'solo_ai_dm',pace:'live',automationLevel:'automatic_combat'});
  const adventure = solo.startSoloAdventure(state, {campaignId:'campaign-1',characterId:'hero',actorId:'owner',locationName:'Forge Gate',publicDescription:'Ash falls.'});
  const combat = solo.startCombat(state, {
    campaignId:'campaign-1',runId:adventure.run.id,sceneId:adventure.scene.id,actorId:'owner',clientCombatId:'canonical-authority-combat',
    combatants:[
      {
        id:'hero-c',characterId:'hero',actorType:'player',name:'Vorkesh',initiativeRoll:20,
        hp:20,maxHp:20,spellSlots:{1:9},savingThrows:{constitution:-10},conditions:['blessed']
      },
      { id:'enemy-c',actorType:'enemy',name:'Ash Wraith',hp:12,maxHp:12,initiativeRoll:1 }
    ]
  }, () => 0.5).combat;
  const heroCombatant = state.runtimeCombats.find((item)=>item.id===combat.id).combatants.find((item)=>item.id==='hero-c');
  assert.equal(heroCombatant.currentHp,7);
  assert.equal(heroCombatant.maxHp,20);
  assert.equal(heroCombatant.spellSlots[1],1);
  assert.equal(heroCombatant.savingThrows.constitution,5);
  assert.deepEqual(new Set(heroCombatant.conditions),new Set(['poisoned','blessed']));
});