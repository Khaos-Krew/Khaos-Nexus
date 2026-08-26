'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState, adapterFor, statusFromNitradoPayload, HostedServerStatusService } = require('../src/backend/services/hosted-server-status-service.cjs');

test('Nitrado status parser normalizes online maintenance and offline states', () => {
  assert.equal(normalizeState('started'),'online');
  assert.equal(normalizeState('restarting'),'maintenance');
  assert.equal(normalizeState('stopped'),'offline');
});

test('legacy provider names map to host-independent adapter names', () => {
  assert.equal(adapterFor({providerType:'nitrado-palworld'}),'nitrado-api');
  assert.equal(adapterFor({providerType:'oncehuman-basic'}),'manual');
  assert.equal(adapterFor({adapterType:'palworld-rcon'}),'palworld-rcon');
});

test('Nitrado payload parser extracts player counts without provider secrets', () => {
  const status = statusFromNitradoPayload({ data:{ gameserver:{ status:'started', player_current:5, player_max:32 } } });
  assert.equal(status.trackingState,'online'); assert.equal(status.providerConnected,true); assert.equal(status.playerCount,5); assert.equal(status.playerMax,32);
  assert.equal(JSON.stringify(status).includes('token'),false);
});

test('optional Nitrado adapter sends bearer token only in request headers and returns safe status', async () => {
  process.env.NEXUS_TEST_NITRADO_TOKEN='super-secret-token';
  let request = null;
  const service = new HostedServerStatusService({ fetchImpl:async (url,options)=>{ request={url,options}; return { ok:true, status:200, json:async()=>({data:{gameserver:{status:'started',player_current:2,player_max:16}}}) }; } });
  const status = await service.probe({ moduleId:'palworld', adapterType:'nitrado-api', adapterRef:'12345', credentialEnv:'NEXUS_TEST_NITRADO_TOKEN' });
  assert.match(request.url,/\/services\/12345\/gameservers$/); assert.equal(request.options.headers.authorization,'Bearer super-secret-token');
  assert.equal(JSON.stringify(status).includes('super-secret-token'),false); assert.equal(status.trackingState,'online');
  delete process.env.NEXUS_TEST_NITRADO_TOKEN;
});

