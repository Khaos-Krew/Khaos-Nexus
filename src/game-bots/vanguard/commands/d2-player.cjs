'use strict';

const { MessageFlags } = require('discord.js');

async function handlePlayer(interaction, ctx, reply) {
  const gate = ctx.bungie.feature('lookup');
  if (!gate.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(gate.reason));
    return true;
  }
  const raw = interaction.options.getString('bungie_name', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await ctx.bungie.player(raw, interaction.user?.id);
  if (!result.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(result.reason));
    return true;
  }
  await reply.replyEmbed(interaction, { title: 'Vanguard • Player', description: result.text }, reply.footer);
  return true;
}

module.exports = { handlePlayer };
