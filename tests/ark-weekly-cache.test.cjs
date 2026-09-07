'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRotation, weekStart, WEEK, allowed, loadWeekly } = require('../src/sentinel/ark-weekly-cache.cjs');
const { CONFIG, rollCache, deterministicRng } = require('../src/sentinel/ark-dino-cache-engine.cjs');
const { saddleFor } = require('../src/sentinel/ark-cache-receipts.cjs');
const secret = 'a'.repeat(32), now = Date.parse('2026-09-06T20:00:00Z');
test('weekly boundary is Monday UTC and rotation avoids previous lineup',()=>{
  assert.equal(new Date(weekStart(now)).toISOString(),'2026-08-31T00:00:00.000Z');
  const a=generateRotation(now,secret), b=generateRotation(now+WEEK,secret,a.cache.entries);
  assert.deepEqual(a,generateRotation(now,secret));
  assert.equal(new Set(a.cache.entries.map(e=>e.name)).size,8);
  assert.equal(b.cache.entries.filter(e=>a.cache.entries.some(x=>x.name===e.name)).length,0);
  assert.ok(a.cache.entries.every(allowed));
  assert.equal(allowed({ name:'Moros Indomitable Duo', blueprint:'/Game/PrimalEarth/Dinos/Moros' }),false);
  assert.equal(allowed({ name:'Unapproved', blueprint:'/Game/PrimalEarth/Dinos/Unknown' }),false);
});
test('weekly outcomes reuse engine level and supported variant rules',()=>{
  const rotation=generateRotation(now,secret), config={...CONFIG,caches:{weekly:rotation.cache}};
  const rng=deterministicRng(secret,'weekly-test');
  for(let i=0;i<1000;i++) {
    const roll=rollCache('weekly',rng,config);
    const entry=rotation.cache.entries.find(e=>e.name===roll.species);
    assert.ok(roll.level>=200&&roll.level<=300);
    assert.equal(roll.shiny,false);
    assert.equal(roll.blueprint,roll.variant==='normal'?entry.blueprint:entry.variants[roll.variant]);
  }
});
test('Winged Cache is ASA-native, sealed-engine compatible, and saddle complete',()=>{
  const cache=CONFIG.caches.winged;
  assert.ok(cache);
  assert.equal(cache.price,300);
  assert.equal(cache.cooldownMinutes,5);
  assert.deepEqual(cache.variantWeights,{normal:100});
  assert.deepEqual(cache.entries.map(e=>e.name),['Pteranodon','Pelagornis','Tapejara','Argentavis','Quetzal','Rhyniognatha']);
  assert.ok(cache.entries.every(e=>e.blueprint.startsWith('/Game/PrimalEarth/')));
  assert.ok(cache.entries.every(e=>Object.keys(e.variants).length===0));
  assert.equal(/moros|indomitable|indominus|indoraptor|shiny|SDinoVariants|Genesis/i.test(JSON.stringify(cache)),false);
  for(const species of ['Pteranodon','Pelagornis','Tapejara','Argentavis','Quetzal']) assert.match(saddleFor(species),/^\/Game\/PrimalEarth\/CoreBlueprints\/Items\/Armor\/Saddles\//);
  assert.equal(saddleFor('Rhyniognatha'),null);
  const rng=deterministicRng(secret,'winged-test');
  for(let i=0;i<1000;i++) {
    const roll=rollCache('winged',rng,CONFIG);
    assert.equal(roll.variant,'normal');
    assert.equal(roll.shiny,false);
    assert.ok(roll.level>=200&&roll.level<=300);
    assert.ok(cache.entries.some(e=>e.name===roll.species&&e.blueprint===roll.blueprint));
  }
});
test('published rotation survives restarts and secret changes; history remains append-only',async()=>{
  const records=[];
  const db={async query(sql){return sql.startsWith('SELECT')?[[...records].sort((a,b)=>b.starts_at-a.starts_at).slice(0,1)]:[[]];},async execute(sql,p){
    if(sql.startsWith('INSERT')){if(!records.some(r=>r.id===p[0]))records.push({id:p[0],starts_at:p[1],ends_at:p[2],snapshot:p[3],digest:p[4]});return [[]];}
    return [records.filter(r=>r.id===p[0])];
  }};
  const first=await loadWeekly(db,secret,now);
  assert.deepEqual(await loadWeekly(db,'b'.repeat(32),now),first);
  const next=await loadWeekly(db,secret,now+WEEK);
  assert.notEqual(first.id,next.id);assert.equal(records.length,2);
  records[1].snapshot=records[1].snapshot.replace('2500','2501');
  await assert.rejects(loadWeekly(db,secret,now+WEEK),/integrity/);
});
