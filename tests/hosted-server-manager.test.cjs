'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HostedServerStore } = require('../src/backend/core/hosted-server-store.cjs');
const { trackedServersResponse } = require('../src/backend/tracked-servers.cjs');
const {
  hostedServerCommand,
  privateServerList,
  eligiblePrivateServers,
  privateAccessText,
  statusText,
  setupText
} = require('../src/sentinel/hosted-server-manager.cjs');
const { renderGameServersPanel, groupPrivateServersByRank } = require('../src/sentinel/game-servers-panel.cjs');

function temporaryStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-hosted-servers-'));
  return { dir, file: path.join(dir, 'hosted-servers.json'), store: new HostedServerStore({ filePath: path.join(dir, 'hosted-servers.json') }) };
}
function emptyRuntime() { return { config: { modules: {} }, manifests: () => [] }; }

test('server registration uses only self-hosted or hosted-site and persists across restart', () => {
  const { file, store } = temporaryStore();
  const pal = store.add({ moduleId:'palworld', name:'Palworld Main', hostingType:'hosted-site', connectionType:'rcon', public:true, joinInfo:'Search Khaos Nexus.' });
  const once = store.add({ moduleId:'oncehuman', name:'Once Human Main', hostingType:'hosted-site', connectionType:'manual', public:true, description:'Nexus Once Human server' });
  assert.match(pal.id,/^SRV-/); assert.match(once.id,/^SRV-/);
  assert.equal(pal.hostingType,'hosted-site'); assert.equal(pal.connectionType,'rcon'); assert.equal(pal.adapterType,'palworld-rcon');
  assert.equal(once.hostingType,'hosted-site'); assert.equal(once.connectionType,'manual'); assert.equal(once.adapterType,'manual');
  const restarted = new HostedServerStore({ filePath:file });
  assert.equal(restarted.list({includePrivate:true}).length,2);
  assert.throws(()=>store.add({moduleId:'palworld',name:'Bad Hosting',hostingType:'nitrado'}),/self-hosted or hosted-site/i);
});

test('REST and RCON connection metadata can be updated without recreating server identity', () => {
  const { store } = temporaryStore();
  const original = store.add({ moduleId:'palworld', name:'Main', hostingType:'hosted-site', connectionType:'none' });
  const configured = store.update(original.id, {
    host:'pal.example.test', port:8211, adminPort:8212, connectionType:'rest', credentialEnv:'PAL_SECRET'
  });
  assert.equal(configured.id, original.id);
  assert.equal(configured.host,'pal.example.test'); assert.equal(configured.port,8211); assert.equal(configured.adminPort,8212);
  assert.equal(configured.connectionType,'rest'); assert.equal(configured.adapterType,'palworld-rest'); assert.equal(configured.credentialEnv,'PAL_SECRET');
  assert.equal(configured.hostingProvider,'');
});

test('private servers default to Cipher Runner and reject non-purchasable access ranks', () => {
  const { store } = temporaryStore();
  const server = store.add({moduleId:'palworld',name:'Private Main',hostingType:'hosted-site',connectionType:'rcon',public:false,joinInfo:'Private join code'});
  assert.equal(server.accessRank,'cipher-runner');
  assert.equal(server.joinInfo,'Private join code');
  assert.throws(()=>store.add({moduleId:'palworld',name:'Bad Rank',hostingType:'hosted-site',public:false,accessRank:'origin-founder'}),/purchasable Nexus rank/i);
  assert.throws(()=>store.add({moduleId:'palworld',name:'Bad Free Rank',hostingType:'hosted-site',public:false,accessRank:'shadow-recruit'}),/purchasable Nexus rank/i);
});

test('duplicate endpoint is rejected and endpoint-free duplicate identity is rejected', () => {
  const { store } = temporaryStore();
  store.add({ moduleId:'palworld', name:'One', hostingType:'hosted-site', host:'pal.example.test', port:8211 });
  assert.throws(()=>store.add({ moduleId:'palworld', name:'Different Name', hostingType:'self-hosted', host:'PAL.EXAMPLE.TEST', port:8211 }),/already registered/i);
  store.add({ moduleId:'oncehuman', name:'Once Alpha', hostingType:'hosted-site' });
  assert.throws(()=>store.add({ moduleId:'oncehuman', name:'once alpha', hostingType:'hosted-site' }),/already registered/i);
});

