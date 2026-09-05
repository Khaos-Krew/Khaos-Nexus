'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {CONFIG} = require('../src/sentinel/ark-dino-cache-engine.cjs');
const {saddleReward,parseSaddle,submitSaddle,TIERS} = require('../src/sentinel/ark-cache-saddles.cjs');
const {deliverSaddle} = require('../src/sentinel/ark-dino-box-delivery-worker.cjs');
const secret='s'.repeat(32);
test('all configured species have an explicit saddle decision and stable quality',()=>{
 for(const entry of Object.values(CONFIG.groups).flat()) {
   const first=saddleReward(entry.name,secret,'purchase');
   assert.deepEqual(first,saddleReward(entry.name,secret,'purchase'));
   if(first) {assert.ok(TIERS.includes(first.quality));assert.equal(first.quantity,1);assert.equal(first.species,entry.name);}
 }
 assert.equal(saddleReward('Oasisaur',secret,'p'),null);
 assert.throws(()=>saddleReward('unknown',secret,'p'));
 assert.throws(()=>parseSaddle({species:'Rex',quality:'ASCENDANT',quantity:1}));
});
test('all four quality tiers can occur, without exceeding Mastercraft',()=>{
 const results=new Set(Array.from({length:1000},(_,i)=>saddleReward('Rex',secret,String(i)).quality));
 assert.deepEqual([...results].sort(),[...TIERS].sort());
});
test('saddle adapter binds acknowledgement to the order and only accepts delivered',async()=>{
 const row={id:'order',player_eos_id:'player',delivery_server_id:'ark_gen1',saddle_reward:saddleReward('Rex',secret,'p')};
 const options={env:{NEXUS_CACHE_SADDLE_ENDPOINT:'https://example.test/saddle',NEXUS_CACHE_SADDLE_SECRET:secret},fetchImpl:async(url,request)=>{
   const payload=JSON.parse(request.body);assert.equal(payload.reward.quality,row.saddle_reward.quality);
   return {ok:true,json:async()=>({idempotencyKey:payload.idempotencyKey,state:'DELIVERED'})};
 }};
 assert.equal((await submitSaddle(row,options)).state,'DELIVERED');
 await assert.rejects(submitSaddle(row,{...options,fetchImpl:async()=>({ok:true,json:async()=>({state:'DELIVERED',idempotencyKey:'wrong'})})}),/UNCONFIRMED/);
});
test('saddle failure is quarantined and never resends the dino',async()=>{
 const updates=[];
 const connection={query:async sql=>{
  if(sql.includes('information_schema'))return [[{COLUMN_NAME:'state',COLUMN_TYPE:"'SEALED'"},{COLUMN_NAME:'revealed_at'},{COLUMN_NAME:'announced_at'},{COLUMN_NAME:'saddle_reward'},{COLUMN_NAME:'saddle_state'}]];
  if(sql.startsWith('SELECT *')) {assert.match(sql,/state='DELIVERED'.*saddle_state='PENDING'/);return [[{id:'order',saddle_reward:saddleReward('Rex',secret,'p')}]];}
  return [[]];
 },execute:async(sql,args)=>{updates.push([sql,args]);return [{affectedRows:1}];},end:async()=>{}};
 const result=await deliverSaddle({connector:async()=>({connection}),submit:async()=>{throw new Error('timeout');}});
 assert.equal(result.saddleState,'SENT_UNCONFIRMED');
 assert.equal(updates.length,2);
});
