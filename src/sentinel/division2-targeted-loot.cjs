'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const COLOR = 0xFF6A00;
const BUTTONS = Object.freeze([
  { type:2, style:1, label:'Targeted Loot', emoji:{name:'🎯'}, custom_id:'divisionloot:targeted' },
  { type:2, style:2, label:'Drop Areas', emoji:{name:'🗺️'}, custom_id:'divisionloot:areas' },
  { type:2, style:2, label:'Sets / Perks', emoji:{name:'🧩'}, custom_id:'divisionloot:sets' },
  { type:2, style:2, label:'Reset Timer', emoji:{name:'⏱️'}, custom_id:'divisionloot:timer' },
  { type:2, style:3, label:'Refresh', emoji:{name:'🔄'}, custom_id:'divisionloot:refresh' }
]);

function divisionLootCommand() {
  return new SlashCommandBuilder()
    .setName('divisionloot')
    .setDescription('Current Division 2 targeted loot, drop areas, set bonuses, and reset timer');
}

function contextFor(interaction, role = 'viewer') {
  return { role, actorId:String(interaction.user.id), confirmed:true };
}

function unwrap(result, label = 'Division 2 action') {
  if (!result?.ok) throw new Error(result?.message || `${label} failed.`);
  return result.data || {};
}

function rows() {
  return [{ type:1, components:BUTTONS.map((button) => ({ ...button, emoji:button.emoji ? { ...button.emoji } : undefined })) }];
}

function resetLine(data = {}) {
  const unix = Number(data.nextResetUnix || 0);
  if (!unix) return '**Next reset:** unavailable';
  return `**Next targeted-loot reset:** <t:${unix}:F> • <t:${unix}:R>`;
}

function sourceFooter(data = {}) {
  return { text:`Community live data: ${data.source || 'ProtoTrack.gg'} • Nexus Sentinal does not fabricate unavailable rotations` };
}

function unavailableDescription(data = {}) {
  return [
    '⚠️ Live targeted-loot data is temporarily unavailable.',
    data.warning ? `**Reason:** ${String(data.warning).slice(0, 700)}` : '',
    resetLine(data)
  ].filter(Boolean).join('\n\n');
}

function targetedPayload(data = {}) {
  if (data.unavailable || !Array.isArray(data.missions) || !data.missions.length) {
    return { embeds:[{ color:COLOR, title:'🎯 THE DIVISION 2 • TARGETED LOOT', description:unavailableDescription(data), footer:sourceFooter(data) }], components:rows() };
  }
  const missionLines = data.missions.map((item, index) => `**${index + 1}. ${item.area}** → ${item.target}`);
  const caches = (data.vendorCaches || []).map((item) => `• **${item.type}:** ${item.target}`);
  return {
    embeds:[{
      color:COLOR,
      title:'🎯 THE DIVISION 2 • CURRENT TARGETED LOOT',
      description:[
        data.date ? `**Rotation date:** ${data.date}` : '',
        data.rotation ? `**Pool:** ${data.rotation}` : '',
        resetLine(data),
        '',
        ...missionLines
      ].filter((value) => value !== '').join('\n'),
      fields:caches.length ? [{ name:'📦 Escalation Requisition Vendor', value:caches.join('\n') }] : [],
      footer:sourceFooter(data)
    }],
    components:rows()
  };
}

function areasPayload(data = {}) {
  if (data.unavailable || !data.missions?.length) return targetedPayload(data);
  const fields = data.missions.slice(0, 20).map((item) => ({ name:`🗺️ ${item.area}`, value:`Targeted drop: **${item.target}**`, inline:false }));
  return {
    embeds:[{
      color:COLOR,
      title:'🗺️ THE DIVISION 2 • TARGETED DROP AREAS',
      description:`These are the currently tracked mission allocations.\n${resetLine(data)}`,
      fields,
      footer:sourceFooter(data)
    }],
    components:rows()
  };
}

