'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { runtimeDefaults } = require('./default-config.cjs');
const { NexusSpinService } = require('./spin-service.cjs');

const NEXUS_SPIN_BUTTONS = Object.freeze({
  FREE: 'nexusspin:play:free',
  POINTS_PROMPT: 'nexusspin:points:prompt',
  POINTS_CONFIRM: 'nexusspin:points:confirm',
  POINTS_CANCEL: 'nexusspin:points:cancel',
  CLAIM: 'nexusspin:claim',
});

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
  if (payout?.status === 'PENDING_RESOURCE') return 'Reward locked in. Press **Claim Rewards** while you are online in ARK.';
  if (payout?.status === 'PENDING_POINTS' || payout?.status === 'PENDING_TOKEN') return 'Reward locked in and queued for safe retry.';
  if (payout?.status === 'DELIVERY_UNKNOWN') return 'Reward delivery needs reconciliation; Sentinel will not duplicate it.';
  return 'Reward recorded.';
}

function spinModeLabel(result) {
  return result?.spinMode === 'POINTS' ? `POINT SPIN • ${result.spinCost} Nexus Points` : 'FREE DAILY SPIN';
}

function resolveConfig(bootstrap) {
  const defaults = runtimeDefaults();
  const runtimeConfig = bootstrap?.config?.nexusSpin;
  const override = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
  return {
    ...defaults,
    ...override,
    resourceDelivery: {
      ...defaults.resourceDelivery,
      ...(override.resourceDelivery && typeof override.resourceDelivery === 'object' ? override.resourceDelivery : {}),
    },
    rewards: Array.isArray(override.rewards) && override.rewards.length ? override.rewards : defaults.rewards,
  };
}

