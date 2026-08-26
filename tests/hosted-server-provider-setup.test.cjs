'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { onceHumanSetupGuide, palworldSetupGuide, nitradoPalworldSetupGuide, hostedServerSetupGuide } = require('../src/backend/services/once-human-custom-server-config.cjs');
const { trackingGlyph, trackingLabel, renderGameServersPanel } = require('../src/sentinel/game-servers-panel.cjs');

test('Once Human setup catalog covers custom-server configuration domains without making host identity authoritative', () => {
  const guide = onceHumanSetupGuide({id:'SRV-OH', hostingProvider:'Any Host'});
  assert.equal(guide.publicManagementApi,false);
  assert.equal(guide.managementMode,'manual-official-dashboard');
  const text=JSON.stringify(guide).toLowerCase();
  for (const term of ['identity','scenario','world','combat','building','tech','administrator','invitation','announcement','template','weapon','armor','deviation']) assert.match(text,new RegExp(term));
  assert.match(text,/restart/); assert.match(text,/scenario change|switching scenarios/); assert.match(text,/independent of the hosting company/);
});

test('Palworld setup exposes REST RCON Nitrado API and registration-only choices independently of hosting company', () => {
  const guide=palworldSetupGuide({id:'SRV-PAL'});
  assert.equal(guide.managementMode,'palworld-adapters');
  const ids=guide.options.map((option)=>option.id);
  for (const id of ['palworld-rest','palworld-rcon','nitrado-api','none']) assert.ok(ids.includes(id));
  const text=JSON.stringify(guide);
  assert.match(text,/hosting provider not required/i); assert.match(text,/independent of Nitrado/i); assert.match(text,/service ID/i); assert.match(text,/environment variable/i);
  assert.equal(nitradoPalworldSetupGuide({id:'SRV-PAL'}).managementMode,'palworld-adapters');
});

test('setup router selects game guides rather than binding registration to NetEase or Nitrado', () => {
  assert.equal(hostedServerSetupGuide({moduleId:'oncehuman'}).managementMode,'manual-official-dashboard');
  assert.equal(hostedServerSetupGuide({moduleId:'palworld'}).managementMode,'palworld-adapters');
});

test('public game server state maps online maintenance offline manual registered and adapter-needs-config distinctly', () => {
  assert.equal(trackingGlyph({trackingState:'online'}),'🟢');
  assert.equal(trackingGlyph({trackingState:'maintenance'}),'🟠');
  assert.equal(trackingGlyph({trackingState:'offline'}),'🔴');
  assert.equal(trackingGlyph({trackingState:'manual'}),'🔵');
  assert.equal(trackingGlyph({trackingState:'registered'}),'🟡');
  assert.equal(trackingGlyph({trackingState:'not-configured'}),'🟡');
  assert.match(trackingLabel({trackingState:'manual'}),/manual management/i);
  assert.match(trackingLabel({trackingState:'registered'}),/telemetry optional/i);
});

test('public panel can show player count while never exposing adapter secrets', () => {
  const payload=renderGameServersPanel({servers:[{id:'SRV-PAL',moduleId:'palworld',game:'Palworld',name:'Main',trackingState:'online',providerConnected:true,providerConfigured:true,playerCount:5,playerMax:32,joinInfo:'Search Khaos Nexus'}]});
  const text=JSON.stringify(payload);
  assert.match(text,/Players/); assert.match(text,/5 \/ 32/); assert.equal(text.includes('providerRef'),false); assert.equal(text.includes('adapterRef'),false); assert.equal(text.includes('credentialEnv'),false); assert.equal(text.includes('service ID'),false);
});