function setBonusesPayload(targeted = {}, sets = {}) {
  const results = Array.isArray(sets.results) ? sets.results : [];
  if (!results.length) {
    return {
      embeds:[{
        color:COLOR,
        title:'🧩 THE DIVISION 2 • CURRENT SET / PERK BONUSES',
        description:[
          'No Brand Set or Gear Set in the current tracked allocation matched the Nexus set database.',
          'Weapon categories, gear slots, and mods do not have set-piece bonuses.',
          '',
          resetLine(targeted)
        ].join('\n'),
        footer:{ text:'Set data: div2hub/game-data • Target allocation: ProtoTrack.gg' }
      }],
      components:rows()
    };
  }
  const fields = results.slice(0, 10).map((set) => ({
    name:`${set.type === 'Gear Set' ? '🟢' : '🟠'} ${set.name} • ${set.type}`,
    value:(set.bonuses || []).map((bonus) => `**${bonus.pieces}:** ${bonus.bonus}`).join('\n').slice(0, 1024) || 'No bonuses listed.',
    inline:false
  }));
  return {
    embeds:[{
      color:COLOR,
      title:'🧩 THE DIVISION 2 • CURRENT SET / PERK BONUSES',
      description:`Bonuses for Brand/Gear Sets appearing in the current targeted-loot pool.\n${resetLine(targeted)}`,
      fields,
      footer:{ text:'Set data: div2hub/game-data • Target allocation: ProtoTrack.gg' }
    }],
    components:rows()
  };
}

function timerPayload(data = {}) {
  const unix = Number(data.nextResetUnix || 0);
  return {
    embeds:[{
      color:COLOR,
      title:'⏱️ THE DIVISION 2 • TARGETED LOOT RESET',
      description:[
        unix ? `## <t:${unix}:R>` : '## Reset time unavailable',
        unix ? `**Next change:** <t:${unix}:F>` : '',
        `**Cadence:** ${data.resetCadence || 'Daily rotation'}`,
        data.updatedAt ? `**Source last updated:** ${data.updatedAt}` : '',
        '',
        'The Discord relative timestamp updates automatically as the rotation approaches.'
      ].filter(Boolean).join('\n'),
      footer:sourceFooter(data)
    }],
    components:rows()
  };
}

async function loadTargeted(backend, interaction, roleFor) {
  const role = await roleFor(interaction);
  return unwrap(await backend.invoke('division2', 'farming', { mode:'targeted' }, contextFor(interaction, role)), 'Targeted loot');
}

async function loadSets(backend, interaction, roleFor, targeted) {
  const role = await roleFor(interaction);
  const names = [
    ...(targeted.missions || []).map((item) => item.target),
    ...(targeted.vendorCaches || []).map((item) => item.target)
  ];
  return unwrap(await backend.invoke('division2', 'gear', { mode:'sets', names }, contextFor(interaction, role)), 'Division 2 set bonuses');
}

async function replyOrUpdate(interaction, payload) {
  const output = { ...payload, allowed_mentions:{ parse:[] } };
  if (interaction.isButton?.()) return interaction.update(output);
  return interaction.reply(output);
}

async function handleDivisionLootCommand(interaction, deps) {
  const targeted = await loadTargeted(deps.backend, interaction, deps.roleFor);
  return replyOrUpdate(interaction, targetedPayload(targeted));
}

async function handleDivisionLootButton(interaction, deps) {
  const action = String(interaction.customId || '').split(':')[1] || 'targeted';
  const targeted = await loadTargeted(deps.backend, interaction, deps.roleFor);
  if (action === 'areas') return replyOrUpdate(interaction, areasPayload(targeted));
  if (action === 'sets') {
    const sets = await loadSets(deps.backend, interaction, deps.roleFor, targeted);
    return replyOrUpdate(interaction, setBonusesPayload(targeted, sets));
  }
  if (action === 'timer') return replyOrUpdate(interaction, timerPayload(targeted));
  return replyOrUpdate(interaction, targetedPayload(targeted));
}

module.exports = {
  divisionLootCommand,
  handleDivisionLootCommand,
  handleDivisionLootButton,
  targetedPayload,
  areasPayload,
  setBonusesPayload,
  timerPayload,
  resetLine
};
