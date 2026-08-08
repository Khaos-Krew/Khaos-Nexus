'use strict';
const crypto = require('node:crypto');
const MODES = Object.freeze(['solo_ai_dm','group_ai_dm','human_dm','human_dm_with_ai','hybrid']);
const PACES = Object.freeze(['live','asynchronous','mixed']);
const AUTOMATION_LEVELS = Object.freeze(['suggestions_only','narration_and_npcs','automatic_checks','automatic_combat','full_ai_dm']);
const SEAT_TYPES = Object.freeze(['human_player','human_dm','assistant_dm','ai_companion','viewer']);
const NARRATIVE_EVENT_TYPES = new Set(['scene.updated','world.time.advanced','quest.stage.advanced','knowledge.learned']);
const EVENT_TYPES = new Set([...NARRATIVE_EVENT_TYPES,'character.hp.changed','character.condition.applied','character.condition.removed','inventory.item.added','inventory.item.removed']);
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const clean = (value,max=4000) => String(value ?? '').replace(/\u0000/g,'').trim().slice(0,max);
const stableHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (message,code='DND_RUNTIME_INVALID') => { throw Object.assign(new Error(message),{code}); };
function ensureCampaignRuntimeState(state={}) {
  state.runtimeSchemaVersion=1;
  state.runtimeGate={status:state.runtimeGate?.status==='owner_preview'?'owner_preview':'development_only',enabledBy:clean(state.runtimeGate?.enabledBy,100),enabledAt:state.runtimeGate?.enabledAt||'',releaseAuthorized:true};
  for(const key of ['playProfiles','playerSeats','campaignRuns','scenes','turnCycles','stateEvents','checkpoints','knowledgeRecords','runtimeInventory','soloAdventures','runtimeCombats','runtimeMemories','groupSessions','groupRounds','groupDecisions','groupDeliveries']) if(!Array.isArray(state[key])) state[key]=[];
  return state;
}
function assertOwnerPreview(state){ensureCampaignRuntimeState(state);if(state.runtimeGate.status!=='owner_preview')fail('The Owner must enable the D&D campaign runtime before using it.','DND_RUNTIME_ENABLE_REQUIRED');}
function enableOwnerPreview(state,actorId='local-owner'){ensureCampaignRuntimeState(state);state.runtimeGate={status:'owner_preview',enabledBy:clean(actorId,100),enabledAt:nowIso(),releaseAuthorized:true};return clone(state.runtimeGate);}
function campaignExists(state,campaignId){return (state.campaigns||[]).some((item)=>item.id===campaignId&&item.active!==false);}
module.exports={MODES,PACES,AUTOMATION_LEVELS,SEAT_TYPES,NARRATIVE_EVENT_TYPES,EVENT_TYPES,clone,nowIso,makeId,clean,stableHash,fail,ensureCampaignRuntimeState,assertOwnerPreview,enableOwnerPreview,campaignExists};
