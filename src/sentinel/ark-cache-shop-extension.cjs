'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  MessageFlags,
  StringSelectMenuBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const { BUTTON_CACHE_SHOP } = require('./ark-cluster-panel.cjs');
const { ArkCacheShopService } = require('./ark-cache-shop-service.cjs');
const { cacheImageAttachment, cacheImageName } = require('./ark-cache-shop-art.cjs');

const SELECT_CACHE = 'nexus-ark-cache-select';
const BUTTON_BACK = 'nexus-ark-cache-back';
const BUTTON_REWARDS = 'nexus-ark-cache-rewards';
const BUY_PREFIX = 'nexus-ark-cache-buy:';
const INSTALLED = Symbol.for('khaos.nexus.ark.cache.shop.extension');
const BOUND = Symbol.for('khaos.nexus.ark.cache.shop.extension.bound');

const CACHE_META = Object.freeze({
  coastal:{name:'Coastal Cache',emoji:'🏝️',tagline:'Coastal, beach, and shoreline creatures.'},
  forest:{name:'Forest Cache',emoji:'🌲',tagline:'Forest hunters, utility tames, and rare predators.'},
  swamp:{name:'Swamp Cache',emoji:'🌿',tagline:'Wetland creatures with a strong Baryonyx chase roll.'},
  mountain:{name:'Mountain Cache',emoji:'⛰️',tagline:'Harvesters, flyers, predators, Rex, and Yutyrannus.'},
  ocean:{name:'Ocean Cache',emoji:'🌊',tagline:'Aquatic progression from Megalodon through Mosasaurus.'},
  deepcave:{name:'Deep Cave Cache',emoji:'💎',tagline:'Cave creatures with rare Megalosaurus potential.'},
  apex:{name:'Apex Cache',emoji:'👑',tagline:'Endgame apex pool with a seven-day purchase cooldown.'}
});

function titleCase(value){return String(value||'').replace(/(^|[-_\s])([a-z])/g,(_,p,c)=>`${p}${c.toUpperCase()}`);}
function fmtPoints(value){return `${Math.max(0,Number(value)||0).toLocaleString('en-US')} NP`;}
function meta(cacheId){return CACHE_META[cacheId]||{name:`${titleCase(cacheId)} Cache`,emoji:'🦖',tagline:'Nexus Dino Cache.'};}
function cacheIds(){return Object.keys(CONFIG.caches);}

function catalogSelect(selected=''){
  const menu=new StringSelectMenuBuilder().setCustomId(SELECT_CACHE).setPlaceholder('Choose a Dino Cache to inspect').setMinValues(1).setMaxValues(1);
  menu.addOptions(cacheIds().map((id)=>({
    label:meta(id).name.slice(0,100),
    value:id,
    emoji:meta(id).emoji,
    description:`${fmtPoints(CONFIG.caches[id].price)}${CONFIG.caches[id].cooldownHours?` • ${CONFIG.caches[id].cooldownHours}h cooldown`:''}`.slice(0,100),
    default:id===selected
  })));
  return new ActionRowBuilder().addComponents(menu);
}

function navigationRow({cacheId='',canBuy=false}={}){
  const row=new ActionRowBuilder();
  if(cacheId&&canBuy)row.addComponents(new ButtonBuilder().setCustomId(`${BUY_PREFIX}${cacheId}`).setLabel(`Buy & Open • ${fmtPoints(CONFIG.caches[cacheId].price)}`).setEmoji('🎰').setStyle(ButtonStyle.Success));
  row.addComponents(new ButtonBuilder().setCustomId(BUTTON_REWARDS).setLabel('My Rewards').setEmoji('🎁').setStyle(ButtonStyle.Secondary));
  if(cacheId)row.addComponents(new ButtonBuilder().setCustomId(BUTTON_BACK).setLabel('Back').setEmoji('↩️').setStyle(ButtonStyle.Secondary));
  return row;
}

