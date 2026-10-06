'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {change,ArnTokenLedger}=require('../src/sentinel/arn-token-ledger.cjs');
const {handle}=require('../src/sentinel/arn-cache-extension.cjs');
function fixture(roll=0) {
  const s={balance:0,entries:[],rolls:[],policy:{enabled:false,earn_rate:null,cache_cost:null,enabled_since:null}};
  let backup;
  const db={
    async query(sql) { return sql.includes('SELECT * FROM nexus_arn_settings')?[[s.policy]]:[[]]; },
    async beginTransaction(){backup=structuredClone(s);},async commit(){backup=null;},async rollback(){if(backup)Object.assign(s,backup);},async end(){},
    async execute(sql,p=[]) {
      if(sql.startsWith('SELECT event_key FROM nexus_arn_activity_rolls'))return [s.rolls.filter(r=>r.key===p[0])];
      if(sql.startsWith('INSERT INTO nexus_arn_activity_rolls'))s.rolls.push({key:p[0],roll:p[3],tokens:p[4]});
      if(sql.startsWith('SELECT balance'))return [[{balance:s.balance}]];
      if(sql.startsWith('SELECT')&&sql.includes('nexus_arn_ledger'))return [s.entries.filter(e=>e.event_key===p[0])];
      if(sql.startsWith('UPDATE nexus_arn_wallets'))s.balance=p[0];
      if(sql.startsWith('INSERT INTO nexus_arn_ledger'))s.entries.push({id:p[0],event_key:p[1],discord_user_id:p[2],delta:p[3],balance_before:p[4],balance_after:p[5]});
      return [[]];
    }
  };
  return {s,db,ledger:new ArnTokenLedger({randomInt:()=>roll,connector:async()=>({connection:db})})};
}
const tx={user:'12345678',delta:5,key:'verified-activity-1',actor:'sentinel',reason:'Completed verified activity'};
test('ARN earn/spend ledger is separate, idempotent, and cannot overdraw',async()=>{
  const {s,db}=fixture();
  assert.equal((await change(db,tx)).balance,5);
  assert.equal((await change(db,tx)).duplicate,true);
  assert.equal(s.entries.length,1);
  await assert.rejects(change(db,{...tx,delta:6}),/identity conflict/);
  await assert.rejects(change(db,{...tx,key:'spend-too-much',delta:-6}),/Insufficient/);
  assert.equal(s.balance,5);
  assert.equal((await change(db,{...tx,key:'spend-cache',delta:-5})).balance,0);
  assert.deepEqual(s.entries.map(e=>e.delta),[5,-5]);
});
test('disabled ARN participation grants no tokens; only qualified completed Anomaly earns once',async()=>{
  const {s,ledger}=fixture();
  const store={read:()=>({awards:[{id:'run:12345678',runId:'run',playerId:'12345678',at:200}],runs:[{id:'run',definition:{id:'anomaly'},status:'completed',participants:[{playerId:'12345678',qualified:true}]}]})};
  assert.equal((await ledger.syncParticipation(store)).awarded,0);
  assert.equal(s.balance,0);
  s.policy={enabled:true,earn_rate:2,cache_cost:10,enabled_since:100};
  assert.equal((await ledger.syncParticipation(store)).awarded,1);
  s.policy.earn_rate=3;
  assert.equal((await ledger.syncParticipation(store)).awarded,0);
  assert.equal(s.balance,1);
  s.policy.enabled_since=300;
  assert.equal((await ledger.syncParticipation(store)).awarded,0);
});
test('players cannot configure rates or adjust token wallets',async()=>{
  for(const sub of ['configure','adjust','pause']) {
    await assert.rejects(handle({commandName:'arn',user:{id:'12345678'},options:{getSubcommand:()=>sub}},{config:{discord:{}},ledger:{},shop:{}}),/staff authorization/);
  }
});
test('5% boundary awards one token; losing activity is recorded and cannot reroll',async()=>{
  for(const roll of [499,500,9999]) {
    const {s,ledger}=fixture(roll);
    s.policy={enabled:true,enabled_since:100};
    const store={read:()=>({awards:[{id:'boundary',runId:'run',playerId:'12345678',at:200}],runs:[{id:'run',definition:{id:'anomaly'},status:'completed',participants:[{playerId:'12345678',qualified:true}]}]})};
    await ledger.syncParticipation(store);
    assert.equal(s.balance,roll<500?1:0);
    assert.equal(s.rolls.length,1);
    ledger.randomInt=()=>0;
    await ledger.syncParticipation(store);
    assert.equal(s.balance,roll<500?1:0);
    assert.equal(s.rolls.length,1);
  }
});
test('a frozen ARN MySQL wallet rejects writes and still reads', async () => {
  const { s, db, ledger } = fixture();
  s.balance = 4;
  const original = db.query.bind(db);
  db.query = async (sql) => String(sql).includes('nexus_arn_wallet_freeze') ? [[{ read_only: 1 }]] : original(sql);
  await assert.rejects(change(db, tx), (error) => error.code === 'ARN_WALLET_READ_ONLY' && /read-only/.test(error.message));
  await assert.rejects(ledger.configure({ enabled: true }, '12345678'), (error) => error.code === 'ARN_WALLET_READ_ONLY');
  await assert.rejects(ledger.adjust({ user: '12345678', delta: 1, key: 'freeze', reason: 'freeze' }, '12345678'), (error) => error.code === 'ARN_WALLET_READ_ONLY');
  const store = { read: () => ({ awards: [], runs: [] }) };
  await assert.rejects(ledger.syncParticipation(store), (error) => error.code === 'ARN_WALLET_READ_ONLY');
  assert.equal((await ledger.balance('12345678')).balance, 4);
  assert.equal(s.balance, 4);
  db.query = async (sql) => {
    if (!String(sql).includes('nexus_arn_wallet_freeze')) return original(sql);
    const error = new Error("Table 'nexus.nexus_arn_wallet_freeze' doesn't exist");
    error.code = 'ER_NO_SUCH_TABLE';
    error.errno = 1146;
    throw error;
  };
  assert.equal((await change(db, { ...tx, key: 'after-missing-freeze' })).balance, 9);
});