test('Nitrado adapter remains backward compatible with legacy persisted server records', async () => {
  process.env.NEXUS_TEST_NITRADO_LEGACY='legacy-token';
  let called=false;
  const service=new HostedServerStatusService({fetchImpl:async()=>{called=true;return {ok:true,status:200,json:async()=>({data:{gameserver:{status:'started'}}})};}});
  const status=await service.probe({moduleId:'palworld',providerType:'nitrado-palworld',providerRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_LEGACY'});
  assert.equal(called,true); assert.equal(status.trackingState,'online');
  delete process.env.NEXUS_TEST_NITRADO_LEGACY;
});

test('Nitrado adapter fails closed when token or service id is missing', async () => {
  const service = new HostedServerStatusService({ fetchImpl:async()=>{ throw new Error('should not fetch'); } });
  const noRef = await service.probe({moduleId:'palworld',adapterType:'nitrado-api',credentialEnv:'MISSING'});
  assert.equal(noRef.trackingState,'not-configured'); assert.equal(noRef.providerConnected,false);
  const noToken = await service.probe({moduleId:'palworld',adapterType:'nitrado-api',adapterRef:'123',credentialEnv:'MISSING'});
  assert.equal(noToken.trackingState,'not-configured'); assert.equal(noToken.providerConnected,false);
});

test('Nitrado adapter retries transient provider failures with bounded exponential backoff', async () => {
  process.env.NEXUS_TEST_NITRADO_RETRY='retry-token';
  let attempts=0; const delays=[];
  const service = new HostedServerStatusService({
    maxAttempts:3, baseDelayMs:10, circuitFailureThreshold:5,
    sleepImpl:async(ms)=>{ delays.push(ms); },
    fetchImpl:async()=>{ attempts+=1; if(attempts<3) return {ok:false,status:503,json:async()=>({})}; return {ok:true,status:200,json:async()=>({data:{gameserver:{status:'started'}}})}; }
  });
  const status=await service.probe({moduleId:'palworld',adapterType:'nitrado-api',adapterRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_RETRY'});
  assert.equal(attempts,3); assert.deepEqual(delays,[10,20]); assert.equal(status.trackingState,'online');
  delete process.env.NEXUS_TEST_NITRADO_RETRY;
});

test('Nitrado adapter does not retry credential rejection and does not echo secrets', async () => {
  process.env.NEXUS_TEST_NITRADO_AUTH='never-echo-this';
  let attempts=0;
  const service=new HostedServerStatusService({maxAttempts:3,sleepImpl:async()=>{},fetchImpl:async()=>{attempts+=1;return {ok:false,status:401,json:async()=>({})};}});
  const status=await service.probe({moduleId:'palworld',adapterType:'nitrado-api',adapterRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_AUTH'});
  assert.equal(attempts,1); assert.equal(status.trackingState,'not-configured'); assert.match(status.statusMessage,/credential/i); assert.equal(JSON.stringify(status).includes('never-echo-this'),false);
  delete process.env.NEXUS_TEST_NITRADO_AUTH;
});

test('Nitrado circuit breaker pauses repeated transient failures without additional provider calls', async () => {
  process.env.NEXUS_TEST_NITRADO_CIRCUIT='circuit-token';
  let calls=0; let now=1000;
  const service=new HostedServerStatusService({
    maxAttempts:1,circuitFailureThreshold:2,circuitOpenMs:60000,now:()=>now,sleepImpl:async()=>{},
    fetchImpl:async()=>{calls+=1;return {ok:false,status:503,json:async()=>({})};}
  });
  const server={moduleId:'palworld',adapterType:'nitrado-api',adapterRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_CIRCUIT'};
  const first=await service.probe(server); const second=await service.probe(server); const third=await service.probe(server);
  assert.equal(first.trackingState,'offline'); assert.equal(second.trackingState,'offline'); assert.match(second.statusMessage,/temporarily paused/i);
  assert.match(third.statusMessage,/temporarily paused/i); assert.equal(calls,2);
  now+=60001;
  await service.probe(server); assert.equal(calls,3);
  delete process.env.NEXUS_TEST_NITRADO_CIRCUIT;
});

test('Palworld REST status works independently of hosting provider', async () => {
  process.env.NEXUS_TEST_PAL_REST='admin-password';
  let connection=null;
  const service=new HostedServerStatusService({
    restClientFactory:(value)=>{connection=value;return {
      info:async()=>({currentplayernum:3,maxplayernum:32}),
      players:async()=>({players:[{name:'A'},{name:'B'},{name:'C'}]})
    };}
  });
  const status=await service.probe({moduleId:'palworld',adapterType:'palworld-rest',hostingProvider:'Some Other Host',host:'pal.example.test',adminPort:8212,credentialEnv:'NEXUS_TEST_PAL_REST'});
  assert.equal(connection.host,'pal.example.test'); assert.equal(connection.port,8212); assert.equal(connection.password,'admin-password');
  assert.equal(status.trackingState,'online'); assert.equal(status.playerCount,3); assert.equal(status.playerMax,32);
  assert.equal(JSON.stringify(status).includes('admin-password'),false);
  delete process.env.NEXUS_TEST_PAL_REST;
});

test('Palworld RCON status works independently of hosting provider and only returns safe summary', async () => {
  process.env.NEXUS_TEST_PAL_RCON='rcon-password';
  const commands=[]; let connection=null;
  const service=new HostedServerStatusService({
    rconFactory:(value)=>{connection=value;return {execute:async(command)=>{commands.push(command);if(command==='Info')return 'Palworld server';return 'name,playeruid,steamid\nAlice,1,2\nBob,3,4';}};}
  });
  const status=await service.probe({moduleId:'palworld',adapterType:'palworld-rcon',hostingProvider:'Nitrado',host:'pal.example.test',adminPort:25575,credentialEnv:'NEXUS_TEST_PAL_RCON'});
  assert.equal(connection.host,'pal.example.test'); assert.equal(connection.port,25575); assert.equal(connection.password,'rcon-password');
  assert.deepEqual(commands,['Info','ShowPlayers']); assert.equal(status.trackingState,'online'); assert.equal(status.playerCount,2);
  assert.equal(JSON.stringify(status).includes('rcon-password'),false);
  delete process.env.NEXUS_TEST_PAL_RCON;
});

test('REST and RCON fail closed when endpoint or credential is missing', async () => {
  const service=new HostedServerStatusService({restClientFactory:()=>{throw new Error('should not create');},rconFactory:()=>{throw new Error('should not create');}});
  const rest=await service.probe({moduleId:'palworld',adapterType:'palworld-rest'});
  const rcon=await service.probe({moduleId:'palworld',adapterType:'palworld-rcon'});
  assert.equal(rest.trackingState,'not-configured'); assert.equal(rcon.trackingState,'not-configured');
});

test('Once Human manual management is host independent and does not claim live API control', async () => {
  const service = new HostedServerStatusService();
  const status = await service.probe({moduleId:'oncehuman',adapterType:'manual',hostingProvider:'NetEase'});
  assert.equal(status.trackingState,'manual'); assert.match(status.statusMessage,/manual management/i); assert.equal(status.providerConnected,false);
});
