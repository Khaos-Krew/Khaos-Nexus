'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { findStaffCategory, normalizeName } = require('./staff-workspace.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkShopPlan.extension');
const CHANNEL_NAME = 'ark-shop-plan';
const INITIAL_DELAY_MS = 90_000;
const PERIODIC_MS = 60 * 60_000;
const PLAN_VERSION = 'v1';

const SECTIONS = Object.freeze([
  {
    title: 'KHAOS NEXUS • ARK CLUSTER SHOP PLAN',
    marker: `Nexus Sentinal • ARK Shop Plan • 1/7 • ${PLAN_VERSION}`,
    description: [
      '**Status: Approved baseline planning document**',
      '',
      '## 💰 Core Currency — Nexus Points (NP)',
      'Nexus Points are the cluster economy currency. Players earn NP through gameplay, resource selling, Alpha/Apex hunting, boss drops, events, participation, and future Sentinel-managed rewards.',
      '',
      '**Sentinel centrally manages:** pricing, buy/sell values, kits, dino-cache pools and odds, cooldowns, DLC/content restrictions, map availability, banking, transfers, transaction logs, dynamic-market rules, exploit detection, and shop regeneration/reload.',
      '',
      '## 🏦 Banking & Trading',
      '• **Active Nexus Points** — normal ArkShop spendable balance.',
      '• **Nexus Credits** — physical withdrawn currency for storage/trading.',
      '• `/withdraw <amount>` — remove NP and issue Nexus Credits.',
      '• `/deposit <amount>` — consume Nexus Credits and restore NP.',
      '• Native ArkShop `/trade "Player Name" amount` remains available for direct digital transfers.',
      '• Player transfers are normally **fee-free**.',
      '',
      '**Planned denominations:** 100 NP, 500 NP, 1,000 NP, and 10,000 NP Cache.',
      '',
      '## 🔐 Nexus Vault',
      'Dedicated currency storage if technically possible. Nexus Credits must be non-craftable, non-drop-generated, non-grindable, and issued only after a successful deduction. Deposits must destroy the physical currency before crediting NP. Sentinel logs every deposit, withdrawal, and transfer.'
    ].join('\n')
  },
  {
    title: 'STARTER, DINO BALLS & PURCHASABLE KITS',
    marker: `Nexus Sentinal • ARK Shop Plan • 2/7 • ${PLAN_VERSION}`,
    description: [
      '## 🎁 Free Nexus Starter Kit',
      '**Price:** FREE • **Limit:** one claim per player across the cluster.',
      'Metal Pick, Metal Hatchet, Crossbow, 50 Tranq Arrows, Spyglass, 10 Parachutes, 10 Bolas, 25 Medical Brews, Canteen/Water Jar, 50 Cooked Meat, 3 Sleeping Bags, Primitive Flak Set, **2 Dino Balls**.',
      'Optional starter creature: Parasaur around **Level 100–150**. Starter dinos do not use premium-cache level rules.',
      '',
      '## ⚾ Dino Balls',
      'Dino Balls replace Cryopods everywhere in the Nexus shop. Direct packs planned at **×5 / ×25 / ×100**; final pricing will follow server crafting/farming rates.',
      '',
      '## 📦 Purchasable Kits',
      '**Survivor Recovery — 200 NP** • Primitive Flak, metal tools, crossbow/tranqs, medical brews, parachutes, Dino Balls. Suggested 6h cooldown.',
      '**Builder — 450 NP** • Metal tools, optional chainsaw, 5k Wood, 5k Stone, 2.5k Thatch, 2.5k Fiber, 1k Metal Ingots, 500 Paste.',
      '**Taming — 500 NP** • 250 Tranq Arrows, 100 Narcotics, brews, Exceptional/Superior Kibble, 10 Dino Balls, Spyglass, Primitive/Ramshackle Longneck.',
      '**Breeder — 600 NP** • 20 Dino Balls, kibble assortment, brews, Sweet Veg Cakes, food/breeding consumables. No perfect stats, injected mutations, or artificial perfect breeders.',
      '**Ocean — 650 NP** • SCUBA set, Lazarus Chowder, brews, Harpoon Launcher/ammo, Dino Balls.',
      '**Boss Prep — 1,000 NP** • 100 Medical Brews, Enduro Stew, Focal Chili, Lazarus Chowder, Calien Soup, Fria Curry, ammo bundle, Dino Balls. No artifacts, boss trophies, or progression-bypass tributes.'
    ].join('\n')
  },
  {
    title: 'DINO CACHE CORE RULES',
    marker: `Nexus Sentinal • ARK Shop Plan • 3/7 • ${PLAN_VERSION}`,
    description: [
      '## 🦖 Universal Cache Dino Level',
      'All purchased/random dino-cache rewards use a **base level roll of 200–300** for natural stat allocation.',
      '',
      '**Level weighting:**',
      '• 200–219 — 30%',
      '• 220–239 — 25%',
      '• 240–259 — 20%',
      '• 260–279 — 15%',
      '• 280–294 — 8%',
      '• **295–300 — 2%**',
      '',
      '## 🧬 Normal / X / S Roll',
      'Where supported: **Normal 93% • X 5% • S 2%**. The species is selected first. If that creature does not support the rolled X/S variant, it stays normal instead of rerolling the species.',
      '',
      '## ✨ Shiny! Roll',
      'Every eligible cache receives an independent **2% Shiny chance**. Shiny may stack with Normal, X, or S when compatibility testing allows it. Shiny effects/colors are generated naturally by the Shiny system.',
      '',
      '**Approximate combined rarity:** Any Shiny 2% • Shiny X ~0.10% • Shiny S ~0.04%.',
      '',
      '## 🎰 Jackpot Announcements',
      'Normal: no public post • X/S: personal rare notification • Shiny: ✨ Rare Pull • Shiny X: 💎 Epic Pull • Shiny S: 🔥 Nexus Jackpot • **Shiny S + Level 295–300: ☠️ Mythic Nexus Jackpot**.',
      '',
      '## 🎲 General Species Rarity',
      'Starting weighting: **Common 55% • Uncommon 28% • Rare 13% • Ultra-Rare 4%**. Each cache receives its own species-specific weights.'
    ].join('\n')
  },
  {
    title: 'BIOME & APEX DINO CACHES',
    marker: `Nexus Sentinal • ARK Shop Plan • 4/7 • ${PLAN_VERSION}`,
    description: [
      '## 🌎 Biome Cache Prices',
      '🏖️ **Coastal — 800 NP** • Parasaur, Moschops, Carbonemys, Trike, Pteranodon, Ichthy + appropriate coastal species.',
      '🌲 **Forest — 1,250 NP** • Raptor, Carno, Therizino, Direbear, Thylacoleo, Gigantopithecus + forest species.',
      '🐊 **Swamp — 1,400 NP** • Sarco, Baryonyx, Kapro, Beelzebufo, Deinosuchus + swamp species.',
      '⛰️ **Mountain — 1,800 NP** • Argentavis, Ankylo, Doedicurus, Sabertooth, Allosaurus, Rex, Yutyrannus + mountain species.',
      '🏜️ **Desert — 1,900 NP** • Morellatops, Thorny Dragon, Mantis, Fasolasuchus, Griffin + desert species.',
      '❄️ **Frozen — 2,000 NP** • Direwolf, Mammoth, Yutyrannus, Snow Owl, Managarmr + snow species.',
      '🌊 **Ocean — 2,200 NP** • Megalodon, Dunkleosteus, Basilosaurus, Angler, Plesio, Mosa + ocean species.',
      '🦇 **Deep Cave — 2,200 NP** • Megalosaurus, Desmodus, Arthropluera, Araneo + cave species.',
      '💎 **Aberrant — 2,800 NP** • Ravager, Shinehorn, Megalosaurus, Rock Drake + appropriate Aberrant species.',
      '🌋 **Volcanic — 2,800 NP** • Allosaurus, Rex, Mantis, Magmasaur, appropriate Wyverns + volcanic species.',
      '',
      '## ☠️ Nexus Apex Cache — 8,000 NP',
      'Reserved for specifically approved high-end creatures such as Giganotosaurus, Carcharodontosaurus, Rhyniognatha, Reaper, and future approved apex creatures.',
      '**Level:** 200–300 • **Suggested variant odds:** Normal 95%, X 3.5%, S 1.5% • **Cooldown:** 7 days.',
      '',
      'Suggested regular biome-cache limit: **3 purchases per 24 hours**.'
    ].join('\n')
  },
  {
    title: 'DLC / SPECIAL DINO CACHES',
    marker: `Nexus Sentinal • ARK Shop Plan • 5/7 • ${PLAN_VERSION}`,
    description: [
      '## 🤠 Bob’s Tall Tales Cache — 3,500 NP',
      'Dedicated DLC/content cache. Starting weights: **Armadoggo 45% • Cosmo 35% • Oasisaur 20%**.',
      'Level 200–300 where applicable. Suggested cooldown: **48 hours**. Entitlement/content compatibility must be validated before charging points. These creatures stay out of ordinary biome boxes.',
      '',
      '## ❄️ Lost Colony Cache — 5,000 NP',
      'Starting weights: **Cryolophosaurus 25% • Gloon 20% • Veilwyn 20% • Ossidon 15% • Gigadesmodus 10% • Aureliax 10%**.',
      'Level 200–300. Suggested cooldown: **72 hours**. Optional Aureliax winner cooldown: **7 days**.',
      'Veilwyn should normally be awarded as Veilwyn and evolved naturally rather than skipping the evolution system.',
      'Lost Colony creatures remain outside normal biome boxes.',
      '',
      '## ✨ Special Rolls Still Apply',
      'Eligible Bob’s Tall Tales and Lost Colony rewards use the same independent level, X/S, and Shiny logic where technically compatible. Sentinel maintains a compatibility table to prevent unsupported combinations.'
    ].join('\n')
  },
  {
    title: 'BULK RESOURCE BUY & SELL MARKET',
    marker: `Nexus Sentinal • ARK Shop Plan • 6/7 • ${PLAN_VERSION}`,
    description: [
      '## 🪨 Bulk Resource Buy Shop',
      '**Basic:** Fiber 10k—100 NP • Thatch 10k—100 • Wood 10k—150 • Stone 10k—150 • Flint 10k—175 • Hide 10k—200.',
      '**Intermediate:** Metal Ingots 5k—450 • Cementing Paste 5k—500 • Crystal 5k—400 • Obsidian 5k—450 • Silica Pearls 5k—450 • Oil 5k—350 • Polymer 2.5k—600 • Electronics 2.5k—700.',
      '**Advanced:** Black Pearls 1k—650 • Organic Polymer 2.5k—500 • Angler Gel 2.5k—300 • Sap 2.5k—300 • Rare Flowers 2.5k—300 • Rare Mushrooms 2.5k—300.',
      'Normally excluded from direct purchase: Element, Element Shards, Artifacts, Boss Trophies, Alpha/Apex Trophies.',
      '',
      '## 📉 Resource Sell Shop',
      'Wood 10k—20 NP • Stone 10k—20 • Metal Ingots 5k—75 • Cementing Paste 5k—85 • Crystal 5k—65 • Polymer 2.5k—90 • Black Pearls 1k—100.',
      'General protection: **buy price roughly 5–7× sell payout** to prevent arbitrage. Suggested resource-sale earnings cap: **2,000 NP/day**. Apex and boss drops do not normally count toward this cap.',
      '',
      '## 📈 Future Dynamic Market',
      'Sentinel can rotate resources through 🟢 Normal, 🔥 High Demand, and 📉 Oversupplied states so there is no permanent single best NP farm.'
    ].join('\n')
  },
  {
    title: 'APEX/BOSS SELL SHOP, SAFEGUARDS & SENTINEL',
    marker: `Nexus Sentinal • ARK Shop Plan • 7/7 • ${PLAN_VERSION}`,
    description: [
      '## ☠️ Required Alpha/Apex Drop Market',
      'Alpha Raptor Claw—75 NP • Alpha Carno Arm—125 • Alpha Megalodon Fin—125 • Alpha Leedsichthys Blubber—150 • Alpha Rex Tooth—250 • Alpha Mosasaur Tooth—300 • Alpha Tusoteuthis Eye—325 • Alpha Reaper King Barb—400.',
      'These should normally have no strict daily cap unless exploitation is detected.',
      '',
      '## 👑 Required Boss Trophy Sell Shop',
      '**Broodmother:** Gamma 400 • Beta 900 • Alpha 1,800 NP.',
      '**Megapithecus:** Gamma 500 • Beta 1,100 • Alpha 2,200 NP.',
      '**Dragon:** Gamma 750 • Beta 1,700 • Alpha 3,400 NP.',
      'Future tables: Manticore, Rockwell, Overseer, Titans, King Titan, Crystal Wyvern Queen, Dinopithecus King, Fenrisúlfr, Center bosses, Lost Colony bosses, and future ASA content. Progression-critical trophies must show a warning before sale.',
      '',
      '## 🔒 Economy Safeguards',
      'Sentinel watches duplicate transactions, suspicious point generation, impossible boss/alpha quantities, resource-sale spikes, buy/sell arbitrage, starter-kit/map-hopping abuse, withdrawal/deposit duplication, physical currency duplication, and suspicious transfers.',
      '',
      '## 🖥️ Shop UI Categories',
      '🎁 Starter & Recovery • 📦 Kits • ⚾ Dino Balls • 🪨 Bulk Resources • 🦖 Dino Caches • ✨ Special & DLC Caches • 🎨 Cosmetics • 💰 Sell Resources • ☠️ Sell Apex Drops • 👑 Sell Boss Trophies • 🏦 Nexus Bank • 🤝 Transfer Points • 📜 Transaction History.',
      '',
      '**This channel is Sentinel-managed. Update the source plan rather than manually replacing the canonical messages.**'
    ].join('\n')
  }
]);

