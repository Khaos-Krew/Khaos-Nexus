'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ArkCacheShopService } = require('../src/sentinel/ark-cache-shop-service.cjs');
const { CONFIG } = require('../src/sentinel/ark-dino-cache-engine.cjs');

function fixture({ failInsert = false, secret = 'a'.repeat(32), arnEnabled = false } = {}) {
  const state = { points: 100000, orders: [], events: [], debits: 0, arn:50, arnEntries:[] };
  let backup;
  const connection = {
    async query(sql) {
      if (sql.includes('SELECT * FROM nexus_arn_settings'))return [[{enabled:arnEnabled,cache_cost:10}]];
      if (sql.includes('SELECT ENGINE')) return [[{ ENGINE:'InnoDB' }]];
      if (sql.includes('COLUMN_TYPE')) return [[{ COLUMN_NAME:'state', COLUMN_TYPE:"'SEALED'" }, { COLUMN_NAME:'revealed_at' }, { COLUMN_NAME:'announced_at' }]];
      if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME:'Points' }, { COLUMN_NAME:'EosId' }]];
      return [[]];
    },
    async beginTransaction() { backup = structuredClone(state); },
    async commit() { backup = null; },
    async rollback() { if (backup) Object.assign(state, backup); },
    async end() {},
    async execute(sql, args) {
      if(sql.startsWith('SELECT balance FROM nexus_arn_wallets'))return [[{balance:state.arn}]];
      if(sql.startsWith('SELECT * FROM nexus_arn_ledger'))return [state.arnEntries.filter(e=>e.event_key===args[0])];
      if(sql.startsWith('UPDATE nexus_arn_wallets'))state.arn=args[0];
      if(sql.startsWith('INSERT INTO nexus_arn_ledger'))state.arnEntries.push({event_key:args[1],discord_user_id:args[2],delta:args[3],balance_after:args[5]});
      if (sql.includes('WHERE purchase_nonce=')) return [state.orders.filter(r => r.purchase_nonce === args[0])];
      if (sql.includes('AS player_id')) return [[{ player_id:'EOS_12345678', points:state.points }]];
      if (sql.startsWith('UPDATE `Players`')) { state.points -= args[0]; state.debits++; return [{ affectedRows:1 }]; }
      if (sql.startsWith('INSERT INTO nexus_discord_cache_orders')) {
        if (failInsert) throw new Error('simulated order failure');
        const keys = ['id','public_cache_id','purchase_nonce','discord_user_id','player_eos_id','cache_type','nexus_point_cost','species','rarity','variant','blueprint','rolled_level','sex'];
        state.orders.push({ ...Object.fromEntries(keys.map((k,i)=>[k,args[i]])), state:'SEALED' });
      }
      if (sql.startsWith('INSERT INTO nexus_discord_cache_events')) state.events.push(JSON.parse(args[2]));
      if (sql.includes('WHERE id=?')) return [state.orders.filter(r=>r.id===args[0])];
      return [[]];
    }
  };
  const service = new ArkCacheShopService({ connector:async()=>({ connection, config:{ database:'test', table:'Players' } }), rngSecret:secret,
    identityStore:{ profileByDiscord:()=>({ arkAccounts:[{ eosId:'EOS_12345678', verifiedAt:'2026-09-01' }] }) }, economyAuditor:async()=>({ ok:true }) });
  return { service, state };
}
const request = { discordUserId:'12345678', cacheId:'coastal', purchaseNonce:'interaction-1' };
test('checkout commits one debit, sealed reward and balance audit; replay never debits', async()=>{
  const { service, state } = fixture();
  const first = await service.purchase(request);
  const replay = await service.purchase(request);
  assert.equal(first.order.id, replay.order.id);
  assert.equal(replay.duplicate, true);
  assert.equal(state.debits, 1);
  assert.equal(state.points, 100000-CONFIG.caches.coastal.price);
  assert.equal(state.events[0].before, 100000);
  assert.equal(state.events[0].after, state.points);
  assert.equal(first.order.state, 'SEALED');
  await assert.rejects(service.purchase({ ...request, discordUserId:'87654321' }), { code:'PURCHASE_IDENTITY_CONFLICT' });
  await assert.rejects(service.purchase({ ...request, cacheId:'forest' }), { code:'PURCHASE_IDENTITY_CONFLICT' });
  assert.equal(state.debits, 1);
});
test('order persistence or RNG failure rolls back the debit and audit', async()=>{
  for (const options of [{ failInsert:true }, { secret:'' }]) {
    const { service, state } = fixture(options);
    await assert.rejects(service.purchase(request));
    assert.equal(state.points,100000);
    assert.equal(state.orders.length,0);
    assert.equal(state.events.length,0);
  }
});
test('ARN checkout remains disabled until rates are set',async()=>{
  const {service,state}=fixture();
  await assert.rejects(service.purchase({...request,cacheId:'arn'}),{code:'ARN_DISABLED'});
  assert.equal(state.arn,50);assert.equal(state.points,100000);assert.equal(state.orders.length,0);
});
test('ARN redemption debits only ARN, persists a sealed order and does not repeat',async()=>{
  const {service,state}=fixture({arnEnabled:true});
  const req={...request,cacheId:'arn'};
  const first=await service.purchase(req), replay=await service.purchase(req);
  assert.equal(first.order.state,'SEALED');assert.equal(replay.order.id,first.order.id);
  assert.equal(state.arn,40);assert.equal(state.points,100000);assert.equal(state.arnEntries.length,1);
  assert.equal(state.events[0].currency,'ARN_TOKENS');
});
test('failed ARN order rolls back the token spend',async()=>{
  const {service,state}=fixture({arnEnabled:true,failInsert:true});
  await assert.rejects(service.purchase({...request,cacheId:'arn'}));
  assert.equal(state.arn,50);assert.equal(state.arnEntries.length,0);assert.equal(state.points,100000);
});
test('expired weekly views cannot charge, but committed purchases remain replayable',async()=>{
  const {service,state}=fixture();
  service.refreshWeekly=async()=>({id:'new-week'});
  await assert.rejects(service.purchase({...request,cacheId:'weekly',rotationId:'old-week'}),{code:'WEEKLY_ROTATED'});
  assert.equal(state.points,100000);
  state.orders.push({id:'saved-order',purchase_nonce:request.purchaseNonce,discord_user_id:request.discordUserId,cache_type:'weekly',state:'SEALED'});
  const replay=await service.purchase({...request,cacheId:'weekly',rotationId:'old-week'});
  assert.equal(replay.order.id,'saved-order');assert.equal(replay.duplicate,true);assert.equal(state.debits,0);
});
