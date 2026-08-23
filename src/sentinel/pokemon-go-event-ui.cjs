'use strict';

const { renderTemporal } = require('./discord-time.cjs');

function clean(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function eventField(event, index) {
  const lines = [];
  if (event.eventType) lines.push(`**Type:** ${clean(event.eventType, 80)}`);
  if (event.scheduleText) lines.push(`**When:** ${clean(event.scheduleText, 360)}`);
  else {
    if (event.startsAt) lines.push(`**Starts:** ${renderTemporal(event.startsAt, 'startsAt')}`);
    if (event.endsAt) lines.push(`**Ends:** ${renderTemporal(event.endsAt, 'endsAt')}`);
  }
  if (event.timeMode === 'local') lines.push('🌎 **Local-time event:** the announced clock time applies in each Trainer’s local area.');
  if (event.notes) lines.push(clean(event.notes, 420));
  if (event.sourceUrl) lines.push(`[Official details](${clean(event.sourceUrl, 500)})`);
  return {
    name: clean(event.name || `Pokémon GO Event ${index + 1}`, 256),
    value: lines.join('\n').slice(0, 1024) || 'No additional details.',
    inline:false
  };
}

function pokemonGoEventPayload(data = {}) {
  const events = Array.isArray(data.events) ? data.events : [];
  const fields = events.slice(0, 20).map(eventField);
  const description = events.length
    ? `Sentinal found **${events.length}** tracked/official Pokémon GO event update${events.length === 1 ? '' : 's'}. Fixed-time events use Discord timestamps automatically; official “local time” events remain local-time so the displayed hour stays correct worldwide.`
    : 'No current Pokémon GO event posts were returned.';
  const components = data.officialNewsUrl ? [{ type:1, components:[{
    type:2, style:5, label:'Official Pokémon GO News', url:String(data.officialNewsUrl).slice(0, 512)
  }] }] : [];
  return {
    embeds:[{
      color:0xE31B23,
      title:'📅 Pokémon GO Events & Community Days',
      description,
      fields,
      footer:{ text:data.officialFeed === false ? 'Nexus Sentinal • Official feed temporarily unavailable' : 'Nexus Sentinal • Official Pokémon GO event feed' }
    }],
    components,
    allowed_mentions:{ parse:[] }
  };
}

async function handlePokemonGoEventList(interaction, { backend, roleFor }) {
  const role = await roleFor(interaction);
  await interaction.deferReply();
  const result = await backend.invoke('pokemongo', 'events', {}, { role, actorId:String(interaction.user.id), confirmed:false });
  if (!result?.ok) throw new Error(result?.message || 'Pokémon GO event feed failed.');
  return interaction.editReply(pokemonGoEventPayload(result.data));
}

module.exports = { eventField, pokemonGoEventPayload, handlePokemonGoEventList };
