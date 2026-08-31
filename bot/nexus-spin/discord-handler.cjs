'use strict';

const { runtimeDefaults } = require('./default-config.cjs');
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

function spinModeLabel(result) {
  return result?.spinMode === 'POINTS' ? `POINT SPIN • ${result.spinCost} Nexus Points` : 'FREE DAILY SPIN';
}

async function publicReveal(interaction, result) {
  const reward = result.spin.reward;
  const mention = `<@${interaction.user.id}>`;
  const modeLabel = spinModeLabel(result);
  const frames = [
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n**${modeLabel}**\n\n▰ ▱ ▱`,
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n**${modeLabel}**\n\n▰ ▰ ▱`,
    `🎰 **NEXUS SPIN** 🎰\n${mention} triggered the Nexus reels...\n**${modeLabel}**\n\n▰ ▰ ▰`,
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
      await message.edit(`${title}\n${mention} won **${reward.label}**!\n**${modeLabel}**\n${payoutNote(result.payout)}`);
    }
  } catch {
    // The private interaction receipt below still confirms the immutable reward.
  }
  return message;
}

function makeService(bootstrap, logger) {
  const defaults = runtimeDefaults();
  const runtimeConfig = bootstrap?.config?.nexusSpin;
  const override = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
  const config = {
    ...defaults,
    ...override,
    resourceDelivery: {
      ...defaults.resourceDelivery,
      ...(override.resourceDelivery && typeof override.resourceDelivery === 'object' ? override.resourceDelivery : {}),
    },
    rewards: Array.isArray(override.rewards) && override.rewards.length ? override.rewards : defaults.rewards,
  };
  return new NexusSpinService({
    config,
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

    const mode = interaction.options.getString('mode') || 'free';
    const result = await service.play({ discordId: interaction.user.id, channelId: interaction.channelId, mode });
    await publicReveal(interaction, result);
    const paymentLine = result.spinMode === 'POINTS'
      ? `\nCost: **${result.spinCost} Nexus Points** • Balance after purchase: **${result.payment.afterBalance}**`
      : '\nYour next free spin becomes available 24 hours after this one.';
    await interaction.editReply(`Your spin is locked as **${result.spin.reward.label}**. ${payoutNote(result.payout)}${paymentLine}\nSpin ID: \`${result.spin.spinId}\``);
    return true;
  } catch (error) {
    if (error?.code === 'NEXUS_SPIN_COOLDOWN') {
      await interaction.editReply(`Your **free daily spin** is on cooldown for about **${formatCooldown(error.retryAfterSeconds)}**. You can still explicitly use \`/nexusspin play mode:points\` for an extra spin costing **${error.pointSpinCost || 100} Nexus Points**.`);
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_INSUFFICIENT_POINTS') {
      await interaction.editReply(`You do not have enough Nexus Points for an extra spin. Cost: **${error.pointSpinCost || error.cost || 100}** • Available: **${error.balance ?? 0}**.`);
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_POINT_DEBIT_REVIEW') {
      logger.error?.('[nexus-spin] Point debit requires reconciliation before retry.', {
        spinId: error.spinId,
        reviewRecorded: error.reviewRecorded,
      });
      await interaction.editReply(`⚠️ Sentinel could not confirm whether the **${error.pointSpinCost || 100} Nexus Point** charge completed. **Do not retry this Spin ID yet.** No reward was issued; staff reconciliation is required for \`${error.spinId}\`.`);
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_PAYMENT_REFUNDED') {
      await interaction.editReply(`${error.message}\nSpin ID: \`${error.spinId}\``);
      return true;
    }
    if (error?.code === 'NEXUS_SPIN_PAYMENT_RECONCILIATION_REQUIRED') {
      logger.error?.('[nexus-spin] Paid spin requires manual reconciliation.', { spinId: error.spinId });
      await interaction.editReply(`⚠️ Sentinel could not safely finish this point spin. **Do not retry this Spin ID yet.** Staff reconciliation is required for \`${error.spinId}\`.`);
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
    await interaction.editReply('Nexus Spin could not complete safely. No reward was issued; try again after the service is healthy.');
    return true;
  }
}

module.exports = { handleNexusSpin, formatCooldown, payoutNote, publicReveal, makeService, spinModeLabel };
