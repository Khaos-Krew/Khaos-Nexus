'use strict';

const { getModule } = require('./modules/catalog.cjs');

function safeName(value, fallback = 'Server') {
  const text = String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return text || fallback;
}
function validPort(value) { const port = Number(value); return Number.isInteger(port) && port >= 1 && port <= 65535; }
function configuredServerDefinition(value = {}) { return Boolean(String(value.host || '').trim()) && validPort(value.port); }
function publicTrackedServer(moduleId, definition = {}, index = 0, manifest = {}) {
  const module = getModule(moduleId); const game = module?.name || safeName(moduleId, 'Game'); const name = safeName(definition.name, game);
  return {
    id:`${moduleId}:${index + 1}`, moduleId, game, gameName:game, name, public:true, accessRank:'',
    ownershipType:'nexus-official', listingState:'listed', serverType:'dedicated',
    providerConfigured:manifest?.configured === true, providerConnected:manifest?.connected === true,
    providerKind:safeName(manifest?.providerKind || 'none','none'), trackingState:manifest?.configured === true ? 'active' : 'configured'
  };
}
function moduleServerDefinitions(moduleConfig = {}) {
  const connection = moduleConfig?.connection; if (!connection || typeof connection !== 'object') return [];
  if (Array.isArray(connection.servers)) return connection.servers.filter(configuredServerDefinition);
  return configuredServerDefinition(connection) ? [connection] : [];
}
function configuredTrackedServers(runtime) {
  const config = runtime?.config || {}; const manifests = new Map((runtime?.manifests?.() || []).map((item)=>[item.id,item])); const servers=[];
  for (const [moduleId,moduleConfig] of Object.entries(config.modules || {})) {
    if (moduleConfig?.enabled === false) continue;
    const manifest=manifests.get(moduleId) || {};
    moduleServerDefinitions(moduleConfig).forEach((definition,index)=>servers.push(publicTrackedServer(moduleId,definition,index,manifest)));
  }
  return servers;
}
function listed(server = {}) { return String(server.listingState || 'listed') === 'listed'; }
function trackedServers(runtime, hostedStore = null) {
  const configured=configuredTrackedServers(runtime);
  const hosted=hostedStore?.list ? hostedStore.list({includeUnlisted:false}).filter((server)=>server.public !== false && listed(server)) : [];
  const byIdentity=new Map();
  for (const server of [...configured,...hosted]) byIdentity.set(String(server.id || `${server.moduleId}:${server.name}`),server);
  return [...byIdentity.values()].sort((a,b)=>String(a.game || '').localeCompare(String(b.game || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}
function privateTrackedServers(hostedStore = null) {
  if (!hostedStore?.list) return [];
  return hostedStore.list({includeUnlisted:false}).filter((server)=>server.public === false && listed(server)).map((server)=>({...server,joinInfo:''}))
    .sort((a,b)=>String(a.accessRank || '').localeCompare(String(b.accessRank || '')) || String(a.game || '').localeCompare(String(b.game || '')) || String(a.name || '').localeCompare(String(b.name || '')));
}
function trackedServersResponse(runtime, hostedStore = null) {
  const servers=trackedServers(runtime,hostedStore), privateServers=privateTrackedServers(hostedStore);
  return { ok:true, generatedAt:new Date().toISOString(), count:servers.length, privateCount:privateServers.length, servers, privateServers };
}

module.exports={ safeName, validPort, configuredServerDefinition, publicTrackedServer, moduleServerDefinitions, configuredTrackedServers, trackedServers, privateTrackedServers, trackedServersResponse };
