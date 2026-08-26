'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { purchasableRanks, rankById } = require('../shared/ranks.cjs');
const { SERVER_TYPE_CHOICES, normalizeServerDefinition } = require('../shared/game-server-catalog.cjs');

const SERVER_COMMAND = 'server';
const HOSTING_CHOICES = [ { name:'Self-Hosted',value:'self-hosted' }, { name:'Hosted Site',value:'hosted-site' } ];
const CONNECTION_CHOICES = [
  { name:'REST API',value:'rest' }, { name:'RCON',value:'rcon' },
  { name:'Manual / Host Dashboard',value:'manual' }, { name:'No Live Connection',value:'none' }
];
const JOIN_ACCESS_CHOICES = [
  {name:'Public Join Instructions',value:'public'}, {name:'Nexus Members Only',value:'members'}, {name:'Request Access',value:'request'}, {name:'Staff Only',value:'staff-only'}
];
const MONETIZATION_CHOICES = [
  {name:'None / Completely Free',value:'none'}, {name:'Voluntary Donations — Cost Recovery',value:'donations-cost-recovery'},
  {name:'Cosmetic Supporter Perks',value:'cosmetic-support'}, {name:'Paid Convenience',value:'paid-convenience'}, {name:'Commercial / For Profit',value:'commercial'}
];
const REVIEW_CHOICES = [ {name:'Approve',value:'approved'}, {name:'Changes Required',value:'changes-required'}, {name:'Deny',value:'denied'} ];
const LISTING_STATE_CHOICES = [ {name:'Listed',value:'listed'}, {name:'Hidden',value:'hidden'}, {name:'Suspended',value:'suspended'} ];
const PAID_RANK_CHOICES = purchasableRanks().map((rank)=>({name:rank.name,value:rank.id}));
const ADAPTER_CHOICES = CONNECTION_CHOICES;
const PROVIDER_CHOICES = CONNECTION_CHOICES;

function serverIdentityOptions(sub, { application=false } = {}) {
  sub.addStringOption((opt)=>opt.setName('game').setDescription('Game name, e.g. Minecraft, Once Human, Palworld').setRequired(true).setMaxLength(80));
  sub.addStringOption((opt)=>opt.setName('server_type').setDescription('How this server is joined/hosted').setRequired(true).addChoices(...SERVER_TYPE_CHOICES));
  sub.addStringOption((opt)=>opt.setName('name').setDescription('Server display name').setRequired(true).setMaxLength(80));
  if (application) {
    sub.addStringOption((opt)=>opt.setName('monetization').setDescription('How this server is funded').setRequired(true).addChoices(...MONETIZATION_CHOICES));
    sub.addBooleanOption((opt)=>opt.setName('policy_accept').setDescription('I accept the Nexus community-server and monetization policy').setRequired(true));
  } else {
    sub.addBooleanOption((opt)=>opt.setName('public').setDescription('Public server? Private servers are paid-rank gated').setRequired(true));
  }
  sub.addStringOption((opt)=>opt.setName('host').setDescription('Hostname/IP for dedicated servers; leave blank for Realms/Once Human').setRequired(false).setMaxLength(253));
  sub.addIntegerOption((opt)=>opt.setName('port').setDescription('Game/server port when applicable').setRequired(false).setMinValue(1).setMaxValue(65535));
  sub.addStringOption((opt)=>opt.setName('external_id').setDescription('Once Human Custom Server ID or platform-specific server ID').setRequired(false).setMaxLength(80));
  sub.addStringOption((opt)=>opt.setName('region').setDescription('Region, if useful for this game').setRequired(false).setMaxLength(80));
  sub.addStringOption((opt)=>opt.setName('scenario').setDescription('Scenario/world/mode, if applicable').setRequired(false).setMaxLength(100));
  sub.addStringOption((opt)=>opt.setName('join_access').setDescription('Who should receive join instructions').setRequired(false).addChoices(...JOIN_ACCESS_CHOICES));
  sub.addStringOption((opt)=>opt.setName('join_info').setDescription('Non-secret join instructions/invite guidance').setRequired(false).setMaxLength(400));
  sub.addStringOption((opt)=>opt.setName('description').setDescription('Server description').setRequired(false).setMaxLength(300));
  return sub;
}

