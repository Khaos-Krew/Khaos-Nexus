'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { JsonStore, clone } = require('./json-store.cjs');
const { isPurchasableRank, rankById } = require('../../shared/ranks.cjs');
const {
  normalizeGameId, gameNameFromInput, inferServerType, normalizeServerDefinition,
  hasReliableAutomatedHealth, publicJoinInfo
} = require('../../shared/game-server-catalog.cjs');

// Kept as a compatibility export. The v5 registry intentionally accepts any game.
const SUPPORTED_GAMES = new Set(['palworld','oncehuman','minecraft','ark']);
const HOSTING_TYPES = new Set(['self-hosted', 'hosted-site']);
const CONNECTION_TYPES = new Set(['none', 'rest', 'rcon', 'manual']);
const ADAPTER_TYPES = new Set(['none', 'palworld-rest', 'palworld-rcon', 'nitrado-api', 'manual', 'custom']);
const PROVIDER_TYPES = ADAPTER_TYPES;
const OWNERSHIP_TYPES = new Set(['nexus-official','community-approved']);
const LISTING_STATES = new Set(['listed','hidden','suspended']);
const DEFAULT_OFFLINE_POLICY = Object.freeze({ warningHours:24, offlineHours:48, hideHours:72, suspendHours:168 });

function safeText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function normalizeHost(value) { return safeText(value, 253).toLowerCase(); }
function normalizePort(value, fallback = null) {
  if (value === '' || value === null || value === undefined || Number(value) === 0) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  return port;
}
function normalizeGame(value) { return normalizeGameId(value); }
function gameLabel(moduleId, server = {}) { return safeText(server.gameName,80) || gameNameFromInput('', moduleId); }
function normalizeHostingType(value, fallback = 'hosted-site') {
  const normalized = safeText(value || fallback, 40).toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');
  if (!HOSTING_TYPES.has(normalized)) throw new Error('Hosting type must be self-hosted or hosted-site.');
  return normalized;
}
function legacyAdapterType(value) {
  const type = safeText(value, 40).toLowerCase();
  if (type === 'nitrado-palworld') return 'nitrado-api';
  if (type === 'oncehuman-basic') return 'manual';
  if (ADAPTER_TYPES.has(type)) return type;
  return 'none';
}
function connectionTypeFromAdapter(value) {
  const adapter = legacyAdapterType(value);
  if (adapter === 'palworld-rest') return 'rest';
  if (adapter === 'palworld-rcon') return 'rcon';
  if (adapter === 'manual') return 'manual';
  return 'none';
}
function normalizeConnectionType(value, fallback = 'none') {
  const raw = safeText(value || fallback, 40).toLowerCase();
  if (CONNECTION_TYPES.has(raw)) return raw;
  if (ADAPTER_TYPES.has(raw) || raw === 'nitrado-palworld' || raw === 'oncehuman-basic') return connectionTypeFromAdapter(raw);
  throw new Error('Connection type must be REST, RCON, manual, or none.');
}
function adapterTypeForConnection(moduleId, connectionType) {
  const connection = normalizeConnectionType(connectionType, 'none');
  if (connection === 'none') return 'none';
  if (connection === 'manual') return 'manual';
  if (moduleId === 'palworld' && connection === 'rest') return 'palworld-rest';
  if (moduleId === 'palworld' && connection === 'rcon') return 'palworld-rcon';
  return 'custom';
}
function adapterTypeFor(server = {}) { return legacyAdapterType(server.adapterType || server.providerType || 'none'); }
function connectionTypeFor(server = {}) {
  if (server.connectionType) return normalizeConnectionType(server.connectionType, 'none');
  return connectionTypeFromAdapter(server.adapterType || server.providerType || 'none');
}
function normalizeAccessRank(value, isPublic = true) {
  if (isPublic) return '';
  const rank = rankById(value || 'cipher-runner');
  if (!isPurchasableRank(rank)) throw new Error('Private servers must use a purchasable Nexus rank.');
  return rank.id;
}
function normalizeOwnership(value) {
  const normalized = safeText(value || 'nexus-official',40).toLowerCase();
  if (!OWNERSHIP_TYPES.has(normalized)) throw new Error('Server ownership must be Nexus Official or approved community.');
  return normalized;
}
function normalizeListingState(value) {
  const normalized = safeText(value || 'listed',30).toLowerCase();
  if (!LISTING_STATES.has(normalized)) throw new Error('Listing state must be listed, hidden, or suspended.');
  return normalized;
}
function parseTime(value) { const time = Date.parse(String(value || '')); return Number.isFinite(time) ? time : null; }
function hoursBetween(start, end) { return Math.max(0,(end-start)/36e5); }

