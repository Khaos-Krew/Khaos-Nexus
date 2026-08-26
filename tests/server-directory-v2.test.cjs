'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeServerDefinition, validateOnceHumanId, hasReliableAutomatedHealth } = require('../src/shared/game-server-catalog.cjs');
const { HostedServerStore } = require('../src/backend/core/hosted-server-store.cjs');
const { ServerApplicationStore } = require('../src/backend/core/server-application-store.cjs');
const { trackedServersResponse } = require('../src/backend/tracked-servers.cjs');
const { hostedServerCommand } = require('../src/sentinel/hosted-server-manager.cjs');

function tempFile(name){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-server-v2-'));return path.join(dir,name);}
function emptyRuntime(){return{config:{modules:{}},manifests:()=>[]};}

test('Once Human Custom Server uses numeric server ID and no generic network endpoint',()=>{
  assert.equal(validateOnceHumanId('10101801696'),true);
  const server=normalizeServerDefinition({game:'Once Human',serverType:'oncehuman-custom',name:'Nexus Once',externalId:'10101801696'});
  assert.equal(server.moduleId,'oncehuman'); assert.equal(server.serverType,'oncehuman-custom'); assert.equal(server.host,'');
  assert.throws(()=>normalizeServerDefinition({game:'Once Human',serverType:'oncehuman-custom',name:'Bad',externalId:'ABC'}),/8–20 digits/);
});

test('Minecraft Realms are invite-based special cases while dedicated servers can require endpoints',()=>{
  const realm=normalizeServerDefinition({game:'Minecraft',serverType:'minecraft-realm-bedrock',name:'Realm One',joinInfo:'Request an invite'});
  assert.equal(realm.moduleId,'minecraft'); assert.equal(realm.host,'');
  assert.throws(()=>normalizeServerDefinition({game:'Valheim',serverType:'dedicated',name:'No Host'}),/requires a hostname/i);
  const dedicated=normalizeServerDefinition({game:'Valheim',serverType:'dedicated',name:'Viking Home',host:'games.example.test',port:2456});
  assert.equal(dedicated.moduleId,'valheim'); assert.equal(dedicated.port,2456);
});

test('public projection strips join secrets, admin notes, endpoints and credentials',()=>{
  const store=new HostedServerStore({filePath:tempFile('servers.json')});
  const added=store.add({game:'Minecraft',serverType:'minecraft-realm-java',name:'Realm',public:true,joinVisibility:'request',joinInfo:'internal invite steps',joinSecret:'TOPSECRET',adminNotes:'STAFF ONLY',credentialEnv:'SECRET_ENV'});
  const publicCopy=store.get(added.id); const serialized=JSON.stringify(publicCopy);
  assert.equal(publicCopy.joinInfo,'Request access from the server owner.');
  assert.equal(serialized.includes('TOPSECRET'),false); assert.equal(serialized.includes('STAFF ONLY'),false); assert.equal(serialized.includes('SECRET_ENV'),false);
});

test('community applications flag monetization and hard-block profit-seeking approvals',()=>{
  const applications=new ServerApplicationStore({filePath:tempFile('applications.json')});
  const hosted=new HostedServerStore({filePath:tempFile('servers.json')});
  const app=applications.submit({applicantDiscordId:'123456789012345678',game:'Minecraft',serverType:'minecraft-realm-java',name:'Paid Realm',monetizationModel:'commercial',policyAccepted:true,monetizationDetails:'For profit'});
  assert.equal(app.hardBlocked,true); assert.ok(app.riskFlags.some((flag)=>/Commercial/i.test(flag)));
  assert.throws(()=>applications.review(app.id,{decision:'approved',reviewerDiscordId:'987654321098765432'},hosted),/hard monetization-policy blocks/i);
});

test('approved application is the only path that promotes a community-approved listing',()=>{
  const applications=new ServerApplicationStore({filePath:tempFile('applications.json')});
  const hosted=new HostedServerStore({filePath:tempFile('servers.json')});
  const app=applications.submit({applicantDiscordId:'123456789012345678',game:'Once Human',serverType:'oncehuman-custom',name:'Community Once',externalId:'10101801696',monetizationModel:'donations-cost-recovery',monetizationDetails:'Donations only offset hosting costs.',policyAccepted:true});
  const reviewed=applications.review(app.id,{decision:'approved',reviewerDiscordId:'987654321098765432',reason:'Costs disclosed and approved.'},hosted);
  const server=hosted.get(reviewed.approvedServerId,{includePrivate:true});
  assert.equal(reviewed.status,'approved'); assert.equal(server.ownershipType,'community-approved'); assert.equal(server.ownerDiscordId,'123456789012345678'); assert.equal(server.approvalId,app.id); assert.equal(server.externalId,'10101801696');
});

test('reliable community servers auto-hide after 72 hours and suspend after seven days',()=>{
  let now=new Date('2026-08-20T00:00:00Z');
  const store=new HostedServerStore({filePath:tempFile('servers.json'),now:()=>now.toISOString()});
  const server=store.add({game:'Palworld',serverType:'hosted',name:'Community Pal',host:'pal.example.test',port:8211,connectionType:'rcon',adapterType:'palworld-rcon',ownershipType:'community-approved',ownerDiscordId:'123456789012345678',approvalId:'APP-ONE',public:true});
  assert.equal(hasReliableAutomatedHealth(server),true);
  store.updateRuntime(server.id,{trackingState:'offline',providerConnected:false});
  now=new Date('2026-08-23T01:00:00Z'); store.updateRuntime(server.id,{trackingState:'offline',providerConnected:false});
  assert.equal(store.get(server.id).listingState,'hidden');
  now=new Date('2026-08-27T01:00:00Z'); store.updateRuntime(server.id,{trackingState:'offline',providerConnected:false});
  assert.equal(store.get(server.id).listingState,'suspended');
});

test('official and non-queryable community servers are never auto-delisted by false health assumptions',()=>{
  let now=new Date('2026-08-20T00:00:00Z');
  const store=new HostedServerStore({filePath:tempFile('servers.json'),now:()=>now.toISOString()});
  const official=store.add({game:'Palworld',serverType:'hosted',name:'Official',host:'official.example.test',port:8211,connectionType:'rcon',adapterType:'palworld-rcon',ownershipType:'nexus-official'});
  const realm=store.add({game:'Minecraft',serverType:'minecraft-realm-java',name:'Community Realm',ownershipType:'community-approved',ownerDiscordId:'123456789012345678',approvalId:'APP-REALM'});
  store.updateRuntime(official.id,{trackingState:'offline'}); store.updateRuntime(realm.id,{trackingState:'offline'}); now=new Date('2026-09-01T00:00:00Z'); store.updateRuntime(official.id,{trackingState:'offline'}); store.updateRuntime(realm.id,{trackingState:'offline'});
  assert.equal(store.get(official.id).listingState,'listed'); assert.equal(store.get(realm.id).listingState,'listed');
});

test('hidden and suspended community servers remain stored but disappear from tracked public directory',()=>{
  const store=new HostedServerStore({filePath:tempFile('servers.json')});
  const visible=store.add({game:'Minecraft',serverType:'minecraft-realm-java',name:'Visible',ownershipType:'community-approved',ownerDiscordId:'123456789012345678',approvalId:'APP-A'});
  const hidden=store.add({game:'Minecraft',serverType:'minecraft-realm-bedrock',name:'Hidden',ownershipType:'community-approved',ownerDiscordId:'123456789012345678',approvalId:'APP-B',listingState:'hidden'});
  const payload=trackedServersResponse(emptyRuntime(),store);
  assert.ok(payload.servers.some((server)=>server.id===visible.id)); assert.equal(payload.servers.some((server)=>server.id===hidden.id),false); assert.equal(store.list({includePrivate:true}).length,2);
});

test('Discord server command exposes community application flow and no ownership selector',()=>{
  const command=hostedServerCommand().toJSON(); const names=command.options.map((option)=>option.name);
  assert.ok(names.includes('apply')); assert.ok(names.includes('my-applications')); assert.ok(names.includes('applications')); assert.ok(names.includes('review')); assert.ok(names.includes('add'));
  const add=command.options.find((option)=>option.name==='add'); const apply=command.options.find((option)=>option.name==='apply');
  assert.equal(add.options.some((option)=>option.name==='ownership'),false); assert.equal(apply.options.some((option)=>option.name==='ownership'),false);
  assert.ok(add.options.some((option)=>option.name==='server_type')); assert.ok(apply.options.some((option)=>option.name==='monetization'));
});
