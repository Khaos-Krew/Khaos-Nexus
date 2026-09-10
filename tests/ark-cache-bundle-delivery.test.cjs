'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deliverOne,classifyRconResult}=require('../src/sentinel/ark-dino-box-delivery-worker.cjs');
const {saddleFor,saddleCommand}=require('../src/sentinel/ark-cache-receipts.cjs');
// This suite exercises the legacy Dino Depot delivery and separate saddle path.
test.beforeEach((t) => {
  const previous = process.env.NEXUS_DINO_CACHE_DELIVERY_BACKEND;
  process.env.NEXUS_DINO_CACHE_DELIVERY_BACKEND = 'dinodepot';
  t.after(() => {
    if (previous === undefined) delete process.env.NEXUS_DINO_CACHE_DELIVERY_BACKEND;
    else process.env.NEXUS_DINO_CACHE_DELIVERY_BACKEND = previous;
  });
});
function fixture({ack=false,response='Success',target=true}={}) {
  const row={id:'order',state:'AWAITING_DELIVERY',player_eos_id:'EOS_12345678',blueprint:'/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP',rolled_level:250,sex:'female'};
  const saddle={state:'PENDING',blueprint:saddleFor('Rex')},calls=[];
  const db={async beginTransaction(){},async commit(){},async rollback(){},async end(){},
    async query(sql) {
      if(sql.startsWith('SELECT * FROM nexus_discord_cache_orders'))return [row.state==='AWAITING_DELIVERY'?[row]:[]];
      return [[]];
    },
    async execute(sql,p=[]) {
      if(sql.startsWith('SELECT * FROM nexus_cache_saddle'))return [[saddle]];
      if(sql.startsWith('SELECT * FROM nexus_cache_delivery_targets'))return [target?[{ark_player_id:'123456'}]:[]];
      if(sql.startsWith('SELECT * FROM nexus_discord_cache_orders'))return [row.state==='AWAITING_DELIVERY'?[{...row}]:[]];
      if(sql.startsWith("UPDATE nexus_discord_cache_orders SET state='DELIVERING'"))row.state='DELIVERING';
      if(sql.startsWith('SELECT sequence_id'))return [ack?[{sequence_id:1}]:[]];
      if(sql.includes("SELECT ?,'DINO_ACKNOWLEDGED'"))ack=true;
      if(sql.startsWith("UPDATE nexus_discord_cache_orders SET state='AWAITING_DELIVERY'"))row.state='AWAITING_DELIVERY';
      if(sql.startsWith('UPDATE nexus_discord_cache_orders SET state=?'))row.state=p[0];
      if(sql.startsWith('UPDATE nexus_cache_saddle_delivery SET state=?'))saddle.state=p[0];
      return [{affectedRows:1}];
    }
  };
  return {row,saddle,calls,run:()=>deliverOne({connector:async()=>({connection:db}),findServer:async()=>({prefix:'ARK_GEN1',server:{}}),clientFactory:()=>({executeDetailed:async command=>{calls.push(command);return {response};}})})};
}
test('shared queue delivers exact creature and matching saddle once',async()=>{
  const f=fixture();
  assert.equal((await f.run()).state,'DELIVERED');
  assert.equal(f.calls.length,2);
  assert.match(f.calls[0],/SpawnDinoInBall.*-l=250/);
  assert.match(f.calls[1],/GiveItemToPlayer 123456.*RexSaddle/);
  assert.equal((await f.run()).skipped,'none-awaiting');
  assert.equal(f.calls.length,2);
});
test('acknowledged creature is never resent during saddle recovery',async()=>{
  const f=fixture({ack:true}); await f.run();
  assert.equal(f.calls.length,1);assert.match(f.calls[0],/^GiveItemToPlayer/);
});
test('ambiguous RCON holds the order and never automatically repeats delivery',async()=>{
  const f=fixture({response:''});
  assert.equal((await f.run()).state,'SENT_UNCONFIRMED');
  assert.equal((await f.run()).skipped,'none-awaiting');
  assert.equal(f.calls.length,1);
});
test('missing verified saddle identity defers only the saddle and never resends the acknowledged dino',async()=>{
  const f=fixture({target:false});
  assert.equal((await f.run()).skipped,'saddle-player-id-unverified');
  assert.equal(f.row.state,'AWAITING_DELIVERY');
  assert.equal(f.saddle.state,'PENDING');
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0],/SpawnDinoInBall/);
  assert.equal((await f.run()).skipped,'saddle-player-id-unverified');
  assert.equal(f.calls.length,1);
});
test('saddle commands reject injected identity and unknown RCON responses are uncertain',()=>{
  assert.throws(()=>saddleCommand('123;kill',saddleFor('Rex')));
  assert.equal(saddleFor('Moschops'),null);
  assert.equal(classifyRconResult({response:'Server received'}).state,'SENT_UNCONFIRMED');
});
