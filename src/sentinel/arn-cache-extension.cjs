'use strict';
const {Client,Events,MessageFlags,SlashCommandBuilder}=require('discord.js');
const {ArnTokenLedger}=require('./arn-token-ledger.cjs');
const {ArkCacheShopService}=require('./ark-cache-shop-service.cjs');
const {ProtocolStore}=require('./protocol/store.cjs');
const {isStaff}=require('./ark-ops-extension.cjs');
const {loadConfig}=require('../shared/config.cjs');
const INSTALLED=Symbol.for('nexus.arn.cache.extension');
function adminCommand() {
  const c=new SlashCommandBuilder().setName('cacheadmin').setDescription('Staff cache delivery verification and recovery.');
  c.addSubcommand(s=>{
    s.setName('target').setDescription('Register an evidence-verified EOS to ARK player ID mapping.');
    for(const name of ['eos','map','playerid','evidence'])s.addStringOption(o=>o.setName(name).setDescription(name==='map'?'Server prefix, e.g. ARK_GEN1.':name).setRequired(true).setMaxLength(name==='evidence'?300:96));
    return s;
  });
  c.addSubcommand(s=>s.setName('reconcile').setDescription('Recover failed delivery after checking player inventory.').addStringOption(o=>o.setName('order').setDescription('Order UUID.').setRequired(true)).addBooleanOption(o=>o.setName('dino_received').setDescription('Verified creature is in inventory.').setRequired(true)).addBooleanOption(o=>o.setName('saddle_received').setDescription('Verified saddle is in inventory.').setRequired(true)).addStringOption(o=>o.setName('evidence').setDescription('Inventory verification evidence.').setRequired(true).setMinLength(3).setMaxLength(300)));
  return c.toJSON();
}
function command() {
  const c=new SlashCommandBuilder().setName('arn').setDescription('ARN Tokens and caches.');
  for(const name of ['balance','history','cache','buy','pause']) c.addSubcommand(s=>s.setName(name).setDescription(name==='pause'?'Staff: disable ARN earning and redemption.':`View or use ARN ${name}.`));
  c.addSubcommand(s=>s.setName('configure').setDescription('Staff: set rates and enable ARN.').addIntegerOption(o=>o.setName('earn').setDescription('Tokens per qualified completed activity.').setRequired(true).setMinValue(1).setMaxValue(1000000)).addIntegerOption(o=>o.setName('cost').setDescription('Tokens per ARN cache.').setRequired(true).setMinValue(1).setMaxValue(1000000)));
  c.addSubcommand(s=>s.setName('adjust').setDescription('Staff: audited token grant or removal.').addUserOption(o=>o.setName('player').setDescription('Player.').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Signed token adjustment.').setRequired(true).setMinValue(-1000000).setMaxValue(1000000)).addStringOption(o=>o.setName('reason').setDescription('Audit reason.').setRequired(true).setMinLength(3).setMaxLength(300)));
  return c.toJSON();
}
async function handle(interaction,{ledger,shop,config}) {
  const sub=interaction.options.getSubcommand(), user=String(interaction.user.id);
  if(interaction.commandName==='cacheadmin') {
    if(!isStaff(interaction,config))throw new Error('Nexus staff authorization required.');
    const receipts=require('./ark-cache-receipts.cjs');
    return ledger.using(async db=>{
      await receipts.ensureReceiptSchema(db);
      if(sub==='target')await receipts.registerTarget(db,{eosId:interaction.options.getString('eos'),prefix:interaction.options.getString('map').toUpperCase(),playerId:interaction.options.getString('playerid'),actor:user,evidence:interaction.options.getString('evidence')});
      else await receipts.reconcileDelivery(db,{orderId:interaction.options.getString('order'),dinoReceived:interaction.options.getBoolean('dino_received'),saddleReceived:interaction.options.getBoolean('saddle_received'),actor:user,evidence:interaction.options.getString('evidence')});
      return {content:'Cache delivery verification recorded.'};
    });
  }
  if(!['balance','history','cache','buy'].includes(sub)&&!isStaff(interaction,config)) throw new Error('Nexus staff authorization required.');
  if(sub==='configure') {await ledger.configure({enabled:true,earnRate:interaction.options.getInteger('earn'),cacheCost:interaction.options.getInteger('cost')},user);return {content:'ARN rates saved. Earning and redemption enabled for new activity.'};}
  if(sub==='pause') {await ledger.configure({enabled:false},user);return {content:'ARN earning and redemption disabled. Existing balances and rewards are preserved.'};}
  if(sub==='adjust') {const result=await ledger.adjust({user:interaction.options.getUser('player').id,delta:interaction.options.getInteger('amount'),key:interaction.id,reason:interaction.options.getString('reason')},user);return {content:`Adjustment recorded. Balance: ${result.balance} ARN Tokens.`};}
  if(sub==='history') {const rows=await ledger.history(user);return {content:rows.map(r=>`${Number(r.delta)>0?'+':''}${r.delta} • balance ${r.balance_after} • ${r.reason}`).join('\n').slice(0,1900)||'No ARN token transactions yet.'};}
  if(sub==='buy') {const result=await shop.purchase({discordUserId:user,cacheId:'arn',purchaseNonce:interaction.id});return require('./ark-dino-box-shop-extension.cjs').sealedResultPayload(result.order,result.balance,'ARN Tokens');}
  const view=await ledger.balance(user);
  if(sub==='cache') {await shop.refreshWeekly();return require('./ark-dino-box-shop-extension.cjs').cacheDetailPayload('arn');}
  return {content:`**${view.balance} ARN Tokens**\n${view.settings.enabled?`Earn ${view.settings.earn_rate} per qualified completed Anomaly activity. Cache cost: ${view.settings.cache_cost}.`:'Earning and redemption are disabled until staff set rates.'}`};
}
function installArnCacheExtension({config=loadConfig(),ledger=new ArnTokenLedger(),shop=new ArkCacheShopService()}={}) {
  if(Client.prototype[INSTALLED])return;
  Client.prototype[INSTALLED]=true;
  const login=Client.prototype.login;
  Client.prototype.login=function(...args) {
    const client=this;
    client.once(Events.ClientReady,async()=>{
      try {
        const guild=await client.guilds.fetch(String(config.discord?.guildId));
        const registered=await guild.commands.fetch();
        for(const definition of [command(),adminCommand()]) {
          const existing=registered.find(c=>c.name===definition.name);
          if(existing)await guild.commands.edit(existing.id,definition);else await guild.commands.create(definition);
        }
        const sync=()=>ledger.syncParticipation(new ProtocolStore()).catch(e=>console.error('[arn-tokens]',e.message));
        await sync(); const timer=setInterval(sync,30000);timer.unref?.();
      }catch(e){console.error('[arn-tokens]',e.message);}
    });
    client.on(Events.InteractionCreate,interaction=>{
      if(!interaction.isChatInputCommand?.()||!['arn','cacheadmin'].includes(interaction.commandName)||String(interaction.guildId)!==String(config.discord?.guildId))return;
      void(async()=>{await interaction.deferReply({flags:MessageFlags.Ephemeral});const payload=await handle(interaction,{ledger,shop,config});await interaction.editReply({...payload,allowedMentions:{parse:[]}});})().catch(e=>interaction.editReply({content:`ARN: ${e.message}`,allowedMentions:{parse:[]}}).catch(()=>{}));
    });
    return login.apply(this,args);
  };
}
module.exports={command,handle,installArnCacheExtension};