function catalogEmbed(shopper=null,warning=''){
  const lines=cacheIds().map((id)=>{
    const cache=CONFIG.caches[id], m=meta(id);
    return `${m.emoji} **${m.name}** — **${fmtPoints(cache.price)}**${cache.cooldownHours?` • ${cache.cooldownHours/24}-day cooldown`:''}\n${m.tagline}`;
  });
  const account=shopper?.account?.playerName?`Linked ARK: **${shopper.account.playerName}**`:'ARK link: **required to purchase**';
  const wallet=Number.isFinite(shopper?.points)?`Nexus Points: **${fmtPoints(shopper.points)}**`:'Nexus Points: **checked at checkout**';
  return {
    title:'🎰 Khaos Nexus • Cache Shop',
    description:`Dino Cache rolls are committed at purchase time in Discord, then queued for exact ARK delivery. Choose a cache below to see its image, creature pool, and full roll tables.\n\n${account}\n${wallet}${warning?`\n⚠️ ${String(warning).slice(0,250)}`:''}\n\n${lines.join('\n\n')}`,
    color:0xb00020,
    footer:{text:'Nexus Sentinal • Discord-first Dino Cache Terminal'}
  };
}

function raritySummary(cache){
  const rarities=Object.keys(CONFIG.rarityWeights).filter((rarity)=>cache.entries.some((entry)=>entry.rarity===rarity));
  const total=rarities.reduce((sum,rarity)=>sum+Number(CONFIG.rarityWeights[rarity]||0),0);
  return rarities.map((rarity)=>`${titleCase(rarity)} ${(Number(CONFIG.rarityWeights[rarity]||0)/total*100).toFixed(1)}%`).join(' • ');
}

function speciesByRarity(cache){
  const fields=[];
  for(const rarity of Object.keys(CONFIG.rarityWeights)){
    const entries=cache.entries.filter((entry)=>entry.rarity===rarity);
    if(!entries.length)continue;
    const text=entries.map((entry)=>{
      const variants=Object.keys(entry.variants||{}).map((v)=>v.toUpperCase());
      return `• ${entry.name}${variants.length?` [${variants.join('/')}]`:''}`;
    }).join('\n');
    fields.push({name:`${titleCase(rarity)} Species`,value:text.slice(0,1024),inline:true});
  }
  return fields;
}

function levelTable(){return CONFIG.levelBuckets.map((b)=>`${b.min===b.max?b.min:`${b.min}–${b.max}`}: ${b.weight}%`).join(' • ');}
function variantTable(cache){return Object.entries(cache.variantWeights).map(([key,value])=>`${key==='normal'?'Normal':key.toUpperCase()} ${value}%`).join(' • ');}

function detailPayload(cacheId,shopper=null){
  const cache=CONFIG.caches[cacheId];
  if(!cache)throw new Error('Unknown Dino Cache.');
  const m=meta(cacheId), imageName=cacheImageName(cacheId);
  const fields=[
    {name:'💰 Price',value:`**${fmtPoints(cache.price)}**${cache.cooldownHours?`\nCooldown: **${cache.cooldownHours/24} days**`:''}`,inline:true},
    {name:'🎲 Rarity Roll',value:raritySummary(cache),inline:false},
    ...speciesByRarity(cache),
    {name:'🧬 Variant Roll',value:`${variantTable(cache)}\n*Only variants supported by the rolled species remain eligible; weights are re-normalized among eligible outcomes.*`,inline:false},
    {name:'📈 Level Roll',value:levelTable(),inline:false},
    {name:'⚥ Sex Roll',value:'Male **50%** • Female **50%**',inline:false},
    {name:'📦 Delivery',value:'The final reward is saved **before** the reveal animation and cannot be rerolled. It is queued as **Awaiting ARK Delivery** for the linked player.',inline:false}
  ];
  if(shopper)fields.unshift({name:'Wallet',value:`${fmtPoints(shopper.points)} available`,inline:true});
  return {
    embeds:[{title:`${m.emoji} ${m.name}`,description:m.tagline,color:0xb00020,fields:fields.slice(0,25),image:{url:`attachment://${imageName}`},footer:{text:'Nexus Cache Terminal • Species → Variant → Level → Sex'}}],
    components:[catalogSelect(cacheId),navigationRow({cacheId,canBuy:true})],
    files:[cacheImageAttachment(cacheId)],
    allowedMentions:{parse:[]}
  };
}

