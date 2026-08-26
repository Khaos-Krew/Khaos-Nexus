'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SERVER_HOST_TITLE_TIERS,
  communityTitleForLevel,
  serverHostTitleForLevel,
  isServerHostTitleName,
  syncServerHostTitle
} = require('../src/sentinel/server-host-titles.cjs');
const { progressCardPayload } = require('../src/sentinel/community-achievements.cjs');

test('community titles advance across the existing level milestones', () => {
  assert.equal(communityTitleForLevel(1),'Nexus Initiate');
  assert.equal(communityTitleForLevel(5),'Nexus Contributor');
  assert.equal(communityTitleForLevel(10),'Nexus Regular');
  assert.equal(communityTitleForLevel(20),'Nexus Veteran');
  assert.equal(communityTitleForLevel(50),'Nexus Elite');
  assert.equal(communityTitleForLevel(100),'Nexus Ascendant');
});

test('server host titles start at community level 10 and advance through six tiers', () => {
  assert.equal(SERVER_HOST_TITLE_TIERS.length,6);
  assert.equal(serverHostTitleForLevel(9),null);
  assert.equal(serverHostTitleForLevel(10).name,'Server Host • Operator');
  assert.equal(serverHostTitleForLevel(20).name,'Server Host • Steward');
  assert.equal(serverHostTitleForLevel(30).name,'Server Host • Warden');
  assert.equal(serverHostTitleForLevel(50).name,'Server Host • Commander');
  assert.equal(serverHostTitleForLevel(75).name,'Server Host • Vanguard');
  assert.equal(serverHostTitleForLevel(100).name,'Server Host • Legend');
  assert.equal(isServerHostTitleName('Server Host • Operator'),true);
  assert.equal(isServerHostTitleName('Khaos Warden'),false);
});

test('server host title sync creates uncolored roles and replaces the previous tier only', async () => {
  let nextId=1;
  const cache=new Map();
  const guild={roles:{cache,create:async(options)=>{assert.equal(options.color,0);assert.equal(options.hoist,false);assert.equal(options.mentionable,false);const role={id:String(nextId++),name:options.name};cache.set(role.id,role);return role;}}};
  const memberRoles=new Map();
  const member={guild,roles:{cache:memberRoles,add:async(role)=>memberRoles.set(String(role.id),role),remove:async(role)=>memberRoles.delete(String(role.id))}};
  const first=await syncServerHostTitle(member,10,true);
  assert.equal(first.title,'Server Host • Operator');
  assert.equal(memberRoles.size,1);
  const next=await syncServerHostTitle(member,30,true);
  assert.equal(next.title,'Server Host • Warden');
  assert.deepEqual([...memberRoles.values()].map((role)=>role.name),['Server Host • Warden']);
  await syncServerHostTitle(member,30,false);
  assert.equal(memberRoles.size,0);
});

test('progress card shows the community title and an active server host title without changing rank authority', () => {
  const payload=progressCardPayload({userId:'123456789012345678',level:30,rank:4,xp:84100,progressPercent:25,progressXp:100,progressNeeded:400,sourceTotals:{}},{username:'Host'},null,{serverHostTitle:'Server Host • Warden'});
  const text=JSON.stringify(payload);
  assert.match(text,/Community Title.*Nexus Vanguard/i);
  assert.match(text,/Server Host Title.*Server Host • Warden/i);
  assert.match(text,/separate from Nexus Shop\/supporter ranks/i);
});
