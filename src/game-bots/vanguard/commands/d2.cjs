'use strict';

const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { bungieConfig } = require('../config.cjs');
const { panelFooter, postFooter } = require('../panels.cjs');
const { handleClan, handleClanAutocomplete } = require('./d2-clan.cjs');
const { handlePlayer } = require('./d2-player.cjs');
const { handleReset } = require('./d2-reset.cjs');
const { handleXur } = require('./d2-xur.cjs');

function d2CommandBuilder(env = process.env) {
  const builder = new SlashCommandBuilder()
    .setName('d2')
    .setDescription('Destiny 2 lookups. Read-only.')
    .addSubcommand((sub) => sub
      .setName('player')
      .setDescription('Look up a public Bungie name.')
      .addStringOption((option) => option
        .setName('bungie_name')
        .setDescription('Bungie name, like Name#1234')
        .setRequired(true)
        .setMaxLength(40)))
    .addSubcommand((sub) => sub
      .setName('reset')
      .setDescription('Show this week\'s public milestones.'));
  if (bungieConfig(env).xurPanel) {
    builder.addSubcommand((sub) => sub
      .setName('xur')
      .setDescription('Show Xûr\'s public stock.'));
  }
  builder
    .addSubcommand((sub) => sub
      .setName('clan')
      .setDescription('Show a clan summary.')
      .addStringOption((option) => option
        .setName('clan')
        .setDescription('Clan')
        .setAutocomplete(true)));
  return builder;
}

function ephemeral(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function replyText(interaction, text) {
  const payload = ephemeral(text);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: payload.content, allowedMentions: payload.allowedMentions });
    return;
  }
  await interaction.reply(payload);
}

async function replyEmbed(interaction, embed, footer) {
  const body = {
    embeds: [{
      title: embed.title,
      description: String(embed.description || '').slice(0, 4000),
      footer: { text: footer }
    }],
    allowedMentions: { parse: [] }
  };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(body);
    return;
  }
  await interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
}

async function handleD2(interaction, ctx) {
  const sub = interaction.options?.getSubcommand?.(false) || '';
  if (sub === 'player') return handlePlayer(interaction, ctx, { replyText, replyEmbed, footer: postFooter() });
  if (sub === 'reset') return handleReset(interaction, ctx, { replyText, replyEmbed, footer: panelFooter('weekly-reset') });
  if (sub === 'xur') return handleXur(interaction, ctx, { replyText, replyEmbed, footer: panelFooter('xur') });
  if (sub === 'clan') return handleClan(interaction, ctx, { replyText, replyEmbed, footer: panelFooter('clan') });
  await replyText(interaction, 'That Destiny command is not available.');
  return true;
}

async function handleD2Autocomplete(interaction, ctx) {
  return handleClanAutocomplete(interaction, ctx);
}

module.exports = {
  d2CommandBuilder,
  replyText,
  replyEmbed,
  handleD2,
  handleD2Autocomplete
};
