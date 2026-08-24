'use strict';

const crypto = require('node:crypto');
const {
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { TRANQ_METHODS, formatDuration } = require('../backend/services/ark-taming-engine.cjs');

const SESSION_MS = 10 * 60 * 1000;
const PAGE_SIZE = 25;
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

function chunk(items, size = PAGE_SIZE) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function cleanDescription(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function selectionPrompt(session) {
  const options = session.groups.map((group, index) => ({
    label: `${group[0].name} — ${group[group.length - 1].name}`.slice(0, 100),
    value: String(index),
    description: `${group.length} tameable creatures`.slice(0, 100)
  }));
  return {
    content: '**🦖 ARK Tame Calculator**\nChoose the section containing the creature you want to tame. The calculator will then ask for your server rates, level, weapon damage, and KO method.',
    components: [{
      type: 1,
      components: [{ type: 3, custom_id: `arktame:group:${session.id}`, placeholder: 'Choose creature section', min_values: 1, max_values: 1, options }]
    }]
  };
}

function creaturePrompt(session, groupIndex) {
  const group = session.groups[groupIndex];
  if (!group?.length) throw new Error('That creature section is no longer available. Run `/ark tame` again.');
  return {
    content: '**🦖 ARK Tame Calculator**\nChoose the creature. The next screen contains the actual tame settings.',
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: `arktame:creature:${session.id}`,
        placeholder: 'Choose the dino / creature',
        min_values: 1,
        max_values: 1,
        options: group.map((species) => ({
          label: species.name.slice(0, 100),
          value: species.slug.slice(0, 100),
          description: cleanDescription(species.violent ? 'Knockout tame' : species.nonViolent ? 'Passive / non-violent tame' : 'Special tame')
        }))
      }]
    }, {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `arktame:back:${session.id}`, label: 'Back to creature sections' }]
    }]
  };
}

function textField(customId, label, placeholder, { required = true, value = '', description = '' } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setPlaceholder(placeholder)
    .setMaxLength(12);
  if (value) input.setValue(String(value));
  const wrapper = new LabelBuilder().setLabel(label).setTextInputComponent(input);
  if (description) wrapper.setDescription(description);
  return wrapper;
}

function tranqField() {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ark-tranq-method')
    .setPlaceholder('Choose the weapon / tranq ammo')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(Object.entries(TRANQ_METHODS).map(([value, method]) => ({ label: method.label.slice(0, 100), value })));
  return new LabelBuilder()
    .setLabel('Tranq method')
    .setDescription('KO ammo is calculated from this method and your weapon damage %.')
    .setStringSelectMenuComponent(select);
}

function calculationModal(session) {
  const species = session.species;
  const modal = new ModalBuilder().setCustomId(`arktame:calc:${session.id}`).setTitle(`${species.name} tame calculator`.slice(0, 45));
  modal.addLabelComponents(
    textField('ark-wild-level', 'Wild dino level', '150', { value: '150' }),
    textField('ark-taming-rate', 'Taming Speed multiplier', 'Example: 6', { value: '1', description: 'Your server Taming Speed setting.' }),
    textField('ark-food-drain', 'Dino food drain multiplier', 'Example: 5', { value: '1', description: 'Your server Dino Character Food Drain setting.' }),
    textField('ark-weapon-damage', 'Weapon damage % (optional)', 'Example: 298', { required: false, value: '100', description: 'Leave 100 for a primitive 100% weapon.' })
  );
  if (species.violent) modal.addLabelComponents(tranqField());
  return modal;
}

function resultEmbed(data, user) {
  const embed = new EmbedBuilder()
    .setTitle(`🦖 ARK Tame Plan • ${data.creature} Lv ${data.wildLevel}`)
    .setDescription(`**Taming Speed:** ${data.tamingRate}×  •  **Food Drain:** ${data.foodDrainRate}×`)
    .setTimestamp();

  if (data.knockout?.required) {
    embed.addFields({
      name: '🎯 Knockout',
      value: `**${data.knockout.amount} ${data.knockout.ammo}**\n${data.knockout.method}\nWeapon damage: **${data.knockout.weaponDamagePercent}%** • Torpor target: **${Number(data.knockout.totalTorpor).toLocaleString()}**\n_${data.knockout.note}_`.slice(0, 1024)
    });
  } else {
    embed.addFields({ name: '🟢 Taming method', value: data.knockout?.reason || 'This creature does not use a standard knockout.' });
  }

  const foods = (data.foods || []).slice(0, 5).map((food, index) => {
    const warning = food.unconfirmed ? ' ⚠️' : '';
    return `${MEDALS[index]} **${food.food}** — **${food.amount}**${warning}\n└ Approx. **${formatDuration(food.durationSeconds)}**`;
  }).join('\n');
  embed.addFields({ name: '🍖 Top taming foods', value: foods || 'No food calculation available.' });
  embed.setFooter({ text: `Nexus Sentinal • ARK Smart Breeding data (MIT)${user?.username ? ` • Requested by ${user.username}` : ''}`.slice(0, 2048) });
  return embed;
}

