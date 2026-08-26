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

test('Once Human remains explicit manual NetEase management instead of claiming live API control', async () => {
  const service = new HostedServerStatusService();
  const status = await service.probe({moduleId:'oncehuman',providerType:'oncehuman-basic'});
  assert.equal(status.trackingState,'manual'); assert.match(status.statusMessage,/NetEase/i); assert.equal(status.providerConnected,false);
});