function catalogPayload(shopper=null,warning=''){
  return {embeds:[catalogEmbed(shopper,warning)],components:[catalogSelect(),navigationRow()],attachments:[],allowedMentions:{parse:[]}};
}

function rewardState(state){if(state==='DELIVERED')return'✅ Delivered';if(state==='DELIVERY_FAILED')return'⚠️ Delivery Failed';if(state==='DELIVERING')return'📦 Delivering';return'⏳ Awaiting ARK Delivery';}
function rewardsPayload(rows=[]){
  const description=rows.length?rows.map((row)=>{
    const m=meta(row.cacheType);return `${m.emoji} **${row.publicCacheId}** • ${m.name}\n${row.species} • Lv. ${row.level} • ${row.variant==='normal'?'Normal':row.variant.toUpperCase()} • ${titleCase(row.sex)}\n${rewardState(row.state)}`;
  }).join('\n\n'):'You do not have any Discord Dino Cache rewards yet.';
  return {embeds:[{title:'🎁 My Dino Cache Rewards',description:description.slice(0,4000),color:0xb00020,footer:{text:'Nexus Sentinal • Immutable cache reward history'}}],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(BUTTON_BACK).setLabel('Back to Cache Shop').setEmoji('↩️').setStyle(ButtonStyle.Secondary))],attachments:[],allowedMentions:{parse:[]}};
}

function reelPreview(cacheId,index){const entries=CONFIG.caches[cacheId]?.entries||[];if(!entries.length)return'???';return[0,1,2].map((n)=>entries[(index+n*2)%entries.length]?.name||'???').join('  ◀︎  ');}
function revealPayload(order,stage){
  const variant=order.variant==='normal'?'Normal':order.variant.toUpperCase();
  const stages=[
    `🎰 **SPECIES REEL**\n${reelPreview(order.cacheType,0)}\n\nVariant: ▓▓▓ • Level: ▓▓▓ • Sex: ▓▓▓`,
    `🔒 **SPECIES LOCKED:** ${order.species}\n🎰 **VARIANT REEL:** Normal  ◀︎  X  ◀︎  S\n\nLevel: ▓▓▓ • Sex: ▓▓▓`,
    `🔒 ${order.species} • **${variant}**\n🎰 **LEVEL REEL:** 200  ◀︎  250  ◀︎  300\n\nSex: ▓▓▓`,
    `🔒 ${order.species} • ${variant} • **Lv. ${order.level}**\n🎰 **SEX REEL:** Male  ◀︎  Female`
  ];
  return {embeds:[{title:'🎰 Nexus Cache Terminal • Rolling',description:stages[Math.max(0,Math.min(stages.length-1,stage))],color:0xb00020,footer:{text:`Reward already committed • ${order.publicCacheId}`}}],components:[],allowedMentions:{parse:[]}};
}
function finalRewardPayload(order,balance=null){
  const m=meta(order.cacheType), variant=order.variant==='normal'?'Normal':order.variant.toUpperCase();
  return {embeds:[{title:`✨ ${m.name} • Cache Opened`,description:`**${order.species}**\nLevel **${order.level}** • **${variant}** • **${titleCase(order.sex)}**`,color:0xb00020,fields:[{name:'Cache ID',value:`\`${order.publicCacheId}\``,inline:true},{name:'Rarity',value:titleCase(order.rarity),inline:true},{name:'Status',value:'⏳ **Awaiting ARK Delivery**',inline:false},...(Number.isFinite(balance)?[{name:'Remaining Nexus Points',value:fmtPoints(balance),inline:false}]:[])],footer:{text:'Result locked • no rerolls • delivery uses this saved reward'}}],components:[navigationRow()],attachments:[],allowedMentions:{parse:[]}};
}

