'use strict';

const defaultConfig = require('../../config/nexus-spin.json');
const { NexusSpinService } = require('./spin-service.cjs');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function formatCooldown(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.ceil((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function rewardIcon(reward) {
  if (reward.type === 'cache_token') return '💠';
  if (reward.type === 'points') return '🔻';
  if (reward.tier === 'ULTRA') return '⚡';
  if (reward.tier === 'RARE') return '💎';
  return '📦';
}

function payoutNote(payout) {
  if (payout?.status === 'REWARDED') return 'Reward delivered.';
  if (payout?.status === 'PENDING_RESOURCE') return 'Reward locked in. Use `/nexusspin claim` while you are online in ARK.';
  if (payout?.status === 'PENDING_POINTS' || payout?.status === 'PENDING_TOKEN') return 'Reward locked in and queued for safe retry.';
  if (payout?.status === 'DELIVERY_UNKNOWN') return 'Reward delivery needs reconciliation; Sentinel will not duplicate it.';
  return 'Reward recorded.';
}

async function publicReveal(interaction, result) {
  const reward = result.spin.reward;
  const mention = `<@${interaction.user.id}>`;
  const frames = [
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n\n▰ ▱ ▱`,
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n\n▰ ▰ ▱`,
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n\n▰ ▰ ▰`,
  ];

  let message = null;
  try {
    message = await interaction.channel?.send(frames[0]);
    if (message) {
      await wait(450);
      await message.edit(frames[1]);
      await wait(450);
      await message.edit(frames[2]);
      await wait(550);
      const jackpot = reward.type === 'cache_token';
      const title = jackpot ? '🔥💠 **NEXUS JACKPOT!** 💠🔥' : `${rewardIcon(reward)} **${reward.tier || 'REWARD'} DROP**`;
      await message.edit(`${title}\n${mention} won **${reward.label}**!\n${payoutNote(result.payout)}`);
    }
  } catch {
    // The interaction receipt below still confirms the immutable reward.
  }
  return message;
}

function makeService(bootstrap, logger) {
  const runtimeConfig = bootstrap?.config?.nexusSpin;
  return new NexusSpinService({
    config: runtimeConfig && typeof runtimeConfig === 'object' ? { ...defaultConfig, ...runtimeConfig } : defaultConfig,
    servers: bootstrap?.config?.servers || [],
    logger,
  });
}

async function handleNexusSpin(interaction, { bootstrap, logger = console } = {}) {
  const service = makeService(bootstrap, logger);
  const subcommand = interaction.options.getSubcommand(false) || 'play';
  await interaction.deferReply({ ephemeral: true });

  try {
    if (subcommand === 'claim') {
      const results = await service.claimPending(interaction.user.id);
      if (!results.length) {
        await interaction.editReply('You have no queued Nexus Spin rewards to claim.');
        return true;
      }
      const delivered = results.filter((item) => item.status === 'REWARDED').length;
      const pending = results.filter((item) => item.status !== 'REWARDED' && item.status !== 'SKIPPED').length;
      await interaction.editReply(`Nexus Spin claim checked **${results.length}** reward(s): **${delivered} delivered**, **${pending} still queued**.`);
      return true;
    }

    const result = await service.play({ discordId: interaction.user.id, channelId: interaction.channelId });
    await publicReveal(interaction, result);
    await interaction.editReply(`Your spin is locked as **${result.spin.reward.label}**. ${payoutNote(result.payout)}\nSpin ID: \`${result.spin.spinId}\``);
    return true;
  } catch (error) {
    if (error?.code === 'NEXUS_SPIN_COOLDOWN') {
      await interaction.editReply(`Your Nexus Spin is on cooldown. Try again in about **${formatCooldown(error.retryAfterSeconds)}**.`);
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_NOT_LINKED') {
      await interaction.editReply('🔗 You need a **verified Discord ↔ ARK account link** before you can play Nexus Spin.');
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_WRONG_CHANNEL' || error?.code === 'NEXUS_SPIN_DISABLED') {
      await interaction.editReply(error.message);
      return true;
    }
    logger.error?.('[nexus-spin] Command failed.', { error: error?.message, code: error?.code });
    await interaction.editReply('Nexus Spin could not complete safely. No unrecorded reward was issued; try again after the service is healthy.');
    return true;
  }
}

module.exports = { handleNexusSpin, formatCooldown, payoutNote, publicReveal };
