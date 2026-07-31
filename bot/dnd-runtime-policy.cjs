'use strict';

const base = require('./dnd-runtime.cjs');

function currentAppId(runtime) {
  return String(runtime.getBootstrap()?.config?.discordApp?.id || 'nexus-bot');
}

function currentGuildId(interaction) {
  return String(interaction.guildId || interaction.guild?.id || '');
}

function currentChannelId(interaction) {
  return String(interaction.channelId || interaction.channel?.id || '');
}

function currentParentId(interaction) {
  return String(interaction.channel?.parentId || interaction.channel?.parent?.id || '');
}

function selectableCampaignIds({ bindings = [], appId, guildId, channelId, parentChannelId = '' }) {
  const exact = bindings.filter((binding) =>
    binding.active !== false &&
    binding.appId === appId &&
    binding.guildId === guildId &&
    binding.resourceId === channelId
  );
  if (exact.length) return new Set(exact.map((binding) => binding.campaignId));

  if (!parentChannelId) return new Set();
  const inherited = bindings.filter((binding) =>
    binding.active !== false &&
    binding.appId === appId &&
    binding.guildId === guildId &&
    binding.resourceType === 'channel' &&
    binding.resourceId === parentChannelId
  );
  return new Set(inherited.map((binding) => binding.campaignId));
}

function isCampaignUse(interaction) {
  return Boolean(
    interaction?.isChatInputCommand?.() &&
    interaction.commandName === 'campaign' &&
    interaction.options?.getSubcommand?.(false) === 'use'
  );
}

function validateCampaignUse(interaction, runtime) {
  if (!isCampaignUse(interaction)) return;
  const bootstrap = runtime.getBootstrap();
  const state = bootstrap?.config?.dnd;
  const selectedId = interaction.options.getString('campaign', true);
  const selectable = selectableCampaignIds({
    bindings: state?.bindings || [],
    appId: currentAppId(runtime),
    guildId: currentGuildId(interaction),
    channelId: currentChannelId(interaction),
    parentChannelId: currentParentId(interaction)
  });
  if (!selectable.has(selectedId)) {
    const error = new Error('That campaign is not bound to this channel, thread, forum post, or its valid parent. No active campaign context was changed.');
    error.code = 'CAMPAIGN_NOT_BOUND_TO_RESOURCE';
    throw error;
  }
}

async function handleDndInteraction(interaction, runtime) {
  try {
    validateCampaignUse(interaction, runtime);
  } catch (error) {
    runtime.log?.('warn', `D&D campaign selection rejected: ${error.code || error.message}`);
    const response = { content: error.message, ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response).catch(() => interaction.followUp(response).catch(() => {}));
    } else {
      await interaction.reply(response).catch(() => {});
    }
    return true;
  }
  return base.handleDndInteraction(interaction, runtime);
}

module.exports = {
  ...base,
  handleDndInteraction,
  selectableCampaignIds,
  validateCampaignUse,
  isCampaignUse
};
