'use strict';

const { MessageFlags } = require('discord.js');

async function handleXur(interaction, ctx, reply) {
  const gate = ctx.bungie.feature('xur');
  if (!gate.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(gate.reason));
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const view = await ctx.bungie.xurView();
  if (!view.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(view.reason));
    return true;
  }
  await reply.replyEmbed(interaction, view.embed, reply.footer);
  return true;
}

module.exports = { handleXur };
