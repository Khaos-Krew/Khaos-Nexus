'use strict';
const { Client, Events, MessageFlags, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ProtocolEngine } = require('./engine.cjs');
const { DarkZone } = require('./dark-zone.cjs');
const { DEFINITIONS } = require('./definitions.cjs');
const { ArkIdentityStore } = require('../ark-identity-store.cjs');
const { loadConfig } = require('../../shared/config.cjs');
const { isStaff } = require('../ark-ops-extension.cjs');
const INSTALLED = Symbol.for('khaos.nexus.protocol.installed');
const string = (sub, name, description, required = false) => sub.addStringOption((o) => o.setName(name).setDescription(description).setRequired(required).setMaxLength(128));
function commands() {
  const command = new SlashCommandBuilder().setName('protocol').setDescription('Nexus Protocol network, participation and records.');
  for (const name of ['status', 'list', 'history']) command.addSubcommand((s) => s.setName(name).setDescription(`View Protocol ${name}.`));
  for (const name of ['stats', 'leaderboard']) command.addSubcommand((s) => string(s.setName(name).setDescription(`View Protocol ${name}.`), 'season', 'Season ID; omit for lifetime.'));
  for (const name of ['join', 'progress', 'participants', 'start', 'pause', 'complete', 'fail', 'cancel']) command.addSubcommand((s) => string(s.setName(name).setDescription(`${name} a Protocol run.`), 'id', 'Protocol run ID.', true));
  command.addSubcommand((s) => {
    s.setName('create').setDescription('Staff: create a Protocol draft.');
    s.addStringOption((o) => o.setName('type').setDescription('Protocol family.').setRequired(true).addChoices(...DEFINITIONS.map((d) => ({ name: d.name, value: d.id }))));
    string(s, 'season', 'Season ID.', true); string(s, 'maps', 'Comma-separated map IDs, e.g. ARK_GEN1.', true);
    return s;
  });
  command.addSubcommand((s) => {
    s.setName('season').setDescription('Staff: define a season with explicit ISO timestamps.');
    string(s, 'id', 'Season ID.', true); string(s, 'start', 'Start ISO timestamp with timezone.', true); string(s, 'end', 'End ISO timestamp with timezone.', true); return s;
  });
  command.addSubcommand((s) => {
    s.setName('record').setDescription('Staff: record verified objective or active-time evidence.');
    for (const [name, text] of [['id', 'Run ID.'], ['event', 'Unique evidence ID; reuse for retries.'], ['map', 'Verified map ID.'], ['at', 'Evidence ISO timestamp including timezone.'], ['evidence', 'Evidence reference or verification note.']]) string(s, name, text, true);
    s.addUserOption((o) => o.setName('player').setDescription('Verified participant.').setRequired(true));
    s.addStringOption((o) => o.setName('metric').setDescription('Verified contribution type.').setRequired(true).addChoices(...['active-seconds', ...DEFINITIONS.filter((d) => d.id !== 'dark-zone').map((d) => d.metric)].map((v) => ({ name: v, value: v }))));
    s.addIntegerOption((o) => o.setName('amount').setDescription('Objective: 1. Active seconds: 1–60.').setRequired(true).setMinValue(1).setMaxValue(60));
    return s;
  });
  command.addSubcommand((s) => {
    s.setName('disqualify').setDescription('Staff: disqualify a participant before completion.');
    string(s, 'id', 'Run ID.', true); string(s, 'reason', 'Audited reason.', true);
    return s.addUserOption((o) => o.setName('player').setDescription('Participant.').setRequired(true));
  });
  const dark = new SlashCommandBuilder().setName('darkzone').setDescription('Voluntary PvP protection status.');
  for (const name of ['status', 'enlist', 'withdraw']) dark.addSubcommand((s) => s.setName(name).setDescription(`Dark Zone ${name}.`));
  return [command, dark];
}
function linked(identities, discordId) {
  const profile = identities.profileByDiscord(discordId);
  if (!profile?.arkAccounts?.length) throw new Error('Link your ARK account using /ark link before participating.');
  // Aggregate all verified ARK accounts under the stable Discord identity.
  return discordId;
}
function iso(value) {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value || '') || !Number.isFinite(Date.parse(value))) throw new Error('Use an ISO timestamp with an explicit timezone');
  return Date.parse(value);
}
function summary(run) { return `**${run.definition.name}** • ${run.status.toUpperCase()}\n\`${run.id}\` • ${run.participants.length} participants`; }
async function handle(interaction, context) {
  const button = interaction.isButton?.() && interaction.customId === 'nxprotocol:stats';
  if (!button && (!interaction.isChatInputCommand?.() || !['protocol', 'darkzone'].includes(interaction.commandName))) return false;
  if (interaction.guildId !== context.guildId) return false;
  const sub = button ? 'stats' : interaction.options.getSubcommand();
  const publicActions = new Set(['status', 'list', 'history', 'stats', 'leaderboard', 'join', 'progress']);
  if (interaction.commandName === 'protocol' && !publicActions.has(sub) && !isStaff(interaction, context.config)) throw new Error('Nexus staff authorization required.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { engine, identities, darkzone } = context;
  const actor = interaction.user.id;
  const get = (name) => button ? null : interaction.options.getString(name);
  let content;
  if (interaction.commandName === 'darkzone') {
    // This release intentionally has no damage adapter: do not accept live enlistment.
    if (sub === 'status') content = `**DARK ZONE // CONTAINED**\nYour registry state: ${darkzone.status('player', actor).state}\nLive PvP enrollment awaits verified server-side damage protection. Solo enrollment will never expose tribe structures.`;
    else content = '**DARK ZONE // CONTAINED**\nLive enrollment is unavailable while game damage protection is unverified. No PvP state was changed.';
  } else if (sub === 'status') {
    content = '**NEXUS PROTOCOL // PARTIAL ACTIVATION**\nParticipation registry, verified evidence, Protocol Score and seasonal records are online. Automatic game telemetry is staging.\n\n' + DEFINITIONS.map((d) => `**${d.name}** — ${d.description}`).join('\n');
  } else if (['list', 'history'].includes(sub)) {
    const terminal = ['completed', 'failed', 'cancelled'];
    const runs = engine.store.read().runs.filter((r) => sub === 'history' ? terminal.includes(r.status) : !terminal.includes(r.status)).slice(-10).reverse();
    content = runs.map(summary).join('\n\n') || 'No matching Protocol records.';
  } else if (sub === 'stats') {
    const stats = engine.stats(actor, get('season'));
    content = `**NEXUS RECORD // ${stats.seasonId}**\nProtocol Score: **${stats.score}**\nQualified completions: **${stats.completions}**\nParticipations: **${stats.participations}**\nVerified active seconds: **${stats.activeSeconds}**\nProtocol Score is prestige, not spendable Nexus Points.`;
  } else if (sub === 'leaderboard') {
    content = engine.leaderboard(get('season')).map((p, i) => `${i + 1}. <@${p.playerId}> — **${p.score}**`).join('\n') || 'No qualified completions recorded yet.';
  } else if (sub === 'season') {
    const result = engine.season({ seasonId: get('id'), startAt: iso(get('start')), endAt: iso(get('end')) }, actor); content = `Season **${result.id}** registered.`;
  } else if (sub === 'create') {
    content = summary(engine.create({ type: get('type'), seasonId: get('season'), maps: get('maps').split(',').map((m) => m.trim()) }, actor)) + '\nQualification: 300 verified active seconds and 1 objective. Score: 100. Duration: 60 minutes.';
  } else if (sub === 'join') {
    engine.join(get('id'), linked(identities, actor), actor); content = 'Participation registered. Joining alone does not grant activity credit or Protocol Score.';
  } else if (['progress', 'participants'].includes(sub)) {
    const run = engine.store.read().runs.find((r) => r.id === get('id'));
    if (!run) throw new Error('Protocol run not found');
    const participants = sub === 'progress' ? run.participants.filter((p) => p.playerId === actor) : run.participants;
    content = summary(run) + '\n' + participants.slice(0, 15).map((p) => `<@${p.playerId}> • ${p.activeSeconds}/${run.rules.minActiveSeconds}s • ${p.contribution}/${run.rules.target} objectives${p.disqualified ? ' • DISQUALIFIED' : ''}`).join('\n');
  } else if (sub === 'record') {
    const playerId = linked(identities, interaction.options.getUser('player', true).id);
    const at = iso(get('at')), amount = interaction.options.getInteger('amount', true), metric = get('metric');
    const result = engine.record({ runId: get('id'), playerId, source: 'staff', eventId: get('event'), map: get('map'), metric, amount, at, intervalStart: metric === 'active-seconds' ? at - amount * 1000 : undefined, evidence: get('evidence') }, actor);
    content = result.duplicate ? 'Evidence already recorded; no additional credit granted.' : 'Verified evidence recorded in the Protocol audit ledger.';
  } else if (sub === 'disqualify') {
    engine.disqualify(get('id'), interaction.options.getUser('player', true).id, get('reason'), actor); content = 'Participant disqualified; reason recorded.';
  } else {
    const next = { start: 'active', pause: 'paused', complete: 'completed', fail: 'failed', cancel: 'cancelled' }[sub];
    if (!next) throw new Error('Unknown Protocol action');
    content = summary(engine.transition(get('id'), next, actor));
  }
  const payload = { content: content.slice(0, 1950), allowedMentions: { parse: [] } };
  if (sub === 'status' && interaction.commandName === 'protocol') payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nxprotocol:stats').setLabel('My Protocol Record').setStyle(ButtonStyle.Secondary))];
  await interaction.editReply(payload); return true;
}
function installProtocolExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function protocolLogin(...args) {
    const client = this, config = loadConfig();
    const engine = new ProtocolEngine();
    const context = { engine, darkzone: new DarkZone({ store: engine.store }), identities: new ArkIdentityStore(), config, guildId: String(config.discord?.guildId || '') };
    client.on(Events.InteractionCreate, (interaction) => {
      void handle(interaction, context).catch(async (error) => {
        const payload = { content: String(error.message).slice(0, 1500), allowedMentions: { parse: [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
        else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
      });
    });
    client.once(Events.ClientReady, () => {
      const timer = setTimeout(() => void (async () => {
        engine.store.read();
        const guild = await client.guilds.fetch(context.guildId);
        const existing = await guild.commands.fetch();
        for (const definition of commands().map((c) => c.toJSON())) {
          const prior = existing.find((c) => c.name === definition.name);
          if (prior) await guild.commands.edit(prior.id, definition); else await guild.commands.create(definition);
        }
        console.log('[Nexus Protocol] framework online commands=/protocol,/darkzone telemetry=manual-verified pvp=contained');
        await require('../nexus-protocol-feature-post.cjs').postProtocolMilestone(client, { store: engine.store });
      })().catch((e) => console.error(`[Nexus Protocol] initialization failed: ${e.message}`)), 120000);
      timer.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}
module.exports = { commands, handle, linked, installProtocolExtension };
