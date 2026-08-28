'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizeName } = require('./staff-workspace.cjs');

const INSTALLED = Symbol.for('khaos.nexus.arkShopPlanAdditions.extension');
const CHANNEL_NAME = 'ark-shop-plan';
const INITIAL_DELAY_MS = 210_000;
const PERIODIC_MS = 60 * 60_000;

const ADDITIONS = Object.freeze([
  {
    title: 'ENDGAME INFRASTRUCTURE & ELEMENT',
    marker: 'Nexus Sentinal • ARK Shop Plan • Endgame Infrastructure • v1',
    description: [
      '**Approved direction; exact quantities/prices remain tunable against live gather rates and progression.**',
      '',
      '## 🏭 Industrial Infrastructure Kit',
      '**Working starting price: 10,000 NP**',
      'Planned as a convenience bundle, not a progression bypass: Industrial Forge, Industrial Cooker, Industrial Grill, Chemistry Bench, Fabricator, Generator, Refrigerators, Air Conditioners, electrical support pieces, and starter fuel.',
      'All included stations remain normally craftable. The shop simply offers an expensive shortcut for established players/tribes rebuilding or expanding.',
      '',
      '## 🤖 Tek Structure Kit',
      '**Working starting price: 25,000 NP**',
      'Focused on Tek building pieces plus a meaningful Element allocation. It does **not** grant Tek engrams, boss trophies, artifacts, or progression unlocks. Purchase eligibility should respect the player’s legitimate Tek progression.',
      '',
      '## ⚛️ Element Shop',
      'Element is approved as a direct Nexus Point purchase and is **buy-only** to prevent circular economy exploits.',
      '• Element ×25 — **750 NP**',
      '• Element ×100 — **2,500 NP**',
      '• Element ×250 — **5,500 NP**',
      '• Element ×500 — **10,000 NP**',
      '• Element ×1,000 — **18,000 NP**',
      'Sentinel should watch for Element→resource→NP arbitrage and can make availability/pricing map-aware as the cluster expands.',
      '',
      '## 🏗️ Future High-End Variants',
      'Planned expansion options include an **Industrial Mega Kit (20k–25k NP)** and **Tek Mega Structure Kit (40k–50k NP)** for large tribe/base projects.'
    ].join('\n')
  },
  {
    title: '🐲 BEASTS OF THE SKY CACHE',
    marker: 'Nexus Sentinal • ARK Shop Plan • Beasts of the Sky • v1',
    description: [
      '**Working starting price: 7,500 NP • Suggested cooldown: 72 hours • Base level: 200–300**',
      '',
      'This premium cache uses a **family roll** rather than the normal X/S family conversion because the creature family itself is the reward.',
      '',
      '**Working family weights:**',
      '• Vanilla Wyvern — 35%',
      '• Zombie Wyvern — 15%',
      '• S-Wyvern — 20%',
      '• Runic Wyvern — 20%',
      '• Dragon’s Kingdom — 10%',
      '',
      '## 🐉 Vanilla',
      'Fire • Lightning • Poison • Ice',
      '',
      '## ☠️ Zombie',
      'Zombie Fire • Zombie Lightning • Zombie Poison',
      '',
      '## 💠 S-Wyverns',
      'S-Fire • S-Lightning • S-Poison • S-Ice',
      '',
      '## 🔮 Runic — BASE ELEMENTALS ONLY',
      'Runic Flame • Runic Venom • Runic Spark • Runic Glacial',
      '**Excluded:** Halo, Void, Matrix, Ghost, Crystal Queen, transformed Crystal variants, bosses, event/summoned forms, and future special Runics unless explicitly approved.',
      '',
      '## 🐲 Dragon’s Kingdom',
      'Use early-stage Zaldrir progression only. Working roll: **T1 Juvenile 80% • T2 Young 20%**. Do not directly award T3 Adult, T4 Elder, T5 Ancient, or Alpha forms.',
      '',
      'Eligible outcomes still receive the independent **2% Shiny roll** where compatibility testing allows it. Sentinel should support dedicated **Nexus Skyfall / Mythic Skyfall** jackpot announcements.'
    ].join('\n')
  },
  {
    title: 'PLAYER MARKETPLACE, BLUEPRINTS & UTILITY BEASTS',
    marker: 'Nexus Sentinal • ARK Shop Plan • Exchange and Caches • v1',
    description: [
      '## 🏪 Nexus Exchange / Player Marketplace',
      'Plan a Sentinel-managed player marketplace where survivors can list dinos, eggs, blueprints, resources, structures, and other approved goods for Nexus Points.',
      'Use escrow so the listed asset and NP transfer atomically. Normal `/trade` remains fee-free; marketplace listings may later use a small **2–5% economy-sink fee** if inflation requires it.',
      '',
      '## 📜 Blueprint Caches',
      'Separate random caches for **Weapons, Armor, Saddles, and Tools**. Use bounded quality/stat rolls rather than guaranteed perfect/BIS equipment. Working price band: **2,500–8,000 NP** depending on category and rarity.',
      '',
      '## 🦖 Saddle Caches',
      'Dedicated saddle/blueprint pools for boss dinos, ocean mounts, flyers, and other high-value creature groups. These should remain randomized and respect hard stat/armor caps.',
      '',
      '## 🧬 Nexus Utility Beast Cache',
      '**Working price band: 2,500–3,500 NP**',
      'A dedicated cache for useful workers/support dinos rather than apex combat creatures. Candidate pool includes Argentavis, Ankylosaurus, Doedicurus, Therizino, Castoroides, Basilosaurus, Angler, Dung Beetle, Oviraptor, and other approved utility creatures.',
      'Utility Beast rewards use the normal **200–300 base-level rule**, variant logic where supported, and independent **2% Shiny** roll.',
      '',
      'This keeps the cache identities distinct: **Biome = general dinos • Utility = workers • Sky = wyverns/dragons • Apex = monsters • DLC = content-specific creatures.**'
    ].join('\n')
  },
  {
    title: 'NEXUS APOTHECARY, VAULT & SUPPLY PROGRAMS',
    marker: 'Nexus Sentinal • ARK Shop Plan • Apothecary and Programs • v1',
    description: [
      '## 🧪 Nexus Apothecary',
      'Powerful Crazy’s Potions are planned as **shop-only consumables** rather than craftable progression skips.',
      'Include: Mutation Potion, Love Potion, Gestation Skip, Grow Up, Insta Imprint, Super Crafting, and likely Gender Change/Assignment.',
      '**Engram Unlocker Potion remains disabled and is not sold.**',
      'Automation stations from Cybers/ARKomatic/Dino Depot remain normally craftable because they are already substantial progression/resource grinds.',
      '',
      '## 🎟️ Nexus Vault / Rotating Shop',
      'Sentinel can rotate limited cosmetics, discounted kits, special-cache weekends, seasonal stock, and event items. The goal is to create regular reasons to revisit the shop without making core progression time-limited.',
      '',
      '## 📦 Tribe Supply Crates',
      'High-cost bulk packages for established tribes building or rebuilding large bases. A working **Nexus Colony Crate around 15,000 NP** can focus on construction resources rather than combat power.',
      '',
      '## 💥 Ammo & War Supplies',
      'Bulk ammunition, Medical Brews, soups, and approved PvE/boss-prep consumables provide repeatable NP sinks while still requiring players to earn boss access normally.',
      '',
      '## 🗺️ Map Launch Packs',
      'When new maps are added, Sentinel may temporarily expose map-specific relocation/outpost kits with Dino Balls, beds, building materials, generators, fridges, and basic infrastructure appropriate to that map.',
      '',
      '## 🎁 Community Milestone Promotions',
      'Sentinel may trigger temporary sales or bonuses for cluster milestones, anniversaries, new-map launches, community events, and major boss achievements.'
    ].join('\n')
  }
]);

