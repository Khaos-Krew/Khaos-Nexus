'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HostedServerStore } = require('../src/backend/core/hosted-server-store.cjs');
const { trackedServersResponse } = require('../src/backend/tracked-servers.cjs');
const { hostedServerCommand, privateServerList, statusText, setupText } = require('../src/sentinel/hosted-server-manager.cjs');
const { renderGameServersPanel } = require('../src/sentinel/game-servers-panel.cjs');

function temporaryStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-hosted-servers-'));
  return { dir, file: path.join(dir, 'hosted-servers.json'), store: new HostedServerStore({ filePath: path.join(dir, 'hosted-servers.json') }) };
}
function emptyRuntime() { return { config: { modules: {} }, manifests: () => [] }; }

test('server registration is host agnostic and persists Palworld and Once Human without endpoints', () => {
  const { file, store } = temporaryStore();
  const pal = store.add({ moduleId:'palworld', name:'Palworld Main', joinInfo:'Search Khaos Nexus.' });
  const once = store.add({ moduleId:'oncehuman', name:'Once Human Main', description:'Nexus Once Human server' });
  assert.match(pal.id,/^SRV-/); assert.match(once.id,/^SRV-/);
  assert.equal(pal.host,''); assert.equal(pal.port,null); assert.equal(pal.adapterType,'none'); assert.equal(pal.trackingState,'registered');
  assert.equal(once.host,''); assert.equal(once.port,null); assert.equal(once.adapterType,'none');
  const restarted = new HostedServerStore({ filePath:file });
  assert.equal(restarted.list({includePrivate:true}).length,2);
  assert.deepEqual(restarted.list({includePrivate:true}).map((server)=>server.moduleId).sort(),['oncehuman','palworld']);
});

test('connection and telemetry adapter can be attached later without recreating server identity', () => {
  const { store } = temporaryStore();
  const original = store.add({ moduleId:'palworld', name:'Main' });
  const configured = store.update(original.id, {
    host:'pal.example.test', port:8211, adminPort:8212, adapterType:'palworld-rest', hostingProvider:'AnyHost', credentialEnv:'PAL_SECRET'
  });
  assert.equal(configured.id, original.id);
  assert.equal(configured.host,'pal.example.test'); assert.equal(configured.port,8211); assert.equal(configured.adminPort,8212);
  assert.equal(configured.adapterType,'palworld-rest'); assert.equal(configured.hostingProvider,'AnyHost'); assert.equal(configured.credentialEnv,'PAL_SECRET');
});

test('duplicate endpoint is rejected and endpoint-free duplicate identity is rejected', () => {
  const { store } = temporaryStore();
  store.add({ moduleId:'palworld', name:'One', host:'pal.example.test', port:8211 });
  assert.throws(()=>store.add({ moduleId:'palworld', name:'Different Name', host:'PAL.EXAMPLE.TEST', port:8211 }),/already registered/i);
  store.add({ moduleId:'oncehuman', name:'Once Alpha' });
  assert.throws(()=>store.add({ moduleId:'oncehuman', name:'once alpha' }),/already registered/i);
});

test('legacy host-specific provider values normalize to adapter semantics without exposing private refs', () => {
  const { store } = temporaryStore();
  const pal = store.add({ moduleId:'palworld', name:'Legacy Pal', providerType:'nitrado-palworld', providerRef:'12345678', credentialEnv:'NEXUS_NITRADO_TOKEN' });
  assert.equal(pal.adapterType,'nitrado-api'); assert.equal(pal.providerType,'nitrado-api'); assert.equal(pal.adapterRef,'12345678');
  const publicPal = store.get(pal.id);
  assert.equal(publicPal.hostingProvider,'');
  assert.equal(JSON.stringify(publicPal).includes('12345678'),false);

  const once = store.add({ moduleId:'oncehuman', name:'Legacy Once', providerType:'oncehuman-basic' });
  assert.equal(once.adapterType,'manual');
});

test('provider runtime status persists but public data remains secret-free', () => {
  const { file, store } = temporaryStore();
  const server = store.add({moduleId:'palworld',name:'Main',host:'secret.internal',port:8211,adapterType:'nitrado-api',adapterRef:'9988',credentialEnv:'NITRADO_SECRET'});
  store.updateRuntime(server.id,{providerConnected:true,trackingState:'online',playerCount:4,playerMax:32,lastCheckedAt:'2026-08-26T03:00:00Z',statusMessage:'Adapter reports started.'});
  const restarted=new HostedServerStore({filePath:file}); const publicCopy=restarted.get(server.id);
  assert.equal(publicCopy.trackingState,'online'); assert.equal(publicCopy.playerCount,4); assert.equal(publicCopy.playerMax,32);
  const serialized=JSON.stringify(publicCopy); assert.equal(serialized.includes('secret.internal'),false); assert.equal(serialized.includes('9988'),false); assert.equal(serialized.includes('NITRADO_SECRET'),false);
});