test('legacy provider-specific values remain readable internally but are hidden from normal server identity', () => {
  const { store } = temporaryStore();
  const pal = store.add({ moduleId:'palworld', name:'Legacy Pal', hostingType:'hosted-site', providerType:'nitrado-palworld', providerRef:'12345678', credentialEnv:'NEXUS_NITRADO_TOKEN' });
  assert.equal(pal.adapterType,'nitrado-api'); assert.equal(pal.providerType,'nitrado-api'); assert.equal(pal.adapterRef,'12345678');
  const publicPal = store.get(pal.id);
  assert.equal(publicPal.hostingProvider,'');
  assert.equal(publicPal.connectionType,'none');
  assert.equal(JSON.stringify(publicPal).includes('12345678'),false);
});

test('provider runtime status persists but public data remains secret-free', () => {
  const { file, store } = temporaryStore();
  const server = store.add({moduleId:'palworld',name:'Main',hostingType:'hosted-site',host:'secret.internal',port:8211,adapterType:'nitrado-api',adapterRef:'9988',credentialEnv:'NITRADO_SECRET'});
  store.updateRuntime(server.id,{providerConnected:true,trackingState:'online',playerCount:4,playerMax:32,lastCheckedAt:'2026-08-26T03:00:00Z',statusMessage:'Adapter reports started.'});
  const restarted=new HostedServerStore({filePath:file}); const publicCopy=restarted.get(server.id);
  assert.equal(publicCopy.trackingState,'online'); assert.equal(publicCopy.playerCount,4); assert.equal(publicCopy.playerMax,32);
  const serialized=JSON.stringify(publicCopy); assert.equal(serialized.includes('secret.internal'),false); assert.equal(serialized.includes('9988'),false); assert.equal(serialized.includes('NITRADO_SECRET'),false);
});

test('tracked-server response keeps public join info and strips private join details', () => {
  const { store } = temporaryStore();
  store.add({ moduleId:'palworld', name:'Public Server', hostingType:'hosted-site', public:true, joinInfo:'Public join code' });
  store.add({ moduleId:'oncehuman', name:'Private Server', hostingType:'hosted-site', public:false, accessRank:'nexus-raider', joinInfo:'SECRET PRIVATE CODE' });
  const payload = trackedServersResponse(emptyRuntime(),store);
  assert.equal(payload.count,1); assert.equal(payload.privateCount,1);
  assert.equal(payload.servers[0].joinInfo,'Public join code');
  assert.equal(payload.privateServers[0].joinInfo,'');
  assert.equal(payload.privateServers[0].accessRank,'nexus-raider');
  assert.equal(JSON.stringify(payload).includes('SECRET PRIVATE CODE'),false);
});

test('game-server panel groups public servers by game and private servers by paid rank', () => {
  const privateServers = [
    {id:'SRV-P1',moduleId:'palworld',game:'Palworld',name:'Cipher Pal',public:false,accessRank:'cipher-runner',trackingState:'registered'},
    {id:'SRV-O1',moduleId:'oncehuman',game:'Once Human',name:'Warden Once',public:false,accessRank:'khaos-warden',trackingState:'manual'}
  ];
  const grouped = groupPrivateServersByRank(privateServers);
  assert.deepEqual(grouped.map((group)=>group.rank.id),['cipher-runner','khaos-warden']);
  const payload = renderGameServersPanel({
    servers:[{id:'SRV-PUB',moduleId:'palworld',game:'Palworld',name:'Public Palworld',joinInfo:'Search Khaos Nexus',trackingState:'online'}],
    privateServers
  });
  const serialized=JSON.stringify(payload);
  assert.match(serialized,/🎮 Palworld/); assert.match(serialized,/Public Palworld/); assert.match(serialized,/Search Khaos Nexus/);
  assert.match(serialized,/Cipher Runner Private Servers/); assert.match(serialized,/Khaos Warden Private Servers/);
  assert.match(serialized,/\/server access/); assert.equal(serialized.includes('SECRET'),false);
});