function publicServer(server = {}) {
  const adapterType = adapterTypeFor(server);
  const connectionType = connectionTypeFor(server);
  const providerConnected = Boolean(server.providerConnected);
  const isPublic = server.public !== false;
  const ownershipType = OWNERSHIP_TYPES.has(server.ownershipType) ? server.ownershipType : 'nexus-official';
  const listingState = LISTING_STATES.has(server.listingState) ? server.listingState : 'listed';
  const moduleId = String(server.moduleId || '');
  return {
    id:String(server.id || ''), moduleId, game:gameLabel(moduleId,server), gameName:gameLabel(moduleId,server),
    serverType:inferServerType(server), ownershipType, listingState,
    name:String(server.name || gameLabel(moduleId,server) || 'Server'), description:String(server.description || ''),
    joinInfo:isPublic ? publicJoinInfo(server) : '', joinVisibility:String(server.joinVisibility || 'public'), public:isPublic,
    region:String(server.region || ''), scenario:String(server.scenario || ''),
    hostingType:normalizeHostingType(server.hostingType || 'hosted-site'), connectionType,
    accessRank:isPublic ? '' : normalizeAccessRank(server.accessRank || 'cipher-runner',false),
    adapterType, providerType:adapterType, hostingProvider:'',
    providerConfigured:connectionType !== 'none' || adapterType !== 'none', providerConnected,
    trackingState:String(server.trackingState || (providerConnected ? 'online' : connectionType === 'manual' ? 'manual' : connectionType === 'none' ? 'registered' : 'configured')),
    playerCount:Number.isFinite(Number(server.playerCount)) ? Number(server.playerCount) : null,
    playerMax:Number.isFinite(Number(server.playerMax)) ? Number(server.playerMax) : null,
    lastCheckedAt:String(server.lastCheckedAt || ''), lastOnlineAt:String(server.lastOnlineAt || ''), offlineSince:String(server.offlineSince || ''),
    statusMessage:String(server.statusMessage || ''),
    ownerDiscordId:ownershipType === 'community-approved' ? String(server.ownerDiscordId || '') : '',
    approvalId:ownershipType === 'community-approved' ? String(server.approvalId || '') : '',
    createdAt:String(server.createdAt || ''), updatedAt:String(server.updatedAt || '')
  };
}
function privateServer(server = {}) {
  return {
    ...publicServer(server), joinInfo:String(server.joinInfo || ''), externalId:String(server.externalId || ''),
    host:String(server.host || ''), port:server.port ?? null, queryPort:server.queryPort ?? null, adminPort:server.adminPort ?? null,
    credentialEnv:String(server.credentialEnv || ''), adapterRef:String(server.adapterRef || server.providerRef || ''), providerRef:String(server.adapterRef || server.providerRef || ''),
    joinSecret:String(server.joinSecret || ''), adminNotes:String(server.adminNotes || ''),
    maintenanceUntil:String(server.maintenanceUntil || ''), offlineWarningAt:String(server.offlineWarningAt || ''), autoDelistedAt:String(server.autoDelistedAt || '')
  };
}
function sameEndpoint(left = {}, right = {}) {
  const leftHost = normalizeHost(left.host), rightHost = normalizeHost(right.host);
  if (!leftHost || !rightHost || leftHost !== rightHost) return false;
  const leftPort = normalizePort(left.port,null), rightPort = normalizePort(right.port,null);
  return leftPort !== null && rightPort !== null && leftPort === rightPort;
}
function sameIdentity(left = {}, right = {}) {
  if (String(left.moduleId || '') !== String(right.moduleId || '')) return false;
  const leftExternal = safeText(left.externalId,80).toLowerCase(), rightExternal = safeText(right.externalId,80).toLowerCase();
  if (leftExternal && rightExternal) return leftExternal === rightExternal;
  return safeText(left.name,80).toLowerCase() === safeText(right.name,80).toLowerCase();
}

