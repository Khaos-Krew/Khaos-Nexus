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

test('hosted server store persists multiple Palworld and Once Human servers across restart', () => {
  const { file, store } = temporaryStore();
  const pal = store.add({ moduleId:'palworld', name:'Palworld Main', host:'pal.example.test', port:8211, joinInfo:'Join through the Palworld server browser.' });
  const once = store.add({ moduleId:'oncehuman', name:'Once Human Main', host:'once.example.test', port:7777, description:'Nexus Once Human server' });
  assert.match(pal.id,/^SRV-/); assert.match(once.id,/^SRV-/);
  const restarted = new HostedServerStore({ filePath:file });
  assert.equal(restarted.list({includePrivate:true}).length,2);
  assert.deepEqual(restarted.list({includePrivate:true}).map((server)=>server.moduleId).sort(),['oncehuman','palworld']);
});

test('duplicate server endpoint is rejected and edit/remove are persistent', () => {
  const { file, store } = temporaryStore();
  const server = store.add({ moduleId:'palworld', name:'One', host:'pal.example.test', port:8211 });
  assert.throws(()=>store.add({ moduleId:'palworld', name:'Duplicate', host:'PAL.EXAMPLE.TEST', port:8211 }),/already registered/i);
  const updated = store.update(server.id,{name:'Renamed',public:false}); assert.equal(updated.name,'Renamed'); assert.equal(updated.public,false);
  const restarted = new HostedServerStore({filePath:file}); assert.equal(restarted.get(server.id,{includePrivate:true}).name,'Renamed');
  assert.equal(restarted.remove(server.id),true); assert.equal(restarted.get(server.id),null);
});

test('Nitrado Palworld provider reference persists privately', () => {
  const { file, store } = temporaryStore();
  const server = store.add({ moduleId:'palworld', name:'Nitrado Pal', host:'pal.example.test', port:8211, providerType:'nitrado-palworld', providerRef:'12345678', credentialEnv:'NEXUS_NITRADO_TOKEN' });
  assert.equal(server.providerType,'nitrado-palworld'); assert.equal(server.providerRef,'12345678');
  const restarted = new HostedServerStore({filePath:file});
  assert.equal(restarted.get(server.id,{includePrivate:true}).providerRef,'12345678');
  assert.equal(JSON.stringify(restarted.get(server.id)).includes('12345678'),false);
});

test('provider runtime status persists but public data remains secret-free', () => {
  const { file, store } = temporaryStore();
  const server = store.add({moduleId:'palworld',name:'Main',host:'secret.internal',port:8211,providerType:'nitrado-palworld',providerRef:'9988',credentialEnv:'NITRADO_SECRET'});
  store.updateRuntime(server.id,{providerConnected:true,trackingState:'online',playerCount:4,playerMax:32,lastCheckedAt:'2026-08-26T03:00:00Z',statusMessage:'Nitrado reports started.'});
  const restarted=new HostedServerStore({filePath:file}); const publicCopy=restarted.get(server.id);
  assert.equal(publicCopy.trackingState,'online'); assert.equal(publicCopy.playerCount,4); assert.equal(publicCopy.playerMax,32);
  const serialized=JSON.stringify(publicCopy); assert.equal(serialized.includes('secret.internal'),false); assert.equal(serialized.includes('9988'),false); assert.equal(serialized.includes('NITRADO_SECRET'),false);
});

test('public tracked-server payload never exposes host ports provider references or credential env names', () => {
  const { store } = temporaryStore();
  store.add({ moduleId:'palworld', name:'Private Endpoint Test', host:'10.0.0.55', port:8211, queryPort:27015, adminPort:8212, providerType:'nitrado-palworld', providerRef:'12345678', credentialEnv:'NEXUS_PALWORLD_ADMIN_SECRET', joinInfo:'Use the Nexus join code.' });
  const serialized = JSON.stringify(trackedServersResponse(emptyRuntime(),store));
  assert.equal(serialized.includes('10.0.0.55'),false); assert.equal(serialized.includes('8212'),false); assert.equal(serialized.includes('12345678'),false); assert.equal(serialized.includes('NEXUS_PALWORLD_ADMIN_SECRET'),false); assert.match(serialized,/Use the Nexus join code/);
});

test('servers marked private are omitted from the public tracked-server registry', () => {
  const { store } = temporaryStore(); store.add({moduleId:'palworld',name:'Public',host:'public.test',port:8211,public:true}); store.add({moduleId:'oncehuman',name:'Private',host:'private.test',port:7777,public:false});
  const payload = trackedServersResponse(emptyRuntime(),store); assert.equal(payload.count,1); assert.equal(payload.servers[0].name,'Public');
});

test('game-server panel shows public join text without exposing private endpoint metadata', () => {
  const payload = renderGameServersPanel({servers:[{id:'SRV-TEST',moduleId:'palworld',game:'Palworld',name:'Palworld Main',description:'Community server',joinInfo:'Search Khaos Nexus in the browser',providerConfigured:true,providerConnected:false}]});
  const serialized=JSON.stringify(payload); assert.match(serialized,/Palworld Main/); assert.match(serialized,/Search Khaos Nexus/); assert.match(serialized,/telemetry pending/); assert.equal(serialized.includes('10.0.0.'),false);
});

test('/server exposes provider setup and status without raw secret fields', () => {
  const command=hostedServerCommand().toJSON(); assert.equal(command.name,'server');
  assert.deepEqual(command.options.map((option)=>option.name),['add','edit','setup','status','remove','list','refresh']);
  const add=command.options.find((option)=>option.name==='add'); const names=add.options.map((option)=>option.name);
  assert.ok(names.includes('provider')); assert.ok(names.includes('provider_ref')); assert.ok(names.includes('credential_env'));
  assert.equal(names.includes('password'),false); assert.equal(names.includes('token'),false); assert.equal(names.includes('secret'),false);
  const provider=add.options.find((option)=>option.name==='provider'); assert.ok(provider.choices.some((choice)=>choice.value==='nitrado-palworld')); assert.ok(provider.choices.some((choice)=>choice.value==='oncehuman-basic'));
});

test('private server list is suitable for ephemeral admin output and includes provider metadata', () => {
  const text=privateServerList([{id:'SRV-ABC',name:'Main',game:'Palworld',host:'pal.internal',port:8211,adminPort:8212,providerType:'nitrado-palworld',providerRef:'12345678',credentialEnv:'PAL_SECRET',public:true}]);
  assert.match(text,/SRV-ABC/); assert.match(text,/pal\.internal:8211/); assert.match(text,/admin 8212/); assert.match(text,/nitrado-palworld/); assert.match(text,/12345678/); assert.match(text,/PAL_SECRET/);
});

test('provider status text is private-safe', () => {
  const text=statusText({name:'Main',providerType:'nitrado-palworld',host:'secret.internal',providerRef:'12345678',credentialEnv:'PAL_SECRET'},{trackingState:'online',playerCount:4,playerMax:32,statusMessage:'Nitrado reports started.'});
  assert.match(text,/ONLINE/); assert.match(text,/4 \/ 32/); assert.equal(text.includes('secret.internal'),false); assert.equal(text.includes('12345678'),false); assert.equal(text.includes('PAL_SECRET'),false);
});

test('Once Human setup text clearly remains official-dashboard manual management', () => {
  const text=setupText({name:'Once Main'},{managementMode:'manual-official-dashboard',sections:[{title:'Scenario',settings:['Scenario selection']}],warnings:['Some changes require restart.']});
  assert.match(text,/Official NetEase dashboard/i); assert.match(text,/Scenario selection/); assert.match(text,/require restart/i);
});
