'use strict';

const { MessageFlags } = require('discord.js');
const { bungieConfig } = require('../config.cjs');
const { panelFooter } = require('../panels.cjs');

function chosenClan(interaction, env) {
  const ids = bungieConfig(env).clanGroupIds;
  const picked = String(interaction.options?.getString?.('clan') || '').trim();
  if (picked) return ids.includes(picked) ? picked : '';
  if (ids.length === 1) return ids[0];
  return '';
}

async function handleClanAutocomplete(interaction, ctx) {
  const focused = interaction.options?.getFocused?.(true);
  if (!focused || focused.name !== 'clan') {
    await interaction.respond([]);
    return true;
  }
  const ids = bungieConfig(ctx.env).clanGroupIds.slice(0, 25);
  const query = String(focused.value || '').trim().toLowerCase();
  const choices = [];
  for (const id of ids) {
    const cached = ctx.bungie?.cache?.get?.(`clan:${id}`);
    let name = String(cached?.summary?.name || '').trim();
    if (!name && typeof ctx.bungie?.clanSummary === 'function') {
      const view = await ctx.bungie.clanSummary(id);
      name = String(view?.summary?.name || '').trim();
    }
    if (!name) name = 'Clan';
    if (query && !name.toLowerCase().includes(query)) continue;
    choices.push({ name: name.slice(0, 100), value: id });
  }
  await interaction.respond(choices);
  return true;
}

async function handleClan(interaction, ctx, reply) {
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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const view = await ctx.bungie.clanSummary(groupId);
  if (!view.ok) {
    await reply.replyText(interaction, ctx.bungie.reasonText(view.reason));
    return true;
  }
  await reply.replyEmbed(interaction, view.embed, panelFooter(`clan:${groupId}`));
  return true;
}

module.exports = { chosenClan, handleClanAutocomplete, handleClan };