class HostedServerStore {
  constructor(options = {}) {
    const filePath = options.filePath || path.join(process.env.NEXUS_DATA_DIR || 'data','hosted-servers.json');
    this.store = new JsonStore(filePath,{version:5,servers:[]});
    this.now = options.now || (()=>new Date().toISOString());
    this.offlinePolicy = { ...DEFAULT_OFFLINE_POLICY, ...(options.offlinePolicy || {}) };
  }
  list({ includePrivate=false, includeUnlisted=true } = {}) {
    let servers = Array.isArray(this.store.read().servers) ? this.store.read().servers : [];
    if (!includeUnlisted) servers = servers.filter((server)=>(server.listingState || 'listed') === 'listed');
    return servers.map((server)=>includePrivate ? privateServer(server) : publicServer(server));
  }
  get(id,{includePrivate=false}={}) {
    const server=(this.store.read().servers || []).find((item)=>String(item.id)===String(id));
    return server ? (includePrivate ? privateServer(server) : publicServer(server)) : null;
  }
  add(input = {}) {
    const normalized = normalizeServerDefinition(input,{ allowEndpointless:true });
    const moduleId = normalized.moduleId, name = normalized.name;
    const host=normalizeHost(normalized.host), port=normalizePort(normalized.port,null);
    const state=this.store.read(), servers=Array.isArray(state.servers)?state.servers:[];
    const candidate={moduleId,name,host,port,externalId:normalized.externalId};
    if (servers.some((item)=>sameEndpoint(item,candidate) || (!host && sameIdentity(item,candidate)))) throw new Error('That hosted server is already registered.');
    const isPublic=input.public !== false;
    const ownershipType=normalizeOwnership(input.ownershipType || 'nexus-official');
    const hostingType=normalizeHostingType(input.hostingType || (normalized.serverType === 'dedicated' ? 'self-hosted' : 'hosted-site'));
    const defaultConnection = ['oncehuman-custom','minecraft-realm-java','minecraft-realm-bedrock','manual'].includes(normalized.serverType) ? 'manual' : 'none';
    const connectionType=normalizeConnectionType(input.connectionType || input.adapterType || input.providerType || defaultConnection);
    const adapterType=input.adapterType || input.providerType ? legacyAdapterType(input.adapterType || input.providerType) : adapterTypeForConnection(moduleId,connectionType);
    const timestamp=this.now();
    const server={
      id:`SRV-${crypto.randomUUID().slice(0,8).toUpperCase()}`, moduleId, gameName:normalized.gameName, serverType:normalized.serverType, name, host, port,
      externalId:normalized.externalId, region:normalized.region, scenario:normalized.scenario,
      queryPort:normalizePort(input.queryPort,null), adminPort:normalizePort(input.adminPort,null),
      description:safeText(input.description,300), joinInfo:safeText(input.joinInfo,400), joinVisibility:normalized.joinVisibility,
      joinSecret:safeText(input.joinSecret || input.serverPassword,400), adminNotes:safeText(input.adminNotes,1000), public:isPublic,
      ownershipType, ownerDiscordId:ownershipType === 'community-approved' ? safeText(input.ownerDiscordId,32) : '', approvalId:ownershipType === 'community-approved' ? safeText(input.approvalId,40) : '',
      listingState:normalizeListingState(input.listingState || 'listed'), hostingType, connectionType, accessRank:normalizeAccessRank(input.accessRank,isPublic), adapterType,
      credentialEnv:safeText(input.credentialEnv,80).replace(/[^A-Z0-9_]/gi,''), adapterRef:safeText(input.adapterRef || input.providerRef,80).replace(/[^A-Z0-9_-]/gi,''),
      providerConnected:false, trackingState:connectionType === 'manual' ? 'manual' : connectionType === 'none' ? 'registered' : 'configured',
      playerCount:null, playerMax:null, lastCheckedAt:'', lastOnlineAt:'', offlineSince:'', offlineWarningAt:'', autoDelistedAt:'', maintenanceUntil:'', statusMessage:'', createdAt:timestamp, updatedAt:timestamp
    };
    this.store.update((draft)=>{ draft.version=5; draft.servers=Array.isArray(draft.servers)?draft.servers:[]; draft.servers.push(server); return server; });
    return privateServer(server);
  }
  update(id,input={}) {
    let updated=null;
    this.store.update((draft)=>{
      draft.version=5; const servers=Array.isArray(draft.servers)?draft.servers:[];
      const index=servers.findIndex((item)=>String(item.id)===String(id)); if(index<0)return null;
      const current=servers[index], next=clone(current);
      const textFields = { name:80, gameName:80, externalId:80, region:80, scenario:100, description:300, joinInfo:400, joinSecret:400, adminNotes:1000, ownerDiscordId:32, approvalId:40, maintenanceUntil:64 };
      for(const [field,max] of Object.entries(textFields)) if(input[field]!==undefined) next[field]=safeText(input[field],max);
      if(input.serverType!==undefined) next.serverType=inferServerType({serverType:input.serverType,moduleId:next.moduleId,host:next.host});
      if(input.host!==undefined) next.host=normalizeHost(input.host);
      if(input.port!==undefined) next.port=normalizePort(input.port,null);
      if(input.queryPort!==undefined) next.queryPort=normalizePort(input.queryPort,null);
      if(input.adminPort!==undefined) next.adminPort=normalizePort(input.adminPort,null);
      if(input.hostingType!==undefined) next.hostingType=normalizeHostingType(input.hostingType);
      if(input.joinVisibility!==undefined) next.joinVisibility=normalizeServerDefinition({...next,joinVisibility:input.joinVisibility},{allowEndpointless:true}).joinVisibility;
      if(input.ownershipType!==undefined) next.ownershipType=normalizeOwnership(input.ownershipType);
      if(input.listingState!==undefined) next.listingState=normalizeListingState(input.listingState);
      if(input.credentialEnv!==undefined) next.credentialEnv=safeText(input.credentialEnv,80).replace(/[^A-Z0-9_]/gi,'');
      if(input.adapterRef!==undefined || input.providerRef!==undefined) next.adapterRef=safeText(input.adapterRef ?? input.providerRef,80).replace(/[^A-Z0-9_-]/gi,'');
      if(input.connectionType!==undefined){ next.connectionType=normalizeConnectionType(input.connectionType); next.adapterType=adapterTypeForConnection(next.moduleId,next.connectionType); next.trackingState=next.connectionType==='manual'?'manual':next.connectionType==='none'?'registered':'configured'; }
      if(input.adapterType!==undefined || input.providerType!==undefined){ next.adapterType=legacyAdapterType(input.adapterType ?? input.providerType); next.connectionType=connectionTypeFromAdapter(next.adapterType); delete next.providerType; }
      if(input.public!==undefined) next.public=Boolean(input.public);
      const nextPublic=next.public!==false; if(input.accessRank!==undefined || input.public!==undefined) next.accessRank=normalizeAccessRank(input.accessRank ?? next.accessRank,nextPublic);
      if(input.providerConnected!==undefined) next.providerConnected=Boolean(input.providerConnected);
      if(input.trackingState!==undefined) next.trackingState=safeText(input.trackingState,40).toLowerCase();
      if(input.playerCount!==undefined) next.playerCount=Number.isFinite(Number(input.playerCount))?Number(input.playerCount):null;
      if(input.playerMax!==undefined) next.playerMax=Number.isFinite(Number(input.playerMax))?Number(input.playerMax):null;
      for(const field of ['lastCheckedAt','lastOnlineAt','offlineSince','offlineWarningAt','autoDelistedAt','statusMessage']) if(input[field]!==undefined) next[field]=safeText(input[field],field==='statusMessage'?160:64);
      delete next.hostingProvider; next.updatedAt=this.now();
      const duplicate=servers.some((item,otherIndex)=>otherIndex!==index && (sameEndpoint(item,next)||(!normalizeHost(next.host)&&sameIdentity(item,next))));
      if(duplicate)throw new Error('That hosted server is already registered.');
      servers[index]=next; updated=privateServer(next); return next;
    });
    return updated;
  }
  updateRuntime(id,status={}) {
    const current=this.get(id,{includePrivate:true}); if(!current)return null;
    const now=this.now();
    const input={ providerConnected:status.providerConnected, trackingState:status.trackingState, playerCount:status.playerCount, playerMax:status.playerMax, lastCheckedAt:status.lastCheckedAt || now, statusMessage:status.statusMessage };
    const state=String(status.trackingState || '').toLowerCase();
    const isMaintenance=state==='maintenance' || (parseTime(current.maintenanceUntil) && parseTime(current.maintenanceUntil)>parseTime(now));
    const reliable=hasReliableAutomatedHealth({...current,adapterType:current.adapterType});
    const community=current.ownershipType==='community-approved';
    if(state==='online') {
      input.lastOnlineAt=now; input.offlineSince=''; input.offlineWarningAt='';
      if(current.listingState==='listed') input.autoDelistedAt='';
    } else if(community && reliable && !isMaintenance && state==='offline') {
      const offlineSince=current.offlineSince || now; input.offlineSince=offlineSince;
      const start=parseTime(offlineSince), end=parseTime(now); const hours=start!==null&&end!==null?hoursBetween(start,end):0;
      if(hours>=this.offlinePolicy.warningHours && !current.offlineWarningAt) input.offlineWarningAt=now;
      if(hours>=this.offlinePolicy.offlineHours) input.trackingState='offline';
      if(hours>=this.offlinePolicy.hideHours && current.listingState==='listed'){ input.listingState='hidden'; input.autoDelistedAt=now; input.statusMessage=`Automatically hidden after ${Math.floor(hours)} hours offline.`; }
      if(hours>=this.offlinePolicy.suspendHours && current.listingState!=='suspended'){ input.listingState='suspended'; input.autoDelistedAt=current.autoDelistedAt || now; input.statusMessage=`Automatically suspended after ${Math.floor(hours)} hours offline.`; }
    }
    return this.update(id,input);
  }
  remove(id) {
    let removed=false; this.store.update((draft)=>{ const before=Array.isArray(draft.servers)?draft.servers:[]; const after=before.filter((item)=>String(item.id)!==String(id)); removed=after.length!==before.length; draft.version=5; draft.servers=after; return removed; }); return removed;
  }
}

module.exports={
  SUPPORTED_GAMES, HOSTING_TYPES, CONNECTION_TYPES, ADAPTER_TYPES, PROVIDER_TYPES, OWNERSHIP_TYPES, LISTING_STATES, DEFAULT_OFFLINE_POLICY,
  safeText, normalizeHost, normalizePort, normalizeGame, gameLabel, normalizeHostingType, normalizeConnectionType, normalizeAccessRank,
  legacyAdapterType, adapterTypeFor, connectionTypeFor, adapterTypeForConnection, publicServer, privateServer, sameEndpoint, sameIdentity, HostedServerStore
};
