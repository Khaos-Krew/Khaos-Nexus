'use strict';
const SADDLES=Object.freeze({ Parasaur:'Para',Carbonemys:'Turtle',Trike:'Trike',Pteranodon:'Ptero',Pelagornis:'Pela',Tapejara:'Tapejara',Argentavis:'Argentavis',Quetzal:'Quetz',Raptor:'Raptor',Carnotaurus:'Carno','Dire Bear':'DireBear',Therizinosaur:'Therizinosaurus',Thylacoleo:'Thylaco',Sarco:'Sarco',Beelzebufo:'Toad',Kaprosuchus:'Kapro',Baryonyx:'Baryonyx',Ankylosaurus:'Ankylo',Doedicurus:'Doed',Sabertooth:'Saber',Allosaurus:'Allo',Rex:'Rex',Yutyrannus:'Yuty' });
function saddleFor(species) { const name=SADDLES[species]; return name?`/Game/PrimalEarth/CoreBlueprints/Items/Armor/Saddles/PrimalItemArmor_${name}Saddle.PrimalItemArmor_${name}Saddle`:null; }
async function ensureReceiptSchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_cache_purchase_receipts (order_id CHAR(36) PRIMARY KEY, currency VARCHAR(24) NOT NULL, balance_before BIGINT NOT NULL, price BIGINT NOT NULL, balance_after BIGINT NOT NULL, snapshot LONGTEXT NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_cache_saddle_delivery (order_id CHAR(36) PRIMARY KEY, blueprint VARCHAR(255) NOT NULL, state VARCHAR(24) NOT NULL DEFAULT 'PENDING', error_message VARCHAR(500) NOT NULL DEFAULT '') ENGINE=InnoDB`);
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_cache_delivery_targets (eos_id VARCHAR(128) NOT NULL, server_prefix VARCHAR(64) NOT NULL, ark_player_id VARCHAR(20) NOT NULL, verified_by VARCHAR(25) NOT NULL, evidence VARCHAR(500) NOT NULL, PRIMARY KEY(eos_id,server_prefix)) ENGINE=InnoDB`);
}
async function receipt(db,{id,userId,eosId,cache,roll,currency,balance}) {
  const saddle=saddleFor(roll.species);
  await db.execute('INSERT INTO nexus_cache_purchase_receipts (order_id,currency,balance_before,price,balance_after,snapshot) VALUES (?,?,?,?,?,?)',[id,currency,balance,cache.price,balance-cache.price,JSON.stringify({userId,eosId,cache,roll,saddle})]);
  if(saddle)await db.execute('INSERT INTO nexus_cache_saddle_delivery (order_id,blueprint) VALUES (?,?)',[id,saddle]);
}
function saddleCommand(playerId,blueprint) {
  if(!/^[1-9]\d{0,19}$/.test(String(playerId))||!/^\/Game\/[A-Za-z0-9_./]+$/.test(blueprint))throw new Error('Verified ARK player ID and saddle blueprint required.');
  return `GiveItemToPlayer ${playerId} "Blueprint'${blueprint}'" 1 0 0`;
}
module.exports={SADDLES,saddleFor,ensureReceiptSchema,receipt,saddleCommand};

async function registerTarget(db,{eosId,prefix,playerId,actor,evidence}) {
  if(!/^[A-Za-z0-9_-]{8,96}$/.test(eosId)||!/^ARK_[A-Z0-9_]+$/.test(prefix)||!/^\d{5,25}$/.test(actor)||String(evidence).length<3)throw new Error('Verified target identity and evidence required.');
  saddleCommand(playerId,saddleFor('Rex'));
  await db.beginTransaction();
  try {
    await db.execute('INSERT INTO nexus_cache_delivery_targets (eos_id,server_prefix,ark_player_id,verified_by,evidence) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE ark_player_id=VALUES(ark_player_id),verified_by=VALUES(verified_by),evidence=VALUES(evidence)',[eosId,prefix,playerId,actor,evidence]);
    await db.execute('INSERT INTO nexus_arn_admin_audit (id,actor,details) VALUES (?,?,?)',[require('node:crypto').randomUUID(),actor,JSON.stringify({action:'cache-target',eosId,prefix,playerId,evidence}).slice(0,500)]);
    await db.commit();
  }catch(e){await db.rollback();throw e;}
}
async function reconcileDelivery(db,{orderId,dinoReceived,saddleReceived,actor,evidence}) {
  if(!/^[0-9a-f-]{36}$/i.test(orderId)||!/^\d{5,25}$/.test(actor)||typeof dinoReceived!=='boolean'||typeof saddleReceived!=='boolean'||String(evidence).length<3)throw new Error('Inventory verification and actor required.');
  await db.beginTransaction();
  try {
    const [rows]=await db.execute('SELECT * FROM nexus_discord_cache_orders WHERE id=? FOR UPDATE',[orderId]);
    if(!rows[0]||!['SENT_UNCONFIRMED','DELIVERY_FAILED'].includes(rows[0].state))throw new Error('Only uncertain or failed deliveries can be reconciled.');
    const [acks]=await db.execute("SELECT sequence_id FROM nexus_discord_cache_events WHERE order_id=? AND event_type='DINO_ACKNOWLEDGED' LIMIT 1",[orderId]);
    if(acks.length&&!dinoReceived)throw new Error('An acknowledged creature cannot be automatically resent.');
    if(dinoReceived&&!acks.length)await db.execute("INSERT INTO nexus_discord_cache_events (order_id,event_type,actor_discord_user_id,details) VALUES (?,'DINO_ACKNOWLEDGED',?,?)",[orderId,actor,evidence]);
    await db.execute('UPDATE nexus_cache_saddle_delivery SET state=?,error_message=? WHERE order_id=?',[saddleReceived?'DELIVERED':'PENDING',evidence,orderId]);
    await db.execute("UPDATE nexus_discord_cache_orders SET state='AWAITING_DELIVERY',failure_class='',error_message=? WHERE id=?",[evidence,orderId]);
    await db.execute("INSERT INTO nexus_discord_cache_events (order_id,event_type,actor_discord_user_id,details) VALUES (?,'ADMIN_RECONCILED',?,?)",[orderId,actor,JSON.stringify({dinoReceived,saddleReceived,evidence}).slice(0,500)]);
    await db.commit();
  }catch(e){await db.rollback();throw e;}
}
module.exports.registerTarget=registerTarget;
module.exports.reconcileDelivery=reconcileDelivery;