function parseNumberField(interaction, id, fallback = '') {
  const value = interaction.fields.getTextInputValue(id).trim();
  return value || fallback;
}

function findTameChannel(interaction, state) {
  const setup = state.getModuleSetup('ark');
  const saved = setup?.textChannels?.find((channel) => channel.name === 'ark-tame-info');
  if (saved?.id) {
    const channel = interaction.guild?.channels?.cache?.get(String(saved.id));
    if (channel?.isTextBased?.()) return channel;
  }
  return interaction.guild?.channels?.cache?.find?.((channel) => channel?.isTextBased?.() && channel.name === 'ark-tame-info') || null;
}

function createArkTameUi({ backend, state }) {
  const sessions = new Map();

  function getSession(interaction, id) {
    const session = sessions.get(id);
    if (!session || session.expiresAt < Date.now()) {
      sessions.delete(id);
      throw new Error('That tame calculator session expired. Run `/ark tame` again.');
    }
    if (session.userId !== String(interaction.user.id)) throw new Error('Only the player who started this tame calculator can use it.');
    session.expiresAt = Date.now() + SESSION_MS;
    return session;
  }

  async function start(interaction) {
    const catalog = await backend.arkTamingSpecies();
    if (!catalog.ok || !Array.isArray(catalog.species) || !catalog.species.length) {
      throw new Error(catalog.message || 'The ARK tame creature catalog is unavailable right now.');
    }
    const id = crypto.randomBytes(8).toString('hex');
    const species = catalog.species.slice().sort((a, b) => a.name.localeCompare(b.name));
    const session = { id, userId: String(interaction.user.id), speciesList: species, groups: chunk(species), species: null, expiresAt: Date.now() + SESSION_MS };
    sessions.set(id, session);
    return interaction.reply({ ...selectionPrompt(session), flags: MessageFlags.Ephemeral });
  }

  async function handleComponent(interaction) {
    let match = /^arktame:group:([a-f0-9]{16})$/.exec(interaction.customId || '');
    if (interaction.isStringSelectMenu() && match) {
      const session = getSession(interaction, match[1]);
      const index = Number(interaction.values[0]);
      return interaction.update(creaturePrompt(session, index));
    }

    match = /^arktame:back:([a-f0-9]{16})$/.exec(interaction.customId || '');
    if (interaction.isButton() && match) {
      const session = getSession(interaction, match[1]);
      return interaction.update(selectionPrompt(session));
    }

    match = /^arktame:creature:([a-f0-9]{16})$/.exec(interaction.customId || '');
    if (interaction.isStringSelectMenu() && match) {
      const session = getSession(interaction, match[1]);
      const slug = interaction.values[0];
      const species = session.speciesList.find((item) => item.slug === slug);
      if (!species) throw new Error('That creature is no longer available. Run `/ark tame` again.');
      session.species = species;
      return interaction.showModal(calculationModal(session));
    }

    match = /^arktame:calc:([a-f0-9]{16})$/.exec(interaction.customId || '');
    if (interaction.isModalSubmit() && match) {
      const session = getSession(interaction, match[1]);
      if (!session.species) throw new Error('Choose a creature before calculating the tame.');
      const tranq = session.species.violent ? interaction.fields.getStringSelectValues('ark-tranq-method')?.[0] : 'crossbow-arrow';
      const payload = {
        creature: session.species.name,
        wildLevel: parseNumberField(interaction, 'ark-wild-level'),
        tamingRate: parseNumberField(interaction, 'ark-taming-rate'),
        foodDrainRate: parseNumberField(interaction, 'ark-food-drain'),
        weaponDamagePercent: parseNumberField(interaction, 'ark-weapon-damage', '100'),
        tranqMethod: tranq
      };
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await backend.invoke('ark', 'taming', payload, { role: 'viewer', actorId: String(interaction.user.id), confirmed: false });
      if (!result.ok) return interaction.editReply({ content: `⚠️ ${result.message || 'The tame calculation failed.'}` });
      const data = result.data || result;
      const embed = resultEmbed(data, interaction.user);
      const channel = findTameChannel(interaction, state);
      sessions.delete(session.id);
      if (!channel) return interaction.editReply({ content: '⚠️ `#ark-tame-info` could not be found. Run `/nexus repair module:ARK` and try again.', embeds: [embed] });
      const posted = await channel.send({ embeds: [embed] });
      return interaction.editReply({ content: `✅ Tame plan posted in <#${channel.id}>: ${posted.url}` });
    }

    return false;
  }

  function cleanup() {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt < now) sessions.delete(id);
  }

  return { start, handleComponent, cleanup, sessions };
}

module.exports = {
  PAGE_SIZE,
  SESSION_MS,
  calculationModal,
  chunk,
  createArkTameUi,
  creaturePrompt,
  findTameChannel,
  resultEmbed,
  selectionPrompt
};