test('public tracked-server payload never exposes endpoint adapter references or credential env names', () => {
  const { store } = temporaryStore();
  store.add({ moduleId:'palworld', name:'Private Endpoint Test', host:'10.0.0.55', port:8211, queryPort:27015, adminPort:8212, adapterType:'nitrado-api', adapterRef:'12345678', credentialEnv:'NEXUS_PALWORLD_ADMIN_SECRET', joinInfo:'Use the Nexus join code.' });
  const serialized = JSON.stringify(trackedServersResponse(emptyRuntime(),store));
  assert.equal(serialized.includes('10.0.0.55'),false); assert.equal(serialized.includes('8212'),false); assert.equal(serialized.includes('12345678'),false); assert.equal(serialized.includes('NEXUS_PALWORLD_ADMIN_SECRET'),false); assert.match(serialized,/Use the Nexus join code/);
});

test('servers marked private are omitted from public tracked-server registry', () => {
  const { store } = temporaryStore(); store.add({moduleId:'palworld',name:'Public',public:true}); store.add({moduleId:'oncehuman',name:'Private',public:false});
  const payload = trackedServersResponse(emptyRuntime(),store); assert.equal(payload.count,1); assert.equal(payload.servers[0].name,'Public');
});

test('game-server panel treats telemetry as optional and never exposes private endpoint metadata', () => {
  const payload = renderGameServersPanel({servers:[{id:'SRV-TEST',moduleId:'palworld',game:'Palworld',name:'Palworld Main',description:'Community server',joinInfo:'Search Khaos Nexus in the browser',providerConfigured:false,providerConnected:false,trackingState:'registered'}]});
  const serialized=JSON.stringify(payload); assert.match(serialized,/Palworld Main/); assert.match(serialized,/Search Khaos Nexus/); assert.match(serialized,/telemetry optional/); assert.equal(serialized.includes('10.0.0.'),false);
});

test('/server add needs only game and name while configure owns adapter settings', () => {
  const command=hostedServerCommand().toJSON(); assert.equal(command.name,'server');
  assert.deepEqual(command.options.map((option)=>option.name),['add','edit','configure','setup','status','remove','list','refresh']);
  const add=command.options.find((option)=>option.name==='add');
  const required=add.options.filter((option)=>option.required).map((option)=>option.name);
  assert.deepEqual(required,['game','name']);
  const addNames=add.options.map((option)=>option.name);
  for (const forbidden of ['adapter','provider','adapter_ref','provider_ref','credential_env','password','token','secret']) assert.equal(addNames.includes(forbidden),false);
  const configure=command.options.find((option)=>option.name==='configure');
  const configureNames=configure.options.map((option)=>option.name);
  assert.ok(configureNames.includes('adapter')); assert.ok(configureNames.includes('hosting_provider')); assert.ok(configureNames.includes('adapter_ref')); assert.ok(configureNames.includes('credential_env'));
  const adapter=configure.options.find((option)=>option.name==='adapter');
  for (const value of ['none','palworld-rest','palworld-rcon','nitrado-api','manual','custom']) assert.ok(adapter.choices.some((choice)=>choice.value===value));
});

test('private server list can show optional hoster and adapter metadata only to ephemeral admin output', () => {
  const text=privateServerList([{id:'SRV-ABC',name:'Main',game:'Palworld',host:'pal.internal',port:8211,adminPort:8212,adapterType:'palworld-rcon',hostingProvider:'Nitrado',adapterRef:'private-ref',credentialEnv:'PAL_SECRET',public:true}]);
  assert.match(text,/SRV-ABC/); assert.match(text,/pal\.internal:8211/); assert.match(text,/admin 8212/); assert.match(text,/palworld-rcon/); assert.match(text,/Nitrado/); assert.match(text,/private-ref/); assert.match(text,/PAL_SECRET/);
});

test('adapter status text is private-safe', () => {
  const text=statusText({name:'Main',adapterType:'nitrado-api',host:'secret.internal',adapterRef:'12345678',credentialEnv:'PAL_SECRET'},{trackingState:'online',playerCount:4,playerMax:32,statusMessage:'Adapter reports started.'});
  assert.match(text,/ONLINE/); assert.match(text,/4 \/ 32/); assert.equal(text.includes('secret.internal'),false); assert.equal(text.includes('12345678'),false); assert.equal(text.includes('PAL_SECRET'),false);
});

test('Once Human setup text is host independent and keeps official management path explicit', () => {
  const text=setupText({name:'Once Main'},{managementMode:'manual-official-dashboard',sections:[{title:'Scenario',settings:['Scenario selection']}],warnings:['Some changes require restart.']});
  assert.match(text,/does \*\*not\*\* depend|does not depend/i); assert.match(text,/official server-management/i); assert.match(text,/Scenario selection/); assert.match(text,/require restart/i);
});