function hostedServerCommand() {
  return new SlashCommandBuilder().setName(SERVER_COMMAND).setDescription('Khaos Nexus game server directory and management')
    .addSubcommand((sub)=>serverIdentityOptions(sub.setName('apply').setDescription('Apply to list your community game server'),{application:true})
      .addStringOption((opt)=>opt.setName('monetization_details').setDescription('Explain donations, supporter perks, or other funding').setRequired(false).setMaxLength(1000))
      .addBooleanOption((opt)=>opt.setName('paid_advantages').setDescription('Can money buy gameplay/progression advantages?').setRequired(false))
      .addBooleanOption((opt)=>opt.setName('mandatory_fee').setDescription('Must players pay to join or keep access?').setRequired(false))
      .addBooleanOption((opt)=>opt.setName('affiliate_referral').setDescription('Does the server monetize referrals/affiliate traffic?').setRequired(false)))
    .addSubcommand((sub)=>sub.setName('my-applications').setDescription('View your community server applications'))
    .addSubcommand((sub)=>serverIdentityOptions(sub.setName('add').setDescription('Staff: register a Khaos Nexus Official server'))
      .addStringOption((opt)=>opt.setName('hosting').setDescription('Hosting model for network-managed servers').setRequired(false).addChoices(...HOSTING_CHOICES))
      .addStringOption((opt)=>opt.setName('connection').setDescription('Sentinel live connection method').setRequired(false).addChoices(...CONNECTION_CHOICES))
      .addStringOption((opt)=>opt.setName('paid_rank').setDescription('Minimum paid rank for private server').setRequired(false).addChoices(...PAID_RANK_CHOICES))
      .addIntegerOption((opt)=>opt.setName('admin_port').setDescription('REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt)=>opt.setName('credential_env').setDescription('Environment variable containing API/RCON credential').setRequired(false).setMaxLength(80)))
    .addSubcommand((sub)=>sub.setName('applications').setDescription('Staff: list community server applications')
      .addStringOption((opt)=>opt.setName('status').setDescription('Filter by review status').setRequired(false).addChoices(
        {name:'Submitted',value:'submitted'},{name:'Changes Required',value:'changes-required'},{name:'Approved',value:'approved'},{name:'Denied',value:'denied'})))
    .addSubcommand((sub)=>sub.setName('review').setDescription('Staff: review a community server application')
      .addStringOption((opt)=>opt.setName('id').setDescription('Application ID').setRequired(true))
      .addStringOption((opt)=>opt.setName('decision').setDescription('Review decision').setRequired(true).addChoices(...REVIEW_CHOICES))
      .addStringOption((opt)=>opt.setName('reason').setDescription('Decision/review note').setRequired(false).setMaxLength(1000)))
    .addSubcommand((sub)=>sub.setName('edit').setDescription('Staff: edit server identity, visibility, or listing state')
      .addStringOption((opt)=>opt.setName('id').setDescription('Server ID').setRequired(true))
      .addStringOption((opt)=>opt.setName('name').setDescription('New display name').setRequired(false).setMaxLength(80))
      .addStringOption((opt)=>opt.setName('listing_state').setDescription('Public directory lifecycle state').setRequired(false).addChoices(...LISTING_STATE_CHOICES))
      .addBooleanOption((opt)=>opt.setName('public').setDescription('Public or paid-rank private').setRequired(false))
      .addStringOption((opt)=>opt.setName('paid_rank').setDescription('Minimum paid rank if private').setRequired(false).addChoices(...PAID_RANK_CHOICES))
      .addStringOption((opt)=>opt.setName('join_access').setDescription('Who receives join instructions').setRequired(false).addChoices(...JOIN_ACCESS_CHOICES))
      .addStringOption((opt)=>opt.setName('join_info').setDescription('Non-secret join instructions').setRequired(false).setMaxLength(400))
      .addStringOption((opt)=>opt.setName('external_id').setDescription('Custom/Realm/platform server ID').setRequired(false).setMaxLength(80))
      .addStringOption((opt)=>opt.setName('region').setDescription('Region').setRequired(false).setMaxLength(80))
      .addStringOption((opt)=>opt.setName('scenario').setDescription('Scenario/world/mode').setRequired(false).setMaxLength(100))
      .addStringOption((opt)=>opt.setName('description').setDescription('Server description').setRequired(false).setMaxLength(300)))
    .addSubcommand((sub)=>sub.setName('configure').setDescription('Staff: configure REST/RCON/manual connection')
      .addStringOption((opt)=>opt.setName('id').setDescription('Server ID').setRequired(true))
      .addStringOption((opt)=>opt.setName('connection').setDescription('Connection method').setRequired(true).addChoices(...CONNECTION_CHOICES))
      .addStringOption((opt)=>opt.setName('host').setDescription('REST/RCON hostname or IP; kept private').setRequired(false).setMaxLength(253))
      .addIntegerOption((opt)=>opt.setName('admin_port').setDescription('REST/RCON/admin port').setRequired(false).setMinValue(1).setMaxValue(65535))
      .addStringOption((opt)=>opt.setName('credential_env').setDescription('Environment-variable name containing credential').setRequired(false).setMaxLength(80)))
    .addSubcommand((sub)=>sub.setName('setup').setDescription('Staff: show game setup guidance').addStringOption((opt)=>opt.setName('id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((sub)=>sub.setName('status').setDescription('Staff: check live status').addStringOption((opt)=>opt.setName('id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((sub)=>sub.setName('access').setDescription('Show private servers available to your rank'))
    .addSubcommand((sub)=>sub.setName('remove').setDescription('Staff: remove a registered server')
      .addStringOption((opt)=>opt.setName('id').setDescription('Server ID').setRequired(true))
      .addBooleanOption((opt)=>opt.setName('confirm').setDescription('Confirm permanent removal').setRequired(true)))
    .addSubcommand((sub)=>sub.setName('list').setDescription('Staff: list registered servers'))
    .addSubcommand((sub)=>sub.setName('refresh').setDescription('Staff: refresh status and #game-servers'));
}

function optionValue(interaction,name){ return interaction.options?.get?.(name)?.value; }
function sharedIdentityInput(interaction) {
  return {
    game:String(optionValue(interaction,'game') || ''), moduleId:String(optionValue(interaction,'game') || ''), serverType:String(optionValue(interaction,'server_type') || 'manual'),
    name:String(optionValue(interaction,'name') || ''), host:String(optionValue(interaction,'host') || ''), port:optionValue(interaction,'port'),
    externalId:String(optionValue(interaction,'external_id') || ''), region:String(optionValue(interaction,'region') || ''), scenario:String(optionValue(interaction,'scenario') || ''),
    joinVisibility:String(optionValue(interaction,'join_access') || 'public'), joinInfo:String(optionValue(interaction,'join_info') || ''), description:String(optionValue(interaction,'description') || '')
  };
}
function addInput(interaction) {
  const input=sharedIdentityInput(interaction); const special=['oncehuman-custom','minecraft-realm-java','minecraft-realm-bedrock','manual'].includes(input.serverType);
  return { ...input, ownershipType:'nexus-official', public:optionValue(interaction,'public')===true, accessRank:String(optionValue(interaction,'paid_rank') || ''), hostingType:String(optionValue(interaction,'hosting') || (input.serverType==='dedicated'?'self-hosted':'hosted-site')), connectionType:String(optionValue(interaction,'connection') || (special?'manual':'none')), adminPort:optionValue(interaction,'admin_port'), credentialEnv:String(optionValue(interaction,'credential_env') || '') };
}
function applicationInput(interaction) {
  return { ...sharedIdentityInput(interaction), applicantDiscordId:String(interaction.user?.id || ''), monetizationModel:String(optionValue(interaction,'monetization') || 'none'), policyAccepted:optionValue(interaction,'policy_accept')===true, monetizationDetails:String(optionValue(interaction,'monetization_details') || ''), paidAdvantages:optionValue(interaction,'paid_advantages')===true, mandatoryFees:optionValue(interaction,'mandatory_fee')===true, affiliateReferral:optionValue(interaction,'affiliate_referral')===true };
}
function editInput(interaction) {
  const mapping={ name:'name',listing_state:'listingState',public:'public',paid_rank:'accessRank',join_access:'joinVisibility',join_info:'joinInfo',external_id:'externalId',region:'region',scenario:'scenario',description:'description' }; const input={};
  for(const [optionName,target] of Object.entries(mapping)){ const value=optionValue(interaction,optionName); if(value!==undefined&&value!==null)input[target]=value; } return input;
}
function configureInput(interaction) {
  const input={connectionType:String(optionValue(interaction,'connection') || 'none')};
  for(const [optionName,target] of [['host','host'],['admin_port','adminPort'],['credential_env','credentialEnv']]){ const value=optionValue(interaction,optionName); if(value!==undefined&&value!==null)input[target]=value; } return input;
}
function privateServerList(servers=[]) {
  if(!servers.length)return 'No game servers are registered yet.';
  return servers.map((server)=>{
    const identity=server.externalId ? `ID ${server.externalId}` : server.host ? `${server.host}${server.port?`:${server.port}`:''}` : server.serverType || 'manual';
    const owner=server.ownershipType==='community-approved' ? 'Nexus Approved Community' : 'Khaos Nexus Official';
    const access=server.public===false ? `private • ${rankById(server.accessRank || 'cipher-runner')?.name || 'Cipher Runner'}+` : 'public';
    return `**${server.id} — ${server.name}**\n${server.game} • ${owner} • ${identity}\n${access} • ${server.listingState || 'listed'} • connection ${server.connectionType || 'none'}`;
  }).join('\n\n').slice(0,3800);
}
function eligiblePrivateServers(servers=[],memberRank=null) {
  const level=Number(memberRank?.level ?? -1); if(level<1)return [];
  return servers.filter((server)=>server.public===false && (server.listingState || 'listed')==='listed' && (()=>{const required=rankById(server.accessRank || 'cipher-runner');return required&&level>=required.level;})());
}
function privateAccessText(servers=[],memberRank=null) {
  const eligible=eligiblePrivateServers(servers,memberRank); if(!eligible.length)return '🔒 No private game servers are currently available to your Nexus rank.';
  const rows=eligible.map((server)=>`**${server.name}** — ${server.game}\n**Minimum Rank:** ${rankById(server.accessRank || 'cipher-runner')?.name || 'Cipher Runner'}\n**Status:** ${String(server.trackingState || 'registered').toUpperCase()}\n**Join:** ${String(server.joinInfo || '').trim() || 'Ask Nexus staff for the current join instructions.'}`);
  return `🔐 **Private Server Access — ${memberRank?.name || 'Nexus Supporter'}**\n\n${rows.join('\n\n')}`.slice(0,3900);
}
function statusText(server={},status={}) {
  const state=String(status.trackingState || 'unknown').toUpperCase(); const players=Number.isFinite(Number(status.playerCount))?`${status.playerCount}${Number.isFinite(Number(status.playerMax))?` / ${status.playerMax}`:''}`:'Not exposed';
  return `📡 **${server.name} — Server Status**\n\n**Type:** ${server.serverType || 'server'}\n**Connection:** ${(server.connectionType || 'none').toUpperCase()}\n**State:** ${state}\n**Players:** ${players}\n**Listing:** ${server.listingState || 'listed'}\n\n${status.statusMessage || 'No additional status detail.'}\n\nCredentials and private endpoints are not displayed.`;
}
function setupText(server={},guide={}) {
  if(guide.managementMode==='palworld-adapters'){ const options=(guide.options || []).map((item)=>`**${item.name}**\n${item.description}`).join('\n\n'); return `🔧 **${server.name} — Palworld Connection Setup**\n\n**Current connection:** ${(server.connectionType || 'none').toUpperCase()}\n\n${options}\n\nUse **/server configure** to change connection details.`.slice(0,3900); }
  const sections=(guide.sections || []).map((section)=>`**${section.title}**\n${(section.settings || []).map((item)=>`• ${item}`).join('\n')}`).join('\n\n'); const warnings=(guide.warnings || []).map((item)=>`⚠️ ${item}`).join('\n');
  return `🛠️ **${server.name} — ${server.game || 'Server'} Setup**\n\n**Server type:** ${server.serverType || 'manual'}\nCurrent management path: **official game/server interface or configured Nexus adapter**.\n\n${sections}\n\n${warnings}`.slice(0,3900);
}
function applicationListText(applications=[],own=false) {
  if(!applications.length)return own?'You have no community server applications.':'No matching community server applications.';
  return applications.slice(0,12).map((app)=>{
    const risk=app.riskFlags?.length ? `\n⚠️ ${app.riskFlags.join('; ')}` : '';
    return `**${app.id} — ${app.server?.name || 'Server'}**\n${app.server?.gameName || app.server?.game || 'Game'} • ${app.server?.serverType || 'manual'} • **${String(app.status || '').toUpperCase()}**${risk}${app.reviewReason?`\nReview: ${app.reviewReason}`:''}`;
  }).join('\n\n').slice(0,3800);
}
async function replyEphemeral(interaction,content){ const payload={content:String(content).slice(0,3900),flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}}; if(interaction.deferred||interaction.replied)return interaction.editReply({content:payload.content,allowedMentions:payload.allowedMentions}); return interaction.reply(payload); }

async function handleHostedServerCommand(interaction,context={}) {
  if(!interaction.isChatInputCommand?.()||interaction.commandName!==SERVER_COMMAND)return false;
  const subcommand=interaction.options.getSubcommand();
  if(subcommand==='apply') {
    // Validation is intentionally shared with backend so Discord and future web UI enforce the same special cases.
    normalizeServerDefinition(sharedIdentityInput(interaction),{allowEndpointless:true});
    const response=await context.backend.submitServerApplication(applicationInput(interaction)); if(!response.ok)throw new Error(response.message || 'Unable to submit server application.');
    const flags=response.application.riskFlags || []; await replyEphemeral(interaction,`📨 **Application ${response.application.id} submitted.**\n\n**${response.application.server.name}** — ${response.application.server.gameName}\nStatus: **SUBMITTED**${flags.length?`\n\n⚠️ Review flags: ${flags.join('; ')}`:''}\n\nA Nexus staff member must approve the listing before it appears in #game-servers.`); return true;
  }
  if(subcommand==='my-applications') {
    const response=await context.backend.serverApplications({applicant:String(interaction.user?.id || '')}); if(!response.ok)throw new Error(response.message || 'Application registry unavailable.');
    await replyEphemeral(interaction,`📋 **Your Community Server Applications**\n\n${applicationListText(response.applications || [],true)}`); return true;
  }
  if(subcommand==='access') {
    const manager=await context.isManager(interaction); const memberRank=manager?{id:'owner-admin',name:'Owner / Admin',level:999}:await context.memberRank?.(interaction);
    if(!memberRank){await replyEphemeral(interaction,'🔒 Private server access requires an eligible paid Nexus rank.');return true;}
    const response=await context.backend.hostedServers(); if(!response.ok)throw new Error(response.message || 'Server registry unavailable.'); await replyEphemeral(interaction,privateAccessText(response.servers || [],memberRank)); return true;
  }

  if(!(await context.isManager(interaction))){ await replyEphemeral(interaction,'⛔ That server-management action is restricted to Nexus staff. Use **/server apply** to request a community listing.'); return true; }
  if(subcommand==='applications') {
    const response=await context.backend.serverApplications({status:String(optionValue(interaction,'status') || '')}); if(!response.ok)throw new Error(response.message || 'Application registry unavailable.');
    await replyEphemeral(interaction,`🧾 **Community Server Review Queue**\n\n${applicationListText(response.applications || [])}`); return true;
  }
  if(subcommand==='review') {
    const id=String(optionValue(interaction,'id') || '').trim().toUpperCase(); const decision=String(optionValue(interaction,'decision') || ''); const reason=String(optionValue(interaction,'reason') || '');
    const response=await context.backend.reviewServerApplication(id,{decision,reason,reviewerDiscordId:String(interaction.user?.id || '')}); if(!response.ok)throw new Error(response.message || response.code || 'Unable to review application.');
    if(decision==='approved'){await context.refreshProviders?.();await context.refresh?.();}
    await replyEphemeral(interaction,`${decision==='approved'?'✅':decision==='denied'?'❌':'📝'} **${id} → ${decision.toUpperCase()}**${response.application.approvedServerId?`\nPromoted to server **${response.application.approvedServerId}**.`:''}${reason?`\n\n${reason}`:''}`); return true;
  }
  if(subcommand==='list'){ const response=await context.backend.hostedServers(); if(!response.ok)throw new Error(response.message || 'Server registry unavailable.'); await replyEphemeral(interaction,`🗄️ **Server Registry**\n\n${privateServerList(response.servers || [])}`); return true; }
  if(subcommand==='add') {
    const input=addInput(interaction); normalizeServerDefinition(input,{allowEndpointless:true});
    const response=await context.backend.addHostedServer(input); if(!response.ok)throw new Error(response.message || 'Unable to register server.'); await context.refreshProviders?.(); await context.refresh?.();
    const access=response.server.public===false?`${rankById(response.server.accessRank || 'cipher-runner')?.name || 'Cipher Runner'}+ private`:'public';
    await replyEphemeral(interaction,`✅ **${response.server.name}** registered as **${response.server.id}**.\n\n🛡️ **Khaos Nexus Official**\n**Game:** ${response.server.game}\n**Type:** ${response.server.serverType}\n**Access:** ${access}\n\n#game-servers has been refreshed.`); return true;
  }
  if(subcommand==='edit'){ const id=String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response=await context.backend.updateHostedServer(id,editInput(interaction)); if(!response.ok)throw new Error(response.message || response.code || 'Unable to edit server.'); await context.refresh?.(); await replyEphemeral(interaction,`✅ **${response.server.name}** (${response.server.id}) updated • listing **${response.server.listingState || 'listed'}**.`); return true; }
  if(subcommand==='configure'){ const id=String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response=await context.backend.updateHostedServer(id,configureInput(interaction)); if(!response.ok)throw new Error(response.message || response.code || 'Unable to configure server.'); await context.refreshProviders?.();await context.refresh?.();await replyEphemeral(interaction,`🔧 **${response.server.name}** connection set to **${String(response.server.connectionType || 'none').toUpperCase()}**.`);return true; }
  if(subcommand==='setup'||subcommand==='status') {
    const id=String(optionValue(interaction,'id') || '').trim().toUpperCase(); const response=await context.backend.hostedServers(); if(!response.ok)throw new Error(response.message || 'Server registry unavailable.'); const server=(response.servers || []).find((item)=>String(item.id).toUpperCase()===id); if(!server)throw new Error('Server ID was not found.');
    if(subcommand==='setup'){ const guide=context.setup?.(server); if(!guide?.ok)throw new Error('No setup guide is available for that server.'); await replyEphemeral(interaction,setupText(server,guide));return true; }
    const status=await context.probe?.(server); if(!status)throw new Error('No supported live connection is configured for that server yet.'); await context.persistStatus?.(server.id,status);await context.refresh?.();await replyEphemeral(interaction,statusText(server,status));return true;
  }
  if(subcommand==='remove'){ const id=String(optionValue(interaction,'id') || '').trim().toUpperCase(); if(optionValue(interaction,'confirm')!==true){await replyEphemeral(interaction,'Removal cancelled. Run again with **confirm: true**.');return true;} const response=await context.backend.removeHostedServer(id);if(!response.ok)throw new Error(response.message || response.code || 'Unable to remove server.');await context.refresh?.();await replyEphemeral(interaction,`🗑️ **${id}** removed from the server registry.`);return true; }
  if(subcommand==='refresh'){ const status=await context.refreshProviders?.();const result=await context.refresh?.();await replyEphemeral(interaction,`🔄 Connection checks completed${status?.length?` for ${status.length} registered server${status.length===1?'':'s'}`:''}. #game-servers refreshed${result?.tracked!==undefined?` • ${result.tracked} public • ${result.privateTracked || 0} private`:''}.`);return true; }
  return false;
}

module.exports={ SERVER_COMMAND,HOSTING_CHOICES,CONNECTION_CHOICES,PAID_RANK_CHOICES,ADAPTER_CHOICES,PROVIDER_CHOICES,SERVER_TYPE_CHOICES,MONETIZATION_CHOICES,REVIEW_CHOICES, hostedServerCommand,sharedIdentityInput,addInput,applicationInput,editInput,configureInput,privateServerList,eligiblePrivateServers,privateAccessText,statusText,setupText,applicationListText,handleHostedServerCommand };
