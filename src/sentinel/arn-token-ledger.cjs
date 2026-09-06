'use strict';
const crypto = require('node:crypto');
const { connectMysql } = require('./arkshop-mysql.cjs');
function positive(n) { if (!Number.isSafeInteger(n)||n<1||n>1000000) throw new Error('ARN rates must be integers from 1 to 1,000,000.'); return n; }
function identity(value) { if (!/^\d{5,25}$/.test(String(value))) throw new Error('Valid Discord identity required.'); return String(value); }
async function ensureArnSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_arn_settings (id INT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, earn_rate INT NULL, cache_cost INT NULL, enabled_since BIGINT NULL) ENGINE=InnoDB`);
  await db.query('INSERT IGNORE INTO nexus_arn_settings (id, enabled) VALUES (1, FALSE)');
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_arn_wallets (discord_user_id VARCHAR(25) PRIMARY KEY, balance BIGINT NOT NULL DEFAULT 0) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_arn_ledger (id CHAR(36) PRIMARY KEY, event_key VARCHAR(190) NOT NULL UNIQUE, discord_user_id VARCHAR(25) NOT NULL, delta BIGINT NOT NULL, balance_before BIGINT NOT NULL, balance_after BIGINT NOT NULL, actor VARCHAR(128) NOT NULL, reason VARCHAR(500) NOT NULL, order_id CHAR(36) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_arn_admin_audit (id CHAR(36) PRIMARY KEY, actor VARCHAR(25) NOT NULL, details VARCHAR(500) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
}
async function settings(db, lock=false) { const [rows]=await db.query(`SELECT * FROM nexus_arn_settings WHERE id=1${lock?' FOR UPDATE':''}`); return rows[0]; }
async function wallet(db,user) {
  identity(user);
  await db.execute('INSERT IGNORE INTO nexus_arn_wallets (discord_user_id) VALUES (?)',[user]);
  const [rows]=await db.execute('SELECT balance FROM nexus_arn_wallets WHERE discord_user_id=? FOR UPDATE',[user]);
  const balance=Number(rows[0].balance);
  if (!Number.isSafeInteger(balance)||balance<0) throw new Error('ARN ledger balance is invalid.');
  return balance;
}
// Caller owns the transaction; the earn/spend record and wallet commit together.
async function change(db,{user,delta,key,actor,reason,orderId=null}) {
  identity(user);
  if (!Number.isSafeInteger(delta)||delta===0||!key||key.length>190||!actor||!reason) throw new Error('ARN transaction identity, amount, actor and reason required.');
  const before=await wallet(db,user);
  const [prior]=await db.execute('SELECT * FROM nexus_arn_ledger WHERE event_key=?',[key]);
  if (prior[0]) {
    if (prior[0].discord_user_id!==user||Number(prior[0].delta)!==delta) throw new Error('ARN event identity conflict.');
    return { duplicate:true, balance:Number(prior[0].balance_after) };
  }
  const after=before+delta;
  if (!Number.isSafeInteger(after)||after<0) throw new Error('Insufficient ARN Tokens.');
  await db.execute('UPDATE nexus_arn_wallets SET balance=? WHERE discord_user_id=?',[after,user]);
  await db.execute('INSERT INTO nexus_arn_ledger (id,event_key,discord_user_id,delta,balance_before,balance_after,actor,reason,order_id) VALUES (?,?,?,?,?,?,?,?,?)',[crypto.randomUUID(),key,user,delta,before,after,String(actor).slice(0,128),String(reason).slice(0,500),orderId]);
  return { duplicate:false,balance:after,before };
}
class ArnTokenLedger {
  constructor({connector=connectMysql}={}) { this.connector=connector; }
  async using(fn) { const {connection}=await this.connector(); try { await ensureArnSchema(connection); return await fn(connection); } finally { await connection.end().catch(()=>{}); } }
  async balance(user) { return this.using(async db=>{ const [rows]=await db.execute('SELECT balance FROM nexus_arn_wallets WHERE discord_user_id=?',[identity(user)]); return { balance:Number(rows[0]?.balance||0), settings:await settings(db) }; }); }
  async history(user) { return this.using(async db=>{ const [rows]=await db.execute('SELECT * FROM nexus_arn_ledger WHERE discord_user_id=? ORDER BY created_at DESC LIMIT 20',[identity(user)]); return rows; }); }
  async configure({enabled,earnRate,cacheCost},actor) {
    identity(actor); if(typeof enabled!=='boolean') throw new Error('Explicit enabled state required.');
    if(enabled) { positive(earnRate); positive(cacheCost); }
    return this.using(async db=>{ await db.beginTransaction(); try {
      const previous=await settings(db,true);
      await db.execute('UPDATE nexus_arn_settings SET enabled=?, earn_rate=?, cache_cost=?, enabled_since=? WHERE id=1',[enabled,earnRate||previous.earn_rate,cacheCost||previous.cache_cost,enabled?(previous.enabled?previous.enabled_since:Date.now()):previous.enabled_since]);
      await db.execute('INSERT INTO nexus_arn_admin_audit (id,actor,details) VALUES (?,?,?)',[crypto.randomUUID(),actor,JSON.stringify({enabled,earnRate,cacheCost})]);
      await db.commit(); return settings(db);
    } catch(e) { await db.rollback(); throw e; } });
  }
  async adjust({user,delta,key,reason},actor) {
    identity(actor); positive(Math.abs(delta));
    return this.using(async db=>{ await db.beginTransaction(); try { const result=await change(db,{user,delta,key:`admin:${key}`,actor,reason}); await db.commit(); return result; } catch(e){await db.rollback();throw e;} });
  }
  async syncParticipation(store) {
    // Read only committed, qualified Anomaly awards from the existing participation engine.
    const state=store.read();
    return this.using(async db=>{
      let awarded=0;
      for(const award of state.awards) {
        const run=state.runs.find(r=>r.id===award.runId), participant=run?.participants.find(p=>p.playerId===award.playerId);
        if(run?.definition.id!=='anomaly'||run.status!=='completed'||!participant?.qualified||participant.disqualified) continue;
        await db.beginTransaction();
        try {
          const policy=await settings(db,true);
          if(!policy.enabled||award.at<Number(policy.enabled_since)) { await db.rollback(); continue; }
          const [prior]=await db.execute('SELECT id FROM nexus_arn_ledger WHERE event_key=?',[`participation:${award.id}`]);
          if(prior.length) { await db.commit(); continue; }
          const result=await change(db,{user:award.playerId,delta:positive(Number(policy.earn_rate)),key:`participation:${award.id}`,actor:'sentinel:arn-participation',reason:`Verified completed Anomaly ${run.id}`});
          await db.commit(); if(!result.duplicate)awarded++;
        } catch(e){await db.rollback();throw e;}
      }
      return {awarded};
    });
  }
}
module.exports={ensureArnSchema,settings,wallet,change,positive,identity,ArnTokenLedger};