function buildSpinPanel(bootstrap) {
  const config = resolveConfig(bootstrap);
  const cost = Math.max(1, Number(config.pointSpinCost) || 100);
  const embed = new EmbedBuilder()
    .setColor(0x8b0000)
    .setTitle('🎰 Nexus Spin')
    .setDescription('Spin for **Nexus Points**, **ARK resources**, and the **Dino Cache Token jackpot**.\n\n🔗 A verified **Discord ↔ ARK account link** is required to play.')
    .addFields(
      { name: '🎁 Daily Free Spin', value: 'One free spin every **24 hours**.', inline: true },
      { name: '🔻 Extra Spin', value: `Spend **${cost} Nexus Points** after confirmation.`, inline: true },
      { name: '💠 Jackpot', value: '**Dino Cache Token** • 0.25% chance', inline: true },
    )
    .setFooter({ text: 'Point spins never consume or reset your free-spin cooldown.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(NEXUS_SPIN_BUTTONS.FREE)
      .setLabel('Daily Free Spin')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(NEXUS_SPIN_BUTTONS.POINTS_PROMPT)
      .setLabel(`Extra Spin • ${cost} NP`)
      .setEmoji('🔻')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(NEXUS_SPIN_BUTTONS.CLAIM)
      .setLabel('Claim Rewards')
      .setEmoji('📦')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

function buildPointConfirmation(bootstrap) {
  const config = resolveConfig(bootstrap);
  const cost = Math.max(1, Number(config.pointSpinCost) || 100);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(NEXUS_SPIN_BUTTONS.POINTS_CONFIRM)
      .setLabel(`Spend ${cost} NP & Spin`)
      .setEmoji('🎰')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(NEXUS_SPIN_BUTTONS.POINTS_CANCEL)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: `This extra spin costs **${cost} Nexus Points**. Your free 24-hour spin cooldown will not be changed.`,
    components: [row],
    ephemeral: true,
  };
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
  const config = resolveConfig(bootstrap);
  return new NexusSpinService({
    config,
    servers: bootstrap?.config?.servers || [],
    logger,
  });
}

function isNexusSpinButton(customId) {
  return Object.values(NEXUS_SPIN_BUTTONS).includes(String(customId || ''));
}

async function editSpinError(interaction, error, logger = console, respond = (content) => interaction.editReply(content)) {
  if (error?.code === 'NEXUS_SPIN_COOLDOWN') {
    await respond(`Your **free daily spin** is on cooldown for about **${formatCooldown(error.retryAfterSeconds)}**. You can still use the red **Extra Spin** button for **${error.pointSpinCost || 100} Nexus Points**.`);
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_INSUFFICIENT_POINTS') {
    await respond(`You do not have enough Nexus Points for an extra spin. Cost: **${error.pointSpinCost || error.cost || 100}** • Available: **${error.balance ?? 0}**.`);
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_POINT_DEBIT_REVIEW') {
    logger.error?.('[nexus-spin] Point debit requires reconciliation before retry.', {
      spinId: error.spinId,
      reviewRecorded: error.reviewRecorded,
    });
    await respond(`⚠️ Sentinel could not confirm whether the **${error.pointSpinCost || 100} Nexus Point** charge completed. **Do not retry this Spin ID yet.** No reward was issued; staff reconciliation is required for \`${error.spinId}\`.`);
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_PAYMENT_REFUNDED') {
    await respond(`${error.message}\nSpin ID: \`${error.spinId}\``);
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_PAYMENT_RECONCILIATION_REQUIRED') {
    logger.error?.('[nexus-spin] Paid spin requires manual reconciliation.', { spinId: error.spinId });
    await respond(`⚠️ Sentinel could not safely finish this point spin. **Do not retry this Spin ID yet.** Staff reconciliation is required for \`${error.spinId}\`.`);
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_NOT_LINKED') {
    await respond('🔗 You need a **verified Discord ↔ ARK account link** before you can play Nexus Spin.');
    return true;
  }
  if (error?.code === 'NEXUS_SPIN_WRONG_CHANNEL' || error?.code === 'NEXUS_SPIN_DISABLED') {
    await respond(error.message);
    return true;
  }
  return false;
}

async function playFromButton(interaction, mode, { bootstrap, logger = console, acknowledged = false } = {}) {
  const service = makeService(bootstrap, logger);
  if (!acknowledged) await interaction.deferReply({ ephemeral: true });
  const respond = acknowledged
    ? (content) => interaction.followUp({ content, ephemeral: true })
    : (content) => interaction.editReply(content);

  try {
    const result = await service.play({ discordId: interaction.user.id, channelId: interaction.channelId, mode });
    await publicReveal(interaction, result);
    const paymentLine = result.spinMode === 'POINTS'
      ? `\nCost: **${result.spinCost} Nexus Points** • Balance after purchase: **${result.payment.afterBalance}**`
      : '\nYour next free spin becomes available 24 hours after this one.';
    await respond(`Your spin is locked as **${result.spin.reward.label}**. ${payoutNote(result.payout)}${paymentLine}\nSpin ID: \`${result.spin.spinId}\``);
    return true;
  } catch (error) {
    if (await editSpinError(interaction, error, logger, respond)) return true;
    logger.error?.('[nexus-spin] Button spin failed.', { error: error?.message, code: error?.code });
    await respond('Nexus Spin could not complete safely. No reward was issued; try again after the service is healthy.');
    return true;
  }
}

async function claimFromButton(interaction, { bootstrap, logger = console } = {}) {
  const service = makeService(bootstrap, logger);
  await interaction.deferReply({ ephemeral: true });
  try {
    const results = await service.claimPending(interaction.user.id);
    if (!results.length) {
      await interaction.editReply('You have no queued Nexus Spin rewards to claim.');
      return true;
    }
    const delivered = results.filter((item) => item.status === 'REWARDED').length;
    const pending = results.filter((item) => item.status !== 'REWARDED' && item.status !== 'SKIPPED').length;
    await interaction.editReply(`Nexus Spin claim checked **${results.length}** reward(s): **${delivered} delivered**, **${pending} still queued**.`);
    return true;
  } catch (error) {
    if (await editSpinError(interaction, error, logger)) return true;
    logger.error?.('[nexus-spin] Claim button failed.', { error: error?.message, code: error?.code });
    await interaction.editReply('Sentinel could not safely check your queued Nexus Spin rewards right now.');
    return true;
  }
}

async function handleNexusSpinCommand(interaction, { bootstrap } = {}) {
  await interaction.reply(buildSpinPanel(bootstrap));
  return true;
}

async function handleNexusSpinButton(interaction, context = {}) {
  switch (interaction.customId) {
    case NEXUS_SPIN_BUTTONS.FREE:
      return playFromButton(interaction, 'free', context);
    case NEXUS_SPIN_BUTTONS.POINTS_PROMPT:
      await interaction.reply(buildPointConfirmation(context.bootstrap));
      return true;
    case NEXUS_SPIN_BUTTONS.POINTS_CONFIRM:
      await interaction.update({ content: '🎰 Paid spin confirmed. Processing securely...', components: [] });
      return playFromButton(interaction, 'points', { ...context, acknowledged: true });
    case NEXUS_SPIN_BUTTONS.POINTS_CANCEL:
      await interaction.update({ content: 'Point spin cancelled. No Nexus Points were charged.', components: [] });
      return true;
    case NEXUS_SPIN_BUTTONS.CLAIM:
      return claimFromButton(interaction, context);
    default:
      return false;
  }
}

module.exports = {
  NEXUS_SPIN_BUTTONS,
  handleNexusSpinCommand,
  handleNexusSpinButton,
  isNexusSpinButton,
  buildSpinPanel,
  buildPointConfirmation,
  formatCooldown,
  payoutNote,
  publicReveal,
  makeService,
  resolveConfig,
  spinModeLabel,
};
