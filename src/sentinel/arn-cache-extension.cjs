'use strict';
const {Client,Events,MessageFlags,SlashCommandBuilder}=require('discord.js');
const {ArnTokenLedger}=require('./arn-token-ledger.cjs');
const {isRetired}=require('./arkshop-mysql.cjs');
const {ARKSHOP_FEATURES_OFF_MESSAGE, memberFeatureUnavailableMessage, arkShopFeaturesAreOpen}=require('./arkshop-cluster-economy-guard.cjs');
const {ArkCacheShopService}=require('./ark-cache-shop-service.cjs');
const {ProtocolStore}=require('./protocol/store.cjs');
const {isStaff}=require('./ark-ops-extension.cjs');
const {loadConfig}=require('../shared/config.cjs');
const {sharedArnBook, staffSummaryText, writeSummaryFile, readMainArnBalance}=require('./arn-token-award.cjs');
const {tokenText, openPointerText}=require('./arn-member-copy.cjs');
const INSTALLED=Symbol.for('nexus.arn.cache.extension');
const STAFF_PAYOUTS_OFF='ARN payouts are off during the test week. Settings will be available here when payouts go live.';
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
  const c=new SlashCommandBuilder().setName('arn').setDescription('ARN tokens.');
  c.addSubcommand(s=>s.setName('tokens').setDescription('What ARN tokens are, and how many you have.'));
  c.addSubcommand(s=>s.setName('open').setDescription('Where to redeem an ARN cache.'));
  c.addSubcommand(s=>s.setName('report').setDescription('Staff: ARN trial summary. No payouts.'));
  c.addSubcommand(s=>s.setName('configure').setDescription('Staff: enable ARN. 25% chance on a tame, 10% on a kill.'));
  c.addSubcommand(s=>s.setName('pause').setDescription('Staff: disable ARN earning and redemption.'));
  c.addSubcommand(s=>s.setName('adjust').setDescription('Staff: audited token grant or removal.').addUserOption(o=>o.setName('player').setDescription('Player.').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Signed token adjustment.').setRequired(true).setMinValue(-1000000).setMaxValue(1000000)).addStringOption(o=>o.setName('reason').setDescription('Audit reason.').setRequired(true).setMinLength(3).setMaxLength(300)));
  return c.toJSON();
}
async function staffEconomy(explicit) {
  if (explicit) return explicit;
  const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
  const client = new NexusEconomyClient();
  return client.configured() ? client : null;
}
async function handle(interaction,{ledger,shop,config, book, env, now, secret, balanceReader, economy} = {}) {
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
  if(interaction.commandName==='arn' && sub==='open') return {content: openPointerText()};
  if(interaction.commandName==='arn' && ['balance','history','cache','buy'].includes(sub)) {
    return {content:'Use /arn tokens to see what ARN tokens are and how to earn them. Redeem a cache in #dino-box-shop.'};
  }
  if(interaction.commandName==='arn' && sub==='report' && !isStaff(interaction,config)) return {content:'Staff only.'};
  if(interaction.commandName==='arn' && ['tokens','report'].includes(sub)) {
    const activeBook = book || sharedArnBook();
    const activeEnv = env || process.env;
      if(sub==='report') {
      const summary = activeBook.summary(Date.now());
      if(activeEnv.ARN_DRY_RUN_REPORT) writeSummaryFile(summary, activeEnv.ARN_DRY_RUN_REPORT);
      return {content: staffSummaryText(summary)};
    }
    let balance;
    if (book) balance = activeBook.balanceForDiscord(user);
    else if (typeof balanceReader === 'function') balance = await balanceReader(user);
    else {
      const remote = await readMainArnBalance(user);
      balance = remote == null ? activeBook.balanceForDiscord(user) : remote;
    }
    return {content: tokenText(balance, activeEnv)};
  }
  if(!isStaff(interaction,config)) throw new Error('Nexus staff authorization required.');
  if(sub==='configure' || sub==='pause' || sub==='adjust') {
    const writer = await staffEconomy(economy);
    if(!writer) {
      const error = new Error('ARN ledger is not configured.');
      error.code = 'ARN_LEDGER_UNAVAILABLE';
      throw error;
    }
    if(sub==='configure' || sub==='pause') {
      const result = await writer.arnPause({ paused: sub === 'pause', actor: user, reason: sub });
      if(result?.reason === 'dry-run') return {content: STAFF_PAYOUTS_OFF};
      if(!result || result.ok === false) {
        const error = new Error(result?.reason || 'pause-failed');
        error.code = 'ARN_PAUSE_FAILED';
        throw error;
      }
      if(sub==='configure') return {content:'ARN enabled: 25% chance on a shiny tame and 10% on a shiny kill; 1 token per cache.'};
      return {content:'ARN earning and redemption disabled. Existing balances and rewards are preserved.'};
    }
    const result = await writer.arnAdjust({
      discordUserId: interaction.options.getUser('player').id,
      delta: interaction.options.getInteger('amount'),
      idempotencyKey: interaction.id,
      reason: interaction.options.getString('reason'),
      actor: user
    });
    if(result?.reason === 'dry-run') return {content: STAFF_PAYOUTS_OFF};
    if(!result || result.ok === false) {
      const error = new Error(result?.reason || 'adjust-failed');
      error.code = 'ARN_ADJUST_FAILED';
      throw error;
    }
    return {content:`Adjustment recorded. Balance: ${result.balance} ARN Tokens.`};
  }
  return {content:'Use /arn tokens to see what ARN tokens are and how to earn them. Redeem a cache in #dino-box-shop.'};
}
function arnMemberErrorContent(error) {
  const detail = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 500);
  const code = String(error?.code || '');
  console.error(`[arn-tokens] ${code ? `code=${code} ` : ''}${detail}`);
  return memberFeatureUnavailableMessage(error) || ARKSHOP_FEATURES_OFF_MESSAGE;
}
function installArnCacheExtension({config=loadConfig(),ledger=new ArnTokenLedger(),shop=new ArkCacheShopService()}={}) {
  if(Client.prototype[INSTALLED])return;
  Client.prototype[INSTALLED]=true;
  const mysqlRetired=isRetired();
  if(mysqlRetired) console.log('[arn-tokens] ArkShop MySQL retired; participation sync skipped.');
  const login=Client.prototype.login;
  Client.prototype.login=function(...args) {
    const client=this;
    client.once(Events.ClientReady,async()=>{
      try {
        sharedArnBook();
        const guild=await client.guilds.fetch(String(config.discord?.guildId));
        const registered=await guild.commands.fetch();
        for(const definition of [command(),adminCommand()]) {
          const existing=registered.find(c=>c.name===definition.name);
          if(existing)await guild.commands.edit(existing.id,definition);else await guild.commands.create(definition);
        }
        if(!mysqlRetired && await arkShopFeaturesAreOpen()){
          const sync=()=>ledger.syncParticipation(new ProtocolStore()).catch(e=>console.error('[arn-tokens]',e.message));
          await sync(); const timer=setInterval(sync,30000);timer.unref?.();
        } else if(!mysqlRetired) console.log('[arn-tokens] ArkShop cluster economy is retired; participation sync skipped.');
      }catch(e){console.error('[arn-tokens]',e.message);}
    });
    client.on(Events.InteractionCreate,interaction=>{
      if(!interaction.isChatInputCommand?.()||!['arn','cacheadmin'].includes(interaction.commandName)||String(interaction.guildId)!==String(config.discord?.guildId))return;
      void(async()=>{await interaction.deferReply({flags:MessageFlags.Ephemeral});const payload=await handle(interaction,{ledger,shop,config});await interaction.editReply({...payload,allowedMentions:{parse:[]}});})().catch(e=>interaction.editReply({content:arnMemberErrorContent(e),allowedMentions:{parse:[]}}).catch(()=>{}));
    });
    return login.apply(this,args);
  };
}
module.exports={command,handle,arnMemberErrorContent,installArnCacheExtension};