function payload(section) {
  return {
    embeds: [{
      title: section.title,
      description: section.description,
      footer: { text: section.marker }
    }],
    allowedMentions: { parse: [] }
  };
}

function matches(message, marker, botId) {
  if (!message || String(message.author?.id || '') !== String(botId || '')) return false;
  return (message.embeds || []).some((embed) => String(embed?.footer?.text || '') === marker);
}

async function reconcileArkShopPlanAdditions(client, config, reason = 'manual') {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const channels = await guild.channels.fetch();
  const channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText
    && normalizeName(item.name) === normalizeName(CHANNEL_NAME)) || null;
  if (!channel) return { skipped: 'ark-shop-plan-channel-not-found' };

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  let created = 0;
  let updated = 0;
  let duplicatesRemoved = 0;

  for (const section of ADDITIONS) {
    const found = recent?.values
      ? [...recent.values()].filter((message) => matches(message, section.marker, client.user.id))
      : [];
    found.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
    let message = found[0] || null;
    const desired = payload(section);
    if (!message) {
      message = await channel.send(desired);
      created += 1;
    } else {
      const current = message.embeds?.[0];
      if (String(current?.title || '') !== section.title || String(current?.description || '') !== section.description) {
        await message.edit(desired);
        updated += 1;
      }
    }
    for (const duplicate of found.slice(1)) {
      await duplicate.delete('Nexus Sentinal duplicate ARK shop-plan addition').catch(() => {});
      duplicatesRemoved += 1;
    }
  }

  return { reason, channelId: String(channel.id), sections: ADDITIONS.length, created, updated, duplicatesRemoved };
}

function installArkShopPlanAdditionsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkShopPlanAdditionsLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await reconcileArkShopPlanAdditions(client, config, reason);
          if (result.skipped) return console.warn(`[Nexus Sentinal] ARK shop plan additions skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] ARK shop plan additions (${reason}): channel=${result.channelId} sections=${result.sections} created=${result.created} updated=${result.updated} duplicatesRemoved=${result.duplicatesRemoved}`);
        } catch (error) {
          console.warn(`[Nexus Sentinal] ARK shop plan additions unavailable: ${String(error?.message || error).slice(0, 300)}`);
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
  ADDITIONS,
  reconcileArkShopPlanAdditions,
  installArkShopPlanAdditionsExtension
};
