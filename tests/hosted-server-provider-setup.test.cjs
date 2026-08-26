'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { onceHumanSetupGuide, palworldSetupGuide, nitradoPalworldSetupGuide, hostedServerSetupGuide } = require('../src/backend/services/once-human-custom-server-config.cjs');
const { trackingGlyph, trackingLabel, renderGameServersPanel } = require('../src/sentinel/game-servers-panel.cjs');

test('Once Human setup catalog covers custom-server configuration domains without making a hosting company authoritative', () => {
  const guide = onceHumanSetupGuide({id:'SRV-OH', hostingType:'hosted-site'});
  assert.equal(guide.publicManagementApi,false);
  assert.equal(guide.managementMode,'manual-official-dashboard');
  const text=JSON.stringify(guide).toLowerCase();
  for (const term of ['identity','scenario','world','combat','building','tech','administrator','invitation','announcement','template','weapon','armor','deviation']) assert.match(text,new RegExp(term));
  assert.match(text,/restart/); assert.match(text,/scenario change|switching scenarios/);
  assert.match(text,/self-hosted/); assert.match(text,/hosted site/); assert.match(text,/hosting company is not part of the server identity/);
});

test('Palworld setup exposes REST RCON and registration-only choices independently of hosting company', () => {
  const guide=palworldSetupGuide({id:'SRV-PAL',hostingType:'hosted-site'});
  assert.equal(guide.managementMode,'palworld-adapters');
  const ids=guide.options.map((option)=>option.id);
  for (const id of ['rest','rcon','none']) assert.ok(ids.includes(id));
  assert.equal(ids.includes('nitrado-api'),false);
  const text=JSON.stringify(guide);
  assert.match(text,/Self-Hosted or on a Hosted Site/i); assert.match(text,/environment variable/i);
  assert.deepEqual(nitradoPalworldSetupGuide({id:'SRV-PAL'}).options.map((option)=>option.id),ids);
});

test('setup router selects game guides rather than binding registration to NetEase Nitrado Akliz or CreeperHost', () => {
  assert.equal(hostedServerSetupGuide({moduleId:'oncehuman'}).managementMode,'manual-official-dashboard');
  assert.equal(hostedServerSetupGuide({moduleId:'palworld'}).managementMode,'palworld-adapters');
  const normalPalworld=JSON.stringify(hostedServerSetupGuide({moduleId:'palworld'}));
  assert.equal(/Nitrado|Akliz|CreeperHost|NetEase/.test(normalPalworld),false);
});

test('public game server state exposes only Online Maintenance and Offline health states', () => {
  assert.equal(trackingGlyph({trackingState:'online'}),'🟢');
  assert.equal(trackingGlyph({trackingState:'maintenance'}),'🟡');
  assert.equal(trackingGlyph({trackingState:'offline'}),'🔴');
  for (const state of ['manual','registered','configured','not-configured']) {
    assert.equal(trackingGlyph({trackingState:state}),'');
    assert.equal(trackingLabel({trackingState:state}),'');
  }
  assert.equal(trackingLabel({trackingState:'online'}),'Online');
  assert.equal(trackingLabel({trackingState:'maintenance'}),'Maintenance');
  assert.equal(trackingLabel({trackingState:'offline'}),'Offline');
});

test('public panel can show player count while never exposing adapter secrets', () => {
  const payload=renderGameServersPanel({servers:[{id:'SRV-PAL',moduleId:'palworld',game:'Palworld',name:'Main',trackingState:'online',providerConnected:true,providerConfigured:true,playerCount:5,playerMax:32,joinInfo:'Search Khaos Nexus'}]});
  const text=JSON.stringify(payload);
  assert.match(text,/Players/); assert.match(text,/5 \/ 32/); assert.equal(text.includes('providerRef'),false); assert.equal(text.includes('adapterRef'),false); assert.equal(text.includes('credentialEnv'),false); assert.equal(text.includes('service ID'),false);
});
