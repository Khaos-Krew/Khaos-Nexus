'use strict';

const { MessageFlags } = require('discord.js');
const { actorIsStaff } = require('../staff.cjs');
const { refreshLfgBoard } = require('../lfg/lfg-commands.cjs');

async function handlePanelsRefresh(interaction, ctx) {
  if (!actorIsStaff(interaction, ctx.env)) {
    await interaction.reply({
      content: 'Panel refresh is restricted to Nexus staff.',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }
  const panel = interaction.options.getString('panel', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (panel === 'lfg-board' || panel === 'all') {
    await refreshLfgBoard(ctx, { guildId: interaction.guildId, force: true });
  }
  if (panel !== 'lfg-board') {
    const which = panel === 'all' ? 'all' : panel;
    await ctx.bungie.refreshPanels(interaction.guildId, { which, force: true });
  }
  await interaction.editReply({ content: 'Panel refresh finished.', allowedMentions: { parse: [] } });
  return true;
}

module.exports = { handlePanelsRefresh };