function sleep(ms){return new Promise((resolve)=>setTimeout(resolve,ms));}
async function safeShopper(service,userId){try{return{shopper:await service.shopper(userId),warning:''};}catch(error){return{shopper:null,warning:error?.code==='ARK_ACCOUNT_NOT_LINKED'?'Link your Discord account to ARK to enable purchases.':String(error?.message||error).slice(0,220)};}}

function installArkCacheShopExtension(options={}){
  if(Client.prototype[INSTALLED])return;
  Client.prototype[INSTALLED]=true;
  const config=options.config||loadConfig();
  const service=options.service||new ArkCacheShopService();
  const originalLogin=Client.prototype.login;
  Client.prototype.login=function nexusArkCacheShopLogin(...args){
    const client=this;
    if(!client[BOUND]){
      client[BOUND]=true;
      client.on(Events.InteractionCreate,(interaction)=>{
        const guildOk=String(interaction.guildId||'')===String(config.discord?.guildId||'');
        if(!guildOk)return;
        const id=String(interaction.customId||'');
        const isOpen=interaction.isButton?.()&&id===BUTTON_CACHE_SHOP;
        const isBack=interaction.isButton?.()&&id===BUTTON_BACK;
        const isRewards=interaction.isButton?.()&&id===BUTTON_REWARDS;
        const isBuy=interaction.isButton?.()&&id.startsWith(BUY_PREFIX);
        const isSelect=interaction.isStringSelectMenu?.()&&id===SELECT_CACHE;
        if(!isOpen&&!isBack&&!isRewards&&!isBuy&&!isSelect)return;

        void(async()=>{
          const userId=String(interaction.user?.id||'');
          if(isOpen){
            await interaction.deferReply({flags:MessageFlags.Ephemeral});
            const view=await safeShopper(service,userId);
            return interaction.editReply(catalogPayload(view.shopper,view.warning));
          }
          if(isBack){
            await interaction.deferUpdate();
            const view=await safeShopper(service,userId);
            return interaction.editReply(catalogPayload(view.shopper,view.warning));
          }
          if(isRewards){
            await interaction.deferUpdate();
            const rows=await service.rewards(userId,8);
            return interaction.editReply(rewardsPayload(rows));
          }
          if(isSelect){
            await interaction.deferUpdate();
            const cacheId=String(interaction.values?.[0]||'').toLowerCase();
            let shopper=null;try{shopper=await service.shopper(userId);}catch{}
            return interaction.editReply(detailPayload(cacheId,shopper));
          }
          if(isBuy){
            await interaction.deferUpdate();
            const cacheId=id.slice(BUY_PREFIX.length).toLowerCase();
            const result=await service.purchase({discordUserId:userId,cacheId,purchaseNonce:String(interaction.id)});
            for(let stage=0;stage<4;stage+=1){await interaction.editReply(revealPayload(result.order,stage));await sleep(420);}
            return interaction.editReply(finalRewardPayload(result.order,result.balance));
          }
        })().catch(async(error)=>{
          const content=`⚠️ **Cache Shop:** ${String(error?.message||error).slice(0,400)}`;
          const payload={content,embeds:[],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(BUTTON_BACK).setLabel('Back to Cache Shop').setStyle(ButtonStyle.Secondary))],attachments:[],allowedMentions:{parse:[]}};
          if(interaction.deferred||interaction.replied)await interaction.editReply(payload).catch(()=>{});
          else await interaction.reply({...payload,flags:MessageFlags.Ephemeral}).catch(()=>{});
        });
      });
    }
    return originalLogin.apply(this,args);
  };
}

module.exports={
  BUTTON_CACHE_SHOP,SELECT_CACHE,BUTTON_BACK,BUTTON_REWARDS,BUY_PREFIX,CACHE_META,
  titleCase,fmtPoints,meta,cacheIds,catalogSelect,navigationRow,catalogEmbed,raritySummary,speciesByRarity,levelTable,variantTable,detailPayload,catalogPayload,rewardsPayload,reelPreview,revealPayload,finalRewardPayload,installArkCacheShopExtension
};
