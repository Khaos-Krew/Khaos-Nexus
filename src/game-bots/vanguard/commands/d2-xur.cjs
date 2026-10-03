'use strict';

const { MessageFlags } = require('discord.js');

function lookupSaleItems(query, hashes) {
  const names = new Map();
  for (const hash of hashes || []) {
    const meta = typeof query?.itemMeta === 'function'
      ? query.itemMeta('DestinyInventoryItemDefinition', hash)
      : null;
    if (meta?.name) {
      names.set(String(hash), meta);
      continue;
    }
    const name = typeof query?.nameFor === 'function'
      ? query.nameFor('DestinyInventoryItemDefinition', hash)
      : '';
    if (name) names.set(String(hash), { name });
  }
  return names;
}

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

module.exports = { lookupSaleItems, handleXur };
