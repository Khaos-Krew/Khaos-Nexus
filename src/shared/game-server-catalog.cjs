'use strict';

const SERVER_TYPES = Object.freeze({
  dedicated: { id:'dedicated', name:'Dedicated / Direct Connect', requiresHost:true, automatedHealthEligible:true },
  hosted: { id:'hosted', name:'Hosted Game Server', requiresHost:false, automatedHealthEligible:true },
  manual: { id:'manual', name:'Manual / Invite Based', requiresHost:false, automatedHealthEligible:false },
  'oncehuman-custom': { id:'oncehuman-custom', name:'Once Human Custom Server', gameId:'oncehuman', gameName:'Once Human', requiresHost:false, automatedHealthEligible:false, requiresExternalId:true },
  'minecraft-realm-java': { id:'minecraft-realm-java', name:'Minecraft Realm — Java', gameId:'minecraft', gameName:'Minecraft', requiresHost:false, automatedHealthEligible:false },
  'minecraft-realm-bedrock': { id:'minecraft-realm-bedrock', name:'Minecraft Realm — Bedrock', gameId:'minecraft', gameName:'Minecraft', requiresHost:false, automatedHealthEligible:false }
});

const SERVER_TYPE_CHOICES = Object.values(SERVER_TYPES).map(({ name, id }) => ({ name, value:id }));
const JOIN_VISIBILITY = new Set(['public','members','request','staff-only']);
const RELIABLE_ADAPTERS = new Set(['nitrado-api','palworld-rest','palworld-rcon']);

function clean(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0,max);
}
function normalizeGameId(value) {
  const raw = clean(value,80).toLowerCase();
  const aliases = { 'once human':'oncehuman', oncehuman:'oncehuman', minecraft:'minecraft', palworld:'palworld', ark:'ark', 'ark survival ascended':'ark', 'ark: survival ascended':'ark' };
  if (aliases[raw]) return aliases[raw];
  return raw.replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48) || 'custom-game';
}
function gameNameFromInput(value, moduleId = '') {
  const raw = clean(value,80);
  if (raw) return raw;
  const known = { oncehuman:'Once Human', minecraft:'Minecraft', palworld:'Palworld', ark:'ARK: Survival Ascended' };
  return known[moduleId] || String(moduleId || 'Game').replace(/(^|-)([a-z])/g,(_,dash,ch)=>`${dash ? ' ' : ''}${ch.toUpperCase()}`);
}
function serverTypeDefinition(value) { return SERVER_TYPES[clean(value,60).toLowerCase()] || null; }
function inferServerType(input = {}) {
  if (input.serverType && serverTypeDefinition(input.serverType)) return clean(input.serverType,60).toLowerCase();
  if (normalizeGameId(input.moduleId || input.game) === 'oncehuman') return 'oncehuman-custom';
  if (clean(input.host,253)) return input.hostingType === 'self-hosted' ? 'dedicated' : 'hosted';
  return 'manual';
}
function validateOnceHumanId(value) { return /^\d{8,20}$/.test(clean(value,32)); }
function normalizeServerDefinition(input = {}, options = {}) {
  const type = inferServerType(input);
  const definition = serverTypeDefinition(type);
  if (!definition) throw new Error('Unsupported server type.');
  let moduleId = normalizeGameId(input.moduleId || input.gameName || input.game || definition.gameId || '');
  let gameName = gameNameFromInput(input.gameName || input.game, moduleId);
  if (definition.gameId) { moduleId = definition.gameId; gameName = definition.gameName; }
  const name = clean(input.name,80);
  if (!name) throw new Error('Server name is required.');
  const host = clean(input.host,253);
  const port = Number(input.port || 0);
  if (definition.requiresHost && !host && options.allowEndpointless !== true) throw new Error(`${definition.name} requires a hostname or IP address.`);
  if (host && port && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Server port must be between 1 and 65535.');
  const externalId = clean(input.externalId || input.customServerId || input.realmId,80);
  if (type === 'oncehuman-custom' && !validateOnceHumanId(externalId)) throw new Error('Once Human Custom Server ID must be 8–20 digits.');
  const joinVisibility = JOIN_VISIBILITY.has(clean(input.joinVisibility,30).toLowerCase()) ? clean(input.joinVisibility,30).toLowerCase() : 'public';
  return {
    ...input,
    moduleId, gameName, serverType:type, name, host,
    port: port || 0,
    externalId,
    region:clean(input.region,80), scenario:clean(input.scenario,100),
    joinVisibility,
    description:clean(input.description,300), joinInfo:clean(input.joinInfo,400),
    adminNotes:clean(input.adminNotes,1000)
  };
}
function hasReliableAutomatedHealth(server = {}) {
  const definition = serverTypeDefinition(inferServerType(server));
  if (!definition?.automatedHealthEligible) return false;
  const adapter = clean(server.adapterType || server.providerType,40).toLowerCase();
  return RELIABLE_ADAPTERS.has(adapter);
}
function publicJoinInfo(server = {}) {
  const visibility = JOIN_VISIBILITY.has(server.joinVisibility) ? server.joinVisibility : 'public';
  if (visibility === 'public') return clean(server.joinInfo,400);
  if (visibility === 'request') return 'Request access from the server owner.';
  if (visibility === 'members') return 'Join information is available to approved Khaos Nexus members.';
  return '';
}
function monetizationRisk(input = {}) {
  const model = clean(input.monetizationModel || input.monetization,40).toLowerCase() || 'none';
  const flags = [];
  let hardBlocked = false;
  if (input.paidAdvantages === true) { flags.push('Paid gameplay advantages / pay-to-win'); hardBlocked = true; }
  if (input.mandatoryFees === true) { flags.push('Mandatory fee or subscription'); hardBlocked = true; }
  if (input.affiliateReferral === true) { flags.push('Affiliate/referral monetization targeting members'); hardBlocked = true; }
  if (model === 'commercial') { flags.push('Commercial/profit-seeking model'); hardBlocked = true; }
  if (model === 'paid-convenience') flags.push('Paid convenience requires staff review');
  if (model === 'donations-cost-recovery') flags.push('Donation/cost-recovery disclosure requires verification');
  if (model === 'cosmetic-support') flags.push('Cosmetic supporter model requires verification');
  return { model, flags, hardBlocked };
}

module.exports = {
  SERVER_TYPES, SERVER_TYPE_CHOICES, JOIN_VISIBILITY, RELIABLE_ADAPTERS,
  clean, normalizeGameId, gameNameFromInput, serverTypeDefinition, inferServerType,
  validateOnceHumanId, normalizeServerDefinition, hasReliableAutomatedHealth,
  publicJoinInfo, monetizationRisk
};
