'use strict';

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const ACTION_INPUTS = Object.freeze({
  'warframe:market': Object.freeze({
    title: 'Warframe Market', label: 'Item name', placeholder: 'Arcane Energize', maxLength: 120, style: TextInputStyle.Short
  }),
  'warframe:builds': Object.freeze({
    title: 'Warframe Build Helper', label: 'Frame, weapon, or mod', placeholder: 'Gyre', maxLength: 120, style: TextInputStyle.Short
  }),
  'division2:gear': Object.freeze({
    title: 'Division 2 Gear Search', label: 'Gear, weapon, brand, set, or talent', placeholder: 'Eclipse Protocol', maxLength: 160, style: TextInputStyle.Short
  }),
  'division2:builds': Object.freeze({
    title: 'Division 2 Build Research', label: 'Build goal or keywords', placeholder: 'crit SMG', maxLength: 160, style: TextInputStyle.Short
  }),
  'division2:farming': Object.freeze({
    title: 'Division 2 Farming', label: 'Item or set', placeholder: 'Ceska', maxLength: 160, style: TextInputStyle.Short
  }),
  'ark:broadcast': Object.freeze({
    title: 'ARK Broadcast', label: 'Message', placeholder: 'Restart in 10 minutes', maxLength: 500, style: TextInputStyle.Paragraph
  }),
  'palworld:broadcast': Object.freeze({
    title: 'Palworld Broadcast', label: 'Message', placeholder: 'Server restart in 10 minutes', maxLength: 500, style: TextInputStyle.Paragraph
  }),
  'minecraft:broadcast': Object.freeze({
    title: 'Minecraft Broadcast', label: 'Message', placeholder: 'Server event starting soon', maxLength: 500, style: TextInputStyle.Paragraph
  }),
  'rust:broadcast': Object.freeze({
    title: 'Rust Broadcast', label: 'Message', placeholder: 'Cargo event starting', maxLength: 500, style: TextInputStyle.Paragraph
  })
});

function actionInputKey(moduleId, actionId) {
  return `${String(moduleId || '').toLowerCase()}:${String(actionId || '').toLowerCase()}`;
}

function inputDefinition(moduleId, actionId) {
  return ACTION_INPUTS[actionInputKey(moduleId, actionId)] || null;
}

function actionInputModal(moduleId, actionId) {
  const definition = inputDefinition(moduleId, actionId);
  if (!definition) return null;
  const input = new TextInputBuilder()
    .setCustomId('input')
    .setLabel(definition.label.slice(0, 45))
    .setStyle(definition.style)
    .setRequired(true)
    .setMaxLength(definition.maxLength)
    .setPlaceholder(definition.placeholder.slice(0, 100));
  return new ModalBuilder()
    .setCustomId(`nexusinput:${String(moduleId).toLowerCase()}:${String(actionId).toLowerCase()}`)
    .setTitle(definition.title.slice(0, 45))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function parseActionInputId(customId) {
  const match = /^nexusinput:([a-z0-9-]+):([a-z0-9-]+)$/.exec(String(customId || ''));
  return match ? { moduleId: match[1], actionId: match[2] } : null;
}

module.exports = { ACTION_INPUTS, actionInputKey, inputDefinition, actionInputModal, parseActionInputId };
