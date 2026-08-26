'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const { purchasableRanks } = require('../shared/ranks.cjs');
const { findInformationCategory, valuesOf } = require('./nexus-status.cjs');
const { managedPayloadMatches } = require('./managed-payload-compare.cjs');

const GAME_SERVERS_PANEL_MARKER = 'Nexus Sentinal • Managed Game Servers • v5';
const GAME_SERVERS_PANEL_TITLE = 'KHAOS NEXUS • GAME SERVERS';
const COMMUNITY_SERVER_RULES_TITLE = 'KHAOS NEXUS • COMMUNITY SERVER RULES';
const COMMUNITY_SERVER_MIN_LEVEL = 10;
const COMMUNITY_SERVER_APPLY_BUTTON_ID = 'nexus-community-server-apply';
const RECENT_MESSAGE_LIMIT = 100;

function normalizeChannelName(value){return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function isGameServersChannel(channel){if(!channel?.isTextBased?.()&&channel?.type!==ChannelType.GuildText&&channel?.type!==ChannelType.GuildAnnouncement)return false;return normalizeChannelName(channel.name)==='gameservers';}
function findGameServersChannel(channels,informationCategoryId=''){const matches=valuesOf(channels).filter(isGameServersChannel);if(!matches.length)return null;if(!informationCategoryId)return matches[0];return matches.find((channel)=>String(channel.parentId || '')===String(informationCategoryId))||matches[0];}
async function ensureGameServersChannel(guild){
  const channels=await guild.channels.fetch();const information=findInformationCategory(channels);if(!information)return{channel:null,category:null,created:false,moved:false};let channel=findGameServersChannel(channels,information.id);
  if(channel){if(String(channel.parentId || '')!==String(information.id)&&typeof channel.setParent==='function'){await channel.setParent(information.id,{lockPermissions:false,reason:'Keep Game Servers under the INFORMATION category'});return{channel,category:information,created:false,moved:true};}return{channel,category:information,created:false,moved:false};}
  if(typeof guild.channels.create!=='function')return{channel:null,category:information,created:false,moved:false};
  channel=await guild.channels.create({name:'game-servers',type:ChannelType.GuildText,parent:information.id,topic:'Automatically maintained Khaos Nexus official and approved community game-server directory.',reason:'Nexus Sentinal managed game-server directory'});return{channel,category:information,created:true,moved:false};
}
function groupTrackedServers(servers=[]){const groups=new Map();for(const server of Array.isArray(servers)?servers:[]){const moduleId=String(server?.moduleId || 'unknown');const game=String(server?.game || moduleId || 'Game').slice(0,100);if(!groups.has(moduleId))groups.set(moduleId,{moduleId,game,servers:[]});groups.get(moduleId).servers.push(server);}return[...groups.values()].sort((a,b)=>a.game.localeCompare(b.game));}
function groupPublicServersByOwnership(servers=[]){return{official:groupTrackedServers(servers.filter((server)=>server.ownershipType!=='community-approved')),community:groupTrackedServers(servers.filter((server)=>server.ownershipType==='community-approved'))};}
function groupPrivateServersByRank(servers=[]){const groups=new Map(purchasableRanks().map((rank)=>[rank.id,{rank,servers:[]}]));for(const server of Array.isArray(servers)?servers:[]){const rankId=String(server?.accessRank || 'cipher-runner');if(groups.has(rankId))groups.get(rankId).servers.push(server);}return[...groups.values()].filter((group)=>group.servers.length).sort((a,b)=>a.rank.level-b.rank.level);}
function normalizedTrackingState(server={}){const state=String(server.trackingState || '').toLowerCase();if(state)return state;if(server.providerConnected===true)return'online';return server.providerConfigured===true?'configured':'registered';}
function visibleTrackingState(server={}){const state=normalizedTrackingState(server);if(state==='online')return'online';if(state==='offline')return'offline';if(['maintenance','starting','restarting','stopping','updating'].includes(state))return'maintenance';return'';}
function trackingGlyph(server={}){const state=visibleTrackingState(server);if(state==='online')return'🟢';if(state==='offline')return'🔴';if(state==='maintenance')return'🟡';return'';}
function trackingLabel(server={}){const state=visibleTrackingState(server);if(state==='online')return'Online';if(state==='offline')return'Offline';if(state==='maintenance')return'Maintenance';return'';}
function cleanPublicText(value,max=240){return String(value || '').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function renderServerLine(server={}){
  const name=cleanPublicText(server.name || 'Server',80)||'Server';const badge=server.ownershipType==='community-approved'?'🌐 Nexus Approved':'🛡️ Khaos Nexus Official';const glyph=trackingGlyph(server),label=trackingLabel(server);const lines=[`${glyph?`${glyph} `:''}**${name}**`,[badge,label].filter(Boolean).join(' • ')];
  const region=cleanPublicText(server.region,80),scenario=cleanPublicText(server.scenario,100);if(region||scenario)lines.push([region&&`**Region:** ${region}`,scenario&&`**Mode:** ${scenario}`].filter(Boolean).join(' • '));
  if(Number.isFinite(Number(server.playerCount))){const max=Number.isFinite(Number(server.playerMax))?` / ${Number(server.playerMax)}`:'';lines.push(`**Players:** ${Number(server.playerCount)}${max}`);}
  const description=cleanPublicText(server.description,240),joinInfo=cleanPublicText(server.joinInfo,200);if(description)lines.push('',description);if(joinInfo)lines.push(`**Join:** ${joinInfo}`);return lines.join('\n');
}
function renderPrivateServerLine(server={}){const name=cleanPublicText(server.name || 'Private Server',80)||'Private Server';const game=cleanPublicText(server.game || server.moduleId || 'Game',80);const glyph=trackingGlyph(server),label=trackingLabel(server);const lines=[`${glyph?`${glyph} `:''}**${name}**`,[game,label].filter(Boolean).join(' • ')];const description=cleanPublicText(server.description,180);if(description)lines.push(description);return lines.join('\n');}
function pushOwnershipGroups(fields,titlePrefix,groups,maxFields=24){for(const group of groups){if(fields.length>=maxFields)break;fields.push({name:`${titlePrefix} • ${group.game}`,value:group.servers.map(renderServerLine).join('\n\n').slice(0,1024),inline:false});}}
function communityServerRulesEmbed(){
  return {
    title: COMMUNITY_SERVER_RULES_TITLE,
    description:`Community-run servers can be listed after staff review. You must be **Community Level ${COMMUNITY_SERVER_MIN_LEVEL}+**. Read the rules, then press **List My Server** below. That opens one short private form — no chat application.`,
    color:0xb00020,
    fields:[
      {name:'✅ Basic Rules',value:'• Follow Khaos Nexus community and safe-space rules.\n• Keep server and join information accurate.\n• The host is responsible for moderation and player safety.\n• Staff may suspend or remove unsafe or misleading listings.',inline:false},
      {name:'💳 Money & Safety',value:'• No mandatory pay-to-play or pay-to-win.\n• Donations or cosmetic supporter perks must be disclosed.\n• Never submit passwords, RCON credentials, API keys, admin tokens, or other secrets.\n• No malicious downloads, credential harvesting, scams, gambling, or deceptive fundraising.',inline:false},
      {name:'🏅 Server Host Title',value:'Approved active hosts receive a managed **Server Host** title that advances with Community Level. It does not replace Nexus ranks or Name Color roles.',inline:false}
    ],
    footer:{text:`Nexus Sentinal • Community Server Rules • Level ${COMMUNITY_SERVER_MIN_LEVEL}+ required`}
  };
}
function communityServerApplyRow(){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(COMMUNITY_SERVER_APPLY_BUTTON_ID).setLabel('List My Server').setEmoji('🌐').setStyle(ButtonStyle.Primary)
  );
}
function renderGameServersPanel(snapshot={}){
  const servers=Array.isArray(snapshot.servers)?snapshot.servers:[];const privateServers=Array.isArray(snapshot.privateServers)?snapshot.privateServers:[];const ownership=groupPublicServersByOwnership(servers);const privateGroups=groupPrivateServersByRank(privateServers);const fields=[];
  if(!servers.length)fields.push({name:'Public Servers',value:'No public Nexus game servers are registered yet.',inline:false});
  else{pushOwnershipGroups(fields,'🛡️ Official',ownership.official,Math.max(1,23-privateGroups.length));pushOwnershipGroups(fields,'🌐 Approved Community',ownership.community,Math.max(1,23-privateGroups.length));}
  for(const group of privateGroups){if(fields.length>=24)break;fields.push({name:`🔒 ${group.rank.name} Private Servers`,value:`${group.servers.map(renderPrivateServerLine).join('\n\n').slice(0,900)}\n\nEligible members can use **/server access** for private join details.`,inline:false});}
  fields.push({name:'Community Server Program',value:`Want your server listed? Reach **Community Level ${COMMUNITY_SERVER_MIN_LEVEL}**, read the rules below, and press **List My Server**. The application is one short private popup form.`,inline:false});
  return{embeds:[{title:GAME_SERVERS_PANEL_TITLE,description:'Official Khaos Nexus servers and staff-approved community servers. Network management ports, passwords, tokens, credentials, and staff-only notes are never displayed here. Health is shown only as 🟢 Online, 🔴 Offline, or 🟡 Maintenance.',color:servers.length||privateGroups.length?0x2ecc71:0x5865f2,fields:fields.slice(0,25),footer:{text:GAME_SERVERS_PANEL_MARKER}},communityServerRulesEmbed()],components:[communityServerApplyRow()],allowedMentions:{parse:[]}};
}
function messageMatchesGameServersPanel(message,botId=''){if(!message)return false;if(botId&&String(message?.author?.id || '')!==String(botId))return false;const embed=message?.embeds?.[0];return String(embed?.footer?.text || '').startsWith('Nexus Sentinal • Managed Game Servers')||String(embed?.title || '')===GAME_SERVERS_PANEL_TITLE;}
function newestMessage(messages=[]){return[...messages].sort((left,right)=>Number(right?.createdTimestamp || 0)-Number(left?.createdTimestamp || 0))[0]||null;}
function panelPayloadMatches(message,payload){return managedPayloadMatches(message,payload);}
async function reconcileGameServersPanel(channel,payload,options={}){
  const botId=String(options.botId || channel?.client?.user?.id || '');let recent=[];try{recent=valuesOf(await channel.messages.fetch({limit:RECENT_MESSAGE_LIMIT}));}catch{}
  const candidates=recent.filter((message)=>messageMatchesGameServersPanel(message,botId));let message=newestMessage(candidates),created=false,updated=false,duplicatesRemoved=0,pinned=false;
  if(message){if(!panelPayloadMatches(message,payload)){await message.edit(payload);updated=true;}}else if(typeof channel?.send==='function'){message=await channel.send(payload);created=true;}
  if(!message)return{message:null,created:false,updated:false,duplicatesRemoved:0,pinned:false};if(message.pinned!==true&&typeof message.pin==='function'){try{await message.pin('Nexus Sentinal canonical tracked game-server registry');pinned=true;}catch{}}
  for(const duplicate of candidates){if(String(duplicate.id)===String(message.id))continue;try{await duplicate.delete('Nexus Sentinal duplicate tracked game-server panel cleanup');duplicatesRemoved+=1;}catch{}}
  return{message,created,updated,duplicatesRemoved,pinned};
}

module.exports={GAME_SERVERS_PANEL_MARKER,GAME_SERVERS_PANEL_TITLE,COMMUNITY_SERVER_RULES_TITLE,COMMUNITY_SERVER_MIN_LEVEL,COMMUNITY_SERVER_APPLY_BUTTON_ID,RECENT_MESSAGE_LIMIT,normalizeChannelName,isGameServersChannel,findGameServersChannel,ensureGameServersChannel,groupTrackedServers,groupPublicServersByOwnership,groupPrivateServersByRank,normalizedTrackingState,visibleTrackingState,trackingGlyph,trackingLabel,renderServerLine,renderPrivateServerLine,communityServerRulesEmbed,communityServerApplyRow,renderGameServersPanel,messageMatchesGameServersPanel,newestMessage,panelPayloadMatches,reconcileGameServersPanel};
