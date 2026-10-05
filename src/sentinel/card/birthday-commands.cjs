'use strict';

const { MessageFlags } = require('discord.js');
const { COPY, mentionSafe } = require('./birthday-copy.cjs');
const { suggestTimezones } = require('./birthday-calendar.cjs');
const { revealButton } = require('./birthday-scheduler.cjs');
const {
  setBirthday,
  clearBirthday,
  setBirthdayPrivacy,
  describeBirthdayGift,
  claimBirthdayGift
} = require('./birthday-service.cjs');
const { birthdayEnabled } = require('./birthday-config.cjs');

function commandsEnabled(deps = {}) {
  if (typeof deps.birthdayEnabled === 'boolean') return deps.birthdayEnabled;
  if (deps.enabled === true) return true;
  if (deps.enabled === false) return false;
  return birthdayEnabled(deps.env || process.env);
}

function addBirthdayCommands(command) {
  return command.addSubcommandGroup((group) => group
    .setName('birthday')
    .setDescription('Save a private birthday and open a present')
    .addSubcommand((sub) => sub
      .setName('set')
      .setDescription('Save your birthday. The date stays private.')
      .addIntegerOption((option) => option.setName('month').setDescription('Month').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((option) => option.setName('day').setDescription('Day').setRequired(true).setMinValue(1).setMaxValue(31))
      .addStringOption((option) => option.setName('timezone').setDescription('Your timezone').setRequired(true).setAutocomplete(true).setMaxLength(64)))
    .addSubcommand((sub) => sub
      .setName('clear')
      .setDescription('Clear your saved birthday'))
    .addSubcommand((sub) => sub
      .setName('privacy')
      .setDescription('Choose whether a celebration can be posted')
      .addStringOption((option) => option
        .setName('visibility')
        .setDescription('Hidden keeps the celebration off public channels')
        .setRequired(false)
        .addChoices(
          { name: 'Hidden', value: 'hidden' },
          { name: 'Shown', value: 'shown' }
        ))
      .addBooleanOption((option) => option
        .setName('announce')
        .setDescription('Post a celebration if a private message cannot be delivered')
        .setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('gift')
      .setDescription('Open your private birthday present')));
}

function suggestBirthdayTimezone(value) {
  return suggestTimezones(value);
}

function presentPayload(result) {
  const payload = mentionSafe({ content: result.text || COPY.none });
  if (result.reveal) payload.components = [revealButton()];
  return payload;
}

async function replyBirthday(interaction, result) {
  const payload = presentPayload(result);
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  payload.flags = MessageFlags.Ephemeral;
  return interaction.reply(payload);
}

async function handleBirthdayCommand(interaction, deps = {}) {
  if (!commandsEnabled(deps)) return replyBirthday(interaction, { text: COPY.off, reveal: false });
  const sub = interaction.options.getSubcommand(true);
  const userId = interaction.user?.id;
  if (sub === 'set') {
    const result = await setBirthday(serviceDeps(deps, interaction), userId, {
      month: interaction.options.getInteger('month'),
      day: interaction.options.getInteger('day'),
      timezone: interaction.options.getString('timezone')
    });
    return replyBirthday(interaction, result);
  }
  if (sub === 'clear') return replyBirthday(interaction, await clearBirthday(serviceDeps(deps, interaction), userId));
  if (sub === 'privacy') {
    const visibility = interaction.options.getString('visibility');
    const announce = interaction.options.getBoolean('announce');
    const result = await setBirthdayPrivacy(serviceDeps(deps, interaction), userId, {
      visibility: visibility || undefined,
      announce: typeof announce === 'boolean' ? announce : undefined
    });
    return replyBirthday(interaction, result);
  }
  if (sub === 'gift') return replyBirthday(interaction, await describeBirthdayGift(serviceDeps(deps, interaction), userId));
  return replyBirthday(interaction, { text: COPY.off, reveal: false });
}

async function handleBirthdayReveal(interaction, deps = {}) {
  if (!commandsEnabled(deps)) return replyBirthday(interaction, { text: COPY.off, reveal: false });
  const result = await claimBirthdayGift(serviceDeps(deps, interaction), interaction.user?.id);
  return replyBirthday(interaction, { ...result, reveal: false });
}

function serviceDeps(deps, interaction) {
  const member = interaction?.member
    ? { ...interaction.member, user: interaction.user, id: interaction.user?.id }
    : null;
  return {
    ...deps,
    enabled: true,
    loadMember: deps.loadMember || (async () => member)
  };
}

module.exports = {
  addBirthdayCommands,
  suggestBirthdayTimezone,
  handleBirthdayCommand,
  handleBirthdayReveal,
  presentPayload
};
