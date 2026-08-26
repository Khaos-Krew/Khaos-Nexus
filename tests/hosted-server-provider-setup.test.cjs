'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { onceHumanSetupGuide, nitradoPalworldSetupGuide, hostedServerSetupGuide } = require('../src/backend/services/once-human-custom-server-config.cjs');
const { trackingGlyph, trackingLabel, renderGameServersPanel } = require('../src/sentinel/game-servers-panel.cjs');

test('Once Human setup catalog covers the official custom-server configuration domains', () => {
  const guide = onceHumanSetupGuide({id:'SRV-OH'});
  assert.equal(guide.publicManagementApi,false);
  assert.equal(guide.managementMode,'manual-official-dashboard');
  const text=JSON.stringify(guide).toLowerCase();
  for (const term of ['identity','scenario','world','combat','building','tech','administrator','invitation','announcement','template','weapon','armor','deviation']) assert.match(text,new RegExp(term));
  assert.match(text,/restart/); assert.match(text,/scenario change|switching scenarios/);
});

test('Nitrado Palworld setup requires only service reference plus env-token reference', () => {
  const guide=nitradoPalworldSetupGuide({id:'SRV-PAL'});
  assert.equal(guide.managementMode,'nitrado-rest'); assert.equal(guide.publicManagementApi,true);
  const text=guide.requirements.join(' ');
  assert.match(text,/service ID/i); assert.match(text,/credential_env/i); assert.match(text,/Railway/i); assert.match(text,/Never paste the token/i);
});

test('hosted setup router selects NetEase manual guide for Once Human and Nitrado guide for Palworld', () => {
  assert.equal(hostedServerSetupGuide({moduleId:'oncehuman'}).managementMode,'manual-official-dashboard');
  assert.equal(hostedServerSetupGuide({moduleId:'palworld'}).managementMode,'nitrado-rest');
});

test('public game server state maps online maintenance offline manual and setup-needed distinctly', () => {
  assert.equal(trackingGlyph({trackingState:'online'}),'🟢');
  assert.equal(trackingGlyph({trackingState:'maintenance'}),'🟠');
  assert.equal(trackingGlyph({trackingState:'offline'}),'🔴');
  assert.equal(trackingGlyph({trackingState:'manual'}),'🔵');
  assert.equal(trackingGlyph({trackingState:'not-configured'}),'🟡');
  assert.match(trackingLabel({trackingState:'manual'}),/NetEase/i);
});

test('public panel can show player count while never exposing provider secrets', () => {
  const payload=renderGameServersPanel({servers:[{id:'SRV-PAL',moduleId:'palworld',game:'Palworld',name:'Main',trackingState:'online',providerConnected:true,providerConfigured:true,playerCount:5,playerMax:32,joinInfo:'Search Khaos Nexus'}]});
  const text=JSON.stringify(payload);
  assert.match(text,/Players/); assert.match(text,/5 \/ 32/); assert.equal(text.includes('providerRef'),false); assert.equal(text.includes('credentialEnv'),false); assert.equal(text.includes('service ID'),false);
});
