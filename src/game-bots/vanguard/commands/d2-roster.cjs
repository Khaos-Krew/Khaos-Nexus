'use strict';

const { MessageFlags } = require('discord.js');
const { actorIsStaff } = require('../staff.cjs');
const { chosenClan } = require('./d2-clan.cjs');
const { renderRoster } = require('../panels/clan.cjs');

async function handleRoster(interaction, ctx, reply) {
  if (!actorIsStaff(interaction, ctx.env)) {
    await reply.replyText(interaction, 'Roster is restricted to Nexus staff.');
    return true;
  }
  const gate = ctx.bungie.feature('clan');
  if (!gate.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(gate.reason));
    return true;
  }
  const groupId = chosenClan(interaction, ctx.env);
  if (!groupId) {
    await reply.replyText(interaction, 'Pick a clan from the list.');
    return true;
  }
  const page = interaction.options.getInteger('page') || 1;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const view = await ctx.bungie.clanRoster(groupId, page);
  if (!view.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(view.reason));
    return true;
  }
  await reply.replyEmbed(interaction, renderRoster({ summary: view.summary, roster: view.roster, page }), reply.footer);
  return true;
}

module.exports = { handleRoster };