test('/server setup asks for simple hosting connection and public/private choices with no hosting-company field', () => {
  const command=hostedServerCommand().toJSON(); assert.equal(command.name,'server');
  assert.deepEqual(command.options.map((option)=>option.name),['add','edit','configure','setup','status','access','remove','list','refresh']);
  const add=command.options.find((option)=>option.name==='add');
  const required=add.options.filter((option)=>option.required).map((option)=>option.name);
  assert.deepEqual(required,['game','name','hosting','connection','public']);
  const names=add.options.map((option)=>option.name);
  for (const requiredName of ['hosting','connection','paid_rank','host','admin_port','credential_env']) assert.ok(names.includes(requiredName));
  for (const forbidden of ['hosting_provider','provider','adapter','adapter_ref','provider_ref','password','token','secret']) assert.equal(names.includes(forbidden),false);
  const hosting=add.options.find((option)=>option.name==='hosting');
  assert.deepEqual(hosting.choices.map((choice)=>choice.value),['self-hosted','hosted-site']);
  const connection=add.options.find((option)=>option.name==='connection');
  assert.deepEqual(connection.choices.map((choice)=>choice.value),['rest','rcon','manual','none']);
  const paid=add.options.find((option)=>option.name==='paid_rank');
  assert.deepEqual(paid.choices.map((choice)=>choice.value),['cipher-runner','nexus-raider','khaos-warden','blackout-legend']);
});

test('private server access is cumulative by paid rank and never includes endpoint or credential metadata', () => {
  const servers=[
    {id:'A',name:'Cipher',game:'Palworld',public:false,accessRank:'cipher-runner',joinInfo:'cipher-code',host:'secret-one',credentialEnv:'SECRET_ONE',trackingState:'online'},
    {id:'B',name:'Raider',game:'Once Human',public:false,accessRank:'nexus-raider',joinInfo:'raider-code',host:'secret-two',credentialEnv:'SECRET_TWO',trackingState:'manual'},
    {id:'C',name:'Warden',game:'Palworld',public:false,accessRank:'khaos-warden',joinInfo:'warden-code',trackingState:'registered'}
  ];
  const raider={id:'nexus-raider',name:'Nexus Raider',level:2};
  assert.deepEqual(eligiblePrivateServers(servers,raider).map((server)=>server.id),['A','B']);
  const text=privateAccessText(servers,raider);
  assert.match(text,/cipher-code/); assert.match(text,/raider-code/); assert.equal(text.includes('warden-code'),false);
  assert.equal(text.includes('secret-one'),false); assert.equal(text.includes('SECRET_ONE'),false);
});

test('private admin server list describes hosting type and connection without host-company labels', () => {
  const text=privateServerList([{id:'SRV-ABC',name:'Main',game:'Palworld',host:'pal.internal',port:8211,adminPort:8212,connectionType:'rcon',hostingType:'hosted-site',credentialEnv:'PAL_SECRET',public:false,accessRank:'blackout-legend'}]);
  assert.match(text,/SRV-ABC/); assert.match(text,/pal\.internal:8211/); assert.match(text,/admin 8212/); assert.match(text,/connection rcon/); assert.match(text,/hosted site/); assert.match(text,/Blackout Legend/); assert.match(text,/PAL_SECRET/);
  assert.equal(/Nitrado|Akliz|CreeperHost|NetEase/i.test(text),false);
});

test('connection status text is private-safe', () => {
  const text=statusText({name:'Main',connectionType:'rcon',host:'secret.internal',credentialEnv:'PAL_SECRET'},{trackingState:'online',playerCount:4,playerMax:32,statusMessage:'RCON responded.'});
  assert.match(text,/RCON/); assert.match(text,/ONLINE/); assert.match(text,/4 \/ 32/); assert.equal(text.includes('secret.internal'),false); assert.equal(text.includes('PAL_SECRET'),false);
});

test('Once Human setup text uses hosting type and keeps official management path explicit', () => {
  const text=setupText({name:'Once Main',hostingType:'hosted-site'},{managementMode:'manual-official-dashboard',sections:[{title:'Scenario',settings:['Scenario selection']}],warnings:['Some changes require restart.']});
  assert.match(text,/Hosted Site/); assert.match(text,/official server-management/i); assert.match(text,/Scenario selection/); assert.match(text,/require restart/i);
});