function embedPayload(section) {
  return {
    embeds: [{
      title: section.title,
      description: section.description,
      footer: { text: section.marker }
    }],
    allowedMentions: { parse: [] }
  };
}

function hasMarker(message, marker, botId) {
  if (!message || String(message.author?.id || '') !== String(botId || '')) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === marker);
}

async function ensureChannel(guild) {
  const channels = await guild.channels.fetch();
  const category = findStaffCategory(channels);
  if (!category) return { skipped: 'staff-category-not-found' };

  let channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText
    && normalizeName(item.name) === normalizeName(CHANNEL_NAME)) || null;

  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Sentinel-managed Khaos Nexus ARK cluster shop economy, kits, dino caches, banking, trading, resource market, and sell-shop plan.',
      reason: 'Nexus Sentinal ARK shop plan workspace'
    });
    created = true;
  } else if (String(channel.parentId || '') !== String(category.id)) {
    await channel.setParent(category.id, { lockPermissions: true, reason: 'Nexus Sentinal ARK shop plan organization' });
  }

  if (typeof channel.lockPermissions === 'function') {
    await channel.lockPermissions('Nexus Sentinal ARK shop plan staff privacy').catch(() => {});
  }
  return { channel, created };
}

async function reconcileArkShopPlan(client, config, reason = 'manual') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channelResult = await ensureChannel(guild);
  if (channelResult.skipped) return channelResult;
  const channel = channelResult.channel;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  let created = 0;
  let updated = 0;
  let pinned = false;

  for (const [index, section] of SECTIONS.entries()) {
    const matches = recent?.values
      ? [...recent.values()].filter((message) => hasMarker(message, section.marker, client.user.id))
      : [];
    matches.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
    let message = matches[0] || null;
    const payload = embedPayload(section);
    if (!message) {
      message = await channel.send(payload);
      created += 1;
    } else {
      const current = message.embeds?.[0];
      const sameTitle = String(current?.title || '') === section.title;
      const sameDescription = String(current?.description || '') === section.description;
      if (!sameTitle || !sameDescription) {
        await message.edit(payload);
        updated += 1;
      }
    }
    if (index === 0 && !message.pinned && typeof message.pin === 'function') {
      try { await message.pin('Nexus Sentinal canonical ARK shop plan'); pinned = true; } catch {}
    }
    for (const duplicate of matches.slice(1)) {
      await duplicate.delete('Nexus Sentinal duplicate ARK shop plan section').catch(() => {});
    }
  }

  return { reason, channelId: String(channel.id), channelCreated: channelResult.created, sections: SECTIONS.length, created, updated, pinned };
}

function installArkShopPlanExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkShopPlanLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await reconcileArkShopPlan(client, config, reason);
          if (result.skipped) return console.warn(`[Nexus Sentinal] ARK shop plan skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] ARK shop plan (${reason}): channel=${result.channelId} channelCreated=${result.channelCreated} sections=${result.sections} created=${result.created} updated=${result.updated} pinned=${result.pinned}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARK shop plan unavailable: ${String(error?.message || error).slice(0, 300)}`);
        }
      };
      const initial = setTimeout(() => run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => run('periodic'), PERIODIC_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  CHANNEL_NAME,
  PLAN_VERSION,
  SECTIONS,
  reconcileArkShopPlan,
  installArkShopPlanExtension
};
