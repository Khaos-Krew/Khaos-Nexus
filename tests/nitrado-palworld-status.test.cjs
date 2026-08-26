'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeState, statusFromNitradoPayload, HostedServerStatusService } = require('../src/backend/services/hosted-server-status-service.cjs');

test('Nitrado status parser normalizes online maintenance and offline states', () => {
  assert.equal(normalizeState('started'),'online');
  assert.equal(normalizeState('restarting'),'maintenance');
  assert.equal(normalizeState('stopped'),'offline');
});

test('Nitrado payload parser extracts player counts without provider secrets', () => {
  const status = statusFromNitradoPayload({ data:{ gameserver:{ status:'started', player_current:5, player_max:32 } } });
  assert.equal(status.trackingState,'online'); assert.equal(status.providerConnected,true); assert.equal(status.playerCount,5); assert.equal(status.playerMax,32);
  assert.equal(JSON.stringify(status).includes('token'),false);
});

test('Nitrado adapter sends bearer token only in request headers and returns safe status', async () => {
  process.env.NEXUS_TEST_NITRADO_TOKEN='super-secret-token';
  let request = null;
  const service = new HostedServerStatusService({ fetchImpl:async (url,options)=>{ request={url,options}; return { ok:true, status:200, json:async()=>({data:{gameserver:{status:'started',player_current:2,player_max:16}}}) }; } });
  const status = await service.probe({ moduleId:'palworld', providerType:'nitrado-palworld', providerRef:'12345', credentialEnv:'NEXUS_TEST_NITRADO_TOKEN' });
  assert.match(request.url,/\/services\/12345\/gameservers$/); assert.equal(request.options.headers.authorization,'Bearer super-secret-token');
  assert.equal(JSON.stringify(status).includes('super-secret-token'),false); assert.equal(status.trackingState,'online');
  delete process.env.NEXUS_TEST_NITRADO_TOKEN;
});

test('Nitrado adapter fails closed when token or service id is missing', async () => {
  const service = new HostedServerStatusService({ fetchImpl:async()=>{ throw new Error('should not fetch'); } });
  const noRef = await service.probe({moduleId:'palworld',providerType:'nitrado-palworld',credentialEnv:'MISSING'});
  assert.equal(noRef.trackingState,'not-configured'); assert.equal(noRef.providerConnected,false);
  const noToken = await service.probe({moduleId:'palworld',providerType:'nitrado-palworld',providerRef:'123',credentialEnv:'MISSING'});
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
  const status=await service.probe({moduleId:'palworld',providerType:'nitrado-palworld',providerRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_RETRY'});
  assert.equal(attempts,3); assert.deepEqual(delays,[10,20]); assert.equal(status.trackingState,'online');
  delete process.env.NEXUS_TEST_NITRADO_RETRY;
});

test('Nitrado adapter does not retry credential rejection and does not echo secrets', async () => {
  process.env.NEXUS_TEST_NITRADO_AUTH='never-echo-this';
  let attempts=0;
  const service=new HostedServerStatusService({maxAttempts:3,sleepImpl:async()=>{},fetchImpl:async()=>{attempts+=1;return {ok:false,status:401,json:async()=>({})};}});
  const status=await service.probe({moduleId:'palworld',providerType:'nitrado-palworld',providerRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_AUTH'});
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
  const server={moduleId:'palworld',providerType:'nitrado-palworld',providerRef:'123',credentialEnv:'NEXUS_TEST_NITRADO_CIRCUIT'};
  const first=await service.probe(server); const second=await service.probe(server); const third=await service.probe(server);
  assert.equal(first.trackingState,'offline'); assert.equal(second.trackingState,'offline'); assert.match(second.statusMessage,/temporarily paused/i);
  assert.match(third.statusMessage,/temporarily paused/i); assert.equal(calls,2);
  now+=60001;
  await service.probe(server); assert.equal(calls,3);
  delete process.env.NEXUS_TEST_NITRADO_CIRCUIT;
});

test('Once Human remains explicit manual NetEase management instead of claiming live API control', async () => {
  const service = new HostedServerStatusService();
  const status = await service.probe({moduleId:'oncehuman',providerType:'oncehuman-basic'});
  assert.equal(status.trackingState,'manual'); assert.match(status.statusMessage,/NetEase/i); assert.equal(status.providerConnected,false);
});
