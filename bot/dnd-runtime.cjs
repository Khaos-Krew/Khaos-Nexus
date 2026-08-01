'use strict';

const {
  resolveCampaignContext,
  requireScope,
  requireCampaignRole,
  roleForDiscordUser,
  canManageCampaign,
  parseDiceExpression,
  rollDice,
  validateRollPrivacy,
  campaignPanelData,
  stableHash,
  sortInitiative,
  advanceInitiative,
  startSession,
  endSession,
  id,
  nowIso
} = require('../shared/dnd-discord.cjs');

const DND_COMMAND_NAMES = new Set(['campaign', 'character', 'roll', 'initiative', 'session', 'quest']);

function isDndInteraction(interaction) {
  return Boolean(
    interaction && (
      (interaction.isChatInputCommand?.() && DND_COMMAND_NAMES.has(interaction.commandName)) ||
      (interaction.isButton?.() && String(interaction.customId || '').startsWith('dnd:'))
    )
  );
}

function dndState(bootstrap) { return bootstrap?.config?.dnd || null; }
function appId(bootstrap) { return String(bootstrap?.config?.discordApp?.id || 'nexus-bot'); }
function guildId(interaction) { return String(interaction.guildId || interaction.guild?.id || ''); }
function channelId(interaction) { return String(interaction.channelId || interaction.channel?.id || ''); }
function parentChannelId(interaction) { return String(interaction.channel?.parentId || interaction.channel?.parent?.id || ''); }

function contextFor(interaction, bootstrap, explicitCampaignId = '') {
  const state = dndState(bootstrap);
  if (!state) throw Object.assign(new Error('D&D campaign data is not available to this registered bot.'), { code: 'DND_STATE_UNAVAILABLE' });
  if (explicitCampaignId) {
    const campaign = state.campaigns.find((item) => item.id === explicitCampaignId);
    if (!campaign) throw Object.assign(new Error('The selected campaign was not found.'), { code: 'CAMPAIGN_NOT_FOUND' });
    return { campaignId: campaign.id, source: 'explicit-command', binding: null };
  }
  return resolveCampaignContext({
    bindings: state.bindings,
    contexts: state.channelContexts,
    appId: appId(bootstrap),
    guildId: guildId(interaction),
    channelId: channelId(interaction),
    parentChannelId: parentChannelId(interaction)
  });
}

function campaignFor(state, campaignId) {
  const campaign = state.campaigns.find((item) => item.id === campaignId);
  if (!campaign) throw Object.assign(new Error('Campaign not found.'), { code: 'CAMPAIGN_NOT_FOUND' });
  return campaign;
}

function commandPath(interaction) {
  const group = interaction.options?.getSubcommandGroup?.(false) || '';
  const sub = interaction.options?.getSubcommand?.(false) || '';
  return [interaction.commandName, group, sub].filter(Boolean).join(' ');
}

function memberRole(state, campaignId, interaction, manage = false) {
  return requireCampaignRole(state, campaignId, interaction.user.id, { manage });
}

function emitMutation(runtime, operation, data, interaction) {
  runtime.send('dnd-state-change', {
    operation,
    data,
    appId: appId(runtime.getBootstrap()),
    guildId: guildId(interaction),
    actorId: String(interaction.user?.id || '')
  });
}

function renderCampaignInfo(state, campaignId) {
  const panel = campaignPanelData(state, campaignId);
  return {
    embeds: [{
      title: panel.campaign.name,
      description: `Status: **${panel.campaign.status}**\nRuleset: **${panel.campaign.ruleset || 'Not set'}**`,
      fields: [
        { name: 'DM', value: panel.dm?.displayName || 'Not assigned', inline: true },
        { name: 'Players', value: String(panel.playerCount), inline: true },
        { name: 'Next session', value: panel.nextSession ? `${panel.nextSession.title}\n${panel.nextSession.startsAt}` : 'Not scheduled', inline: false },
        { name: 'Current location', value: panel.currentLocation || 'Not set', inline: true },
        { name: 'Active quest', value: panel.activeQuest?.title || 'None', inline: true }
      ],
      footer: { text: 'Khaos Nexus D&D' }
    }]
  };
}

function panelPayload(state, campaignId) {
  const panel = campaignPanelData(state, campaignId);
  const party = panel.party.length
    ? panel.party.slice(0, 8).map((item) => `${item.name}: ${item.hp}/${item.maxHp} HP · AC ${item.armorClass}${item.conditions.length ? ` · ${item.conditions.join(', ')}` : ''}`).join('\n')
    : 'No active characters.';
  return {
    hash: stableHash(panel),
    body: {
      embeds: [{
        title: panel.campaign.name,
        description: `Campaign status: **${panel.campaign.status}**`,
        fields: [
          { name: 'DM', value: panel.dm?.displayName || 'Not assigned', inline: true },
          { name: 'Players', value: String(panel.playerCount), inline: true },
          { name: 'Ruleset', value: panel.campaign.ruleset || 'Not set', inline: true },
          { name: 'Next session', value: panel.nextSession ? `${panel.nextSession.title}\n${panel.nextSession.startsAt}` : 'Not scheduled' },
          { name: 'Active session', value: panel.activeSession?.title || 'None', inline: true },
          { name: 'Current location', value: panel.currentLocation || 'Not set', inline: true },
          { name: 'Active quest', value: panel.activeQuest?.title || 'None' },
          { name: 'Party', value: party.slice(0, 1024) }
        ],
        footer: { text: 'Khaos Nexus D&D · Persistent campaign panel' }
      }],
      components: [{
        type: 1,
        components: [
          ['Characters', 'characters'], ['Attendance', 'attendance'], ['Quests', 'quests'], ['Shared loot', 'loot'], ['Roll dice', 'roll']
        ].map(([label, action]) => ({ type: 2, style: 2, label, custom_id: `dnd:${action}:${campaignId}` }))
      }]
    }
  };
}

async function refreshPanel(interaction, runtime, campaignId, binding = null) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  const selected = binding || state.bindings.find((item) => item.active !== false && item.campaignId === campaignId && item.appId === appId(bootstrap) && item.guildId === guildId(interaction) && item.primary && item.purpose === 'main') ||
    state.bindings.find((item) => item.active !== false && item.campaignId === campaignId && item.appId === appId(bootstrap) && item.guildId === guildId(interaction) && item.purpose === 'main');
  if (!selected) throw Object.assign(new Error('This campaign has no active main Discord binding for the selected bot and guild.'), { code: 'BINDING_NOT_FOUND' });
  const channel = await runtime.client.channels.fetch(selected.resourceId);
  if (!channel?.isTextBased?.()) throw Object.assign(new Error('The bound Discord resource is not text-capable.'), { code: 'WRONG_DISCORD_RESOURCE_TYPE' });
  const rendered = panelPayload(state, campaignId);
  let panel = state.panels.find((item) => item.bindingId === selected.id) || { id: id('panel'), bindingId: selected.id, messageId: '', contentHash: '' };
  if (panel.messageId && panel.contentHash === rendered.hash) return { unchanged: true, panel };
  let message = null;
  if (panel.messageId) {
    try { message = await channel.messages.fetch(panel.messageId); await message.edit(rendered.body); }
    catch { panel.messageId = ''; }
  }
  if (!panel.messageId) message = await channel.send(rendered.body);
  panel = { ...panel, messageId: String(message.id), contentHash: rendered.hash, lastRefreshedAt: nowIso(), lastError: '', updatedAt: nowIso() };
  const existing = state.panels.findIndex((item) => item.id === panel.id);
  if (existing >= 0) state.panels[existing] = panel; else state.panels.push(panel);
  emitMutation(runtime, 'panel.upsert', panel, interaction);
  return { unchanged: false, panel };
}

async function handleCampaign(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  const sub = interaction.options.getSubcommand();
  if (sub === 'use') {
    const selectedId = interaction.options.getString('campaign', true);
    const selected = campaignFor(state, selectedId);
    requireScope(state, selected.id, appId(bootstrap), guildId(interaction), 'campaign:read');
    memberRole(state, selected.id, interaction, true);
    const next = {
      id: id('context'), appId: appId(bootstrap), guildId: guildId(interaction), channelId: channelId(interaction),
      campaignId: selected.id, selectedBy: interaction.user.id, active: true, updatedAt: nowIso()
    };
    const existing = state.channelContexts.findIndex((item) => item.appId === next.appId && item.guildId === next.guildId && item.channelId === next.channelId);
    if (existing >= 0) next.id = state.channelContexts[existing].id, state.channelContexts[existing] = next; else state.channelContexts.push(next);
    emitMutation(runtime, 'context.set', next, interaction);
    await interaction.reply({ content: `Active campaign context set to **${selected.name}** for this channel.`, ephemeral: true });
    return;
  }
  const campaignId = context.campaignId;
  requireScope(state, campaignId, appId(bootstrap), guildId(interaction), sub === 'panel' ? 'panels:manage' : 'campaign:read');
  memberRole(state, campaignId, interaction, sub === 'panel');
  if (sub === 'info') await interaction.reply({ ...renderCampaignInfo(state, campaignId), ephemeral: false });
  if (sub === 'panel') {
    await interaction.deferReply({ ephemeral: true });
    const result = await refreshPanel(interaction, runtime, campaignId, context.binding);
    await interaction.editReply(result.unchanged ? 'The persistent campaign panel is already current.' : 'The persistent campaign panel was refreshed.');
  }
}

async function handleCharacter(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  requireScope(state, context.campaignId, appId(bootstrap), guildId(interaction), 'characters:read');
  memberRole(state, context.campaignId, interaction, false);
  const requested = interaction.options.getString('character') || '';
  const visible = state.characters.filter((item) => item.campaignId === context.campaignId);
  const character = visible.find((item) => item.id === requested || item.name.toLowerCase() === requested.toLowerCase()) ||
    visible.find((item) => item.discordUserId === interaction.user.id && item.selected) ||
    visible.find((item) => item.discordUserId === interaction.user.id && item.status === 'active');
  if (!character) throw Object.assign(new Error('No available character was found. Select or create one in the Nexus dashboard.'), { code: 'CHARACTER_NOT_FOUND' });
  await interaction.reply({
    embeds: [{
      title: character.name,
      description: `Level ${character.level || 1} ${character.className || 'Adventurer'} · **${character.status || 'active'}**`,
      fields: [
        { name: 'HP', value: `${character.hp ?? 0}/${character.maxHp ?? 0}`, inline: true },
        { name: 'Armor Class', value: String(character.armorClass ?? 0), inline: true },
        { name: 'Conditions', value: character.conditions?.length ? character.conditions.join(', ') : 'None', inline: false },
        { name: 'Inspiration', value: character.inspiration ? 'Yes' : 'No', inline: true },
        { name: 'Exhaustion', value: String(character.exhaustion ?? 0), inline: true }
      ],
      thumbnail: character.portraitUrl ? { url: character.portraitUrl } : undefined
    }],
    ephemeral: true
  });
}

async function dmDestination(runtime, state, campaignId, interaction) {
  const binding = state.bindings.find((item) => item.active !== false && item.campaignId === campaignId && item.appId === appId(runtime.getBootstrap()) && item.guildId === guildId(interaction) && item.purpose === 'dm_private');
  if (!binding) return null;
  try {
    const channel = await runtime.client.channels.fetch(binding.resourceId);
    return channel?.isTextBased?.() ? { binding, channel } : null;
  } catch { return null; }
}

async function handleRoll(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  requireScope(state, context.campaignId, appId(bootstrap), guildId(interaction), 'rolls:create');
  const role = memberRole(state, context.campaignId, interaction, false);
  const privacy = interaction.options.getString('privacy') || 'public';
  const destination = await dmDestination(runtime, state, context.campaignId, interaction);
  validateRollPrivacy({ privacy, dmDestinationAvailable: Boolean(destination) });
  const parsed = parseDiceExpression(interaction.options.getString('expression', true));
  const result = rollDice(parsed);
  const roll = {
    id: id('roll'), campaignId: context.campaignId, userId: interaction.user.id, discordUserId: interaction.user.id,
    appId: appId(bootstrap), guildId: guildId(interaction), channelId: channelId(interaction),
    expression: result.original, normalizedExpression: result.normalized, rolls: result.rolls,
    keptIndexes: result.keptIndexes, modifier: result.modifier, total: result.total,
    privacy, deliveredToDm: false, createdAt: nowIso(), actorRole: role
  };
  const detail = `**${interaction.user.displayName || interaction.user.username}** rolled \`${result.normalized}\`: [${result.rolls.join(', ')}]${result.modifier ? ` ${result.modifier > 0 ? '+' : ''}${result.modifier}` : ''} = **${result.total}**`;

  if (privacy === 'public') {
    state.rolls.push(roll);
    emitMutation(runtime, 'roll.create', roll, interaction);
    await interaction.reply({ content: detail });
    return;
  }

  let delivered = false;
  if (destination) {
    try {
      await destination.channel.send({ content: `${privacy === 'blind' ? 'Blind' : 'DM-only'} roll for <@${interaction.user.id}>\n${detail}` });
      delivered = true;
    } catch { delivered = false; }
  }
  if (privacy === 'blind' && !delivered) {
    await interaction.reply({ content: 'The blind roll was not executed because the configured DM destination could not accept it.', ephemeral: true });
    return;
  }
  roll.deliveredToDm = delivered;
  state.rolls.push(roll);
  emitMutation(runtime, 'roll.create', roll, interaction);
  if (privacy === 'blind') await interaction.reply({ content: 'Blind roll completed and delivered to the configured DM destination.', ephemeral: true });
  else await interaction.reply({ content: `${detail}\n${delivered ? 'Delivered to the configured DM destination.' : 'The result was not delivered because no safe DM destination was available.'}`, ephemeral: true });
}

function activeEncounter(state, campaignId) {
  return state.encounters.find((item) => item.campaignId === campaignId && item.status === 'active') || null;
}

async function handleInitiative(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  const sub = interaction.options.getSubcommand();
  requireScope(state, context.campaignId, appId(bootstrap), guildId(interaction), sub === 'view' ? 'campaign:read' : 'encounters:manage');
  memberRole(state, context.campaignId, interaction, sub === 'next');
  const encounter = activeEncounter(state, context.campaignId);
  if (!encounter) throw Object.assign(new Error('No active encounter exists for this campaign.'), { code: 'ENCOUNTER_NOT_ACTIVE' });
  const combatants = state.combatants.filter((item) => item.encounterId === encounter.id && item.active !== false);
  if (sub === 'view') {
    const order = sortInitiative(combatants);
    const lines = order.map((item, index) => `${index === Number(encounter.currentTurnIndex || 0) ? '▶' : '•'} ${item.name} — ${item.initiative}`).join('\n') || 'No combatants have joined initiative.';
    await interaction.reply({ content: `**Round ${encounter.round || 1}**\n${lines}` });
    return;
  }
  if (sub === 'join') {
    const character = state.characters.find((item) => item.campaignId === context.campaignId && item.discordUserId === interaction.user.id && item.selected) || state.characters.find((item) => item.campaignId === context.campaignId && item.discordUserId === interaction.user.id && item.status === 'active');
    if (!character) throw Object.assign(new Error('Select an active character before joining initiative.'), { code: 'CHARACTER_NOT_FOUND' });
    const rolled = rollDice(`d20${Number(character.initiativeModifier || 0) >= 0 ? '+' : ''}${Number(character.initiativeModifier || 0)}`);
    const combatant = {
      id: id('combatant'), encounterId: encounter.id, campaignId: context.campaignId, characterId: character.id,
      discordUserId: interaction.user.id, name: character.name, initiative: rolled.total,
      dexterity: Number(character.abilityModifiers?.dexterity || 0), active: true, createdAt: nowIso()
    };
    state.combatants = state.combatants.filter((item) => !(item.encounterId === encounter.id && item.characterId === character.id));
    state.combatants.push(combatant);
    emitMutation(runtime, 'initiative.join', combatant, interaction);
    await interaction.reply({ content: `**${character.name}** joined initiative with **${rolled.total}**.` });
    return;
  }
  if (sub === 'next') {
    const result = advanceInitiative(encounter, combatants);
    encounter.currentTurnIndex = result.currentTurnIndex;
    encounter.round = result.round;
    emitMutation(runtime, 'initiative.next', { campaignId: context.campaignId, encounterId: encounter.id, currentTurnIndex: result.currentTurnIndex, round: result.round }, interaction);
    await interaction.reply({ content: `Round **${result.round}** — it is now **${result.currentCombatant.name}**'s turn.` });
  }
}

async function handleSession(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  const sub = interaction.options.getSubcommand();
  requireScope(state, context.campaignId, appId(bootstrap), guildId(interaction), sub === 'status' ? 'campaign:read' : 'sessions:manage');
  memberRole(state, context.campaignId, interaction, sub !== 'status');
  const sessions = state.sessions.filter((item) => item.campaignId === context.campaignId);
  if (sub === 'status') {
    const active = sessions.find((item) => item.status === 'active');
    const next = sessions.filter((item) => item.status === 'planned').sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0];
    await interaction.reply({ content: active ? `Active session: **${active.title}**` : next ? `Next session: **${next.title}** — ${next.startsAt || 'time not set'}` : 'No active or planned session.' });
    return;
  }
  if (sub === 'start') {
    const requested = interaction.options.getString('session') || '';
    const session = sessions.find((item) => item.id === requested) || sessions.find((item) => item.status === 'planned');
    if (!session) throw Object.assign(new Error('No planned session is available to start.'), { code: 'SESSION_NOT_FOUND' });
    startSession(state, session.id, { resetInitiative: Boolean(interaction.options.getBoolean('reset_initiative')) });
    emitMutation(runtime, 'session.start', { campaignId: context.campaignId, sessionId: session.id, resetInitiative: Boolean(interaction.options.getBoolean('reset_initiative')) }, interaction);
    await refreshPanel(interaction, runtime, context.campaignId, context.binding).catch(() => null);
    await interaction.reply({ content: `Session started: **${session.title}**.` });
    return;
  }
  if (sub === 'end') {
    const session = sessions.find((item) => item.status === 'active');
    if (!session) throw Object.assign(new Error('No active session is available to end.'), { code: 'SESSION_NOT_ACTIVE' });
    endSession(state, session.id);
    emitMutation(runtime, 'session.end', { campaignId: context.campaignId, sessionId: session.id }, interaction);
    await refreshPanel(interaction, runtime, context.campaignId, context.binding).catch(() => null);
    await interaction.reply({ content: `Session ended: **${session.title}**. A structured draft recap was created from Nexus-recorded activity and requires DM approval.` });
  }
}

async function handleQuest(interaction, runtime, context) {
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  requireScope(state, context.campaignId, appId(bootstrap), guildId(interaction), 'quests:read');
  memberRole(state, context.campaignId, interaction, false);
  const quests = state.quests.filter((item) => item.campaignId === context.campaignId && !['archived', 'draft'].includes(item.status));
  const content = quests.length ? quests.slice(0, 20).map((item) => `• **${item.title || item.name || 'Quest'}** — ${item.status || 'active'}`).join('\n') : 'No visible quests are available.';
  await interaction.reply({ content, ephemeral: true });
}

async function handleButton(interaction, runtime) {
  const [, action, campaignId] = String(interaction.customId).split(':');
  const bootstrap = runtime.getBootstrap();
  const state = dndState(bootstrap);
  campaignFor(state, campaignId);
  requireScope(state, campaignId, appId(bootstrap), guildId(interaction), action === 'roll' ? 'rolls:create' : 'campaign:read');
  memberRole(state, campaignId, interaction, false);
  const messages = {
    characters: 'Use `/character view` to view your selected character.',
    attendance: 'Use `/session status` or open the Nexus dashboard to update attendance.',
    quests: 'Use `/quest list` to view campaign quests.',
    loot: 'Open the Nexus dashboard to view shared campaign loot.',
    roll: 'Use `/roll expression:<dice>` to roll through the campaign.'
  };
  await interaction.reply({ content: messages[action] || 'Open the Khaos Nexus dashboard for this campaign.', ephemeral: true });
}

async function handleDndInteraction(interaction, runtime) {
  if (!isDndInteraction(interaction)) return false;
  try {
    if (interaction.isButton?.()) { await handleButton(interaction, runtime); return true; }
    const explicit = interaction.commandName === 'campaign' && interaction.options.getSubcommand() === 'use'
      ? interaction.options.getString('campaign', true)
      : '';
    const context = contextFor(interaction, runtime.getBootstrap(), explicit);
    if (interaction.commandName === 'campaign') await handleCampaign(interaction, runtime, context);
    else if (interaction.commandName === 'character') await handleCharacter(interaction, runtime, context);
    else if (interaction.commandName === 'roll') await handleRoll(interaction, runtime, context);
    else if (interaction.commandName === 'initiative') await handleInitiative(interaction, runtime, context);
    else if (interaction.commandName === 'session') await handleSession(interaction, runtime, context);
    else if (interaction.commandName === 'quest') await handleQuest(interaction, runtime, context);
    return true;
  } catch (error) {
    runtime.log?.('warn', `D&D command failed: ${commandPath(interaction)}: ${error.code || error.message}`);
    const content = error.message || 'The D&D command failed.';
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => interaction.followUp({ content, ephemeral: true }).catch(() => {}));
    else await interaction.reply({ content, ephemeral: true }).catch(() => {});
    return true;
  }
}

module.exports = { DND_COMMAND_NAMES, isDndInteraction, handleDndInteraction, contextFor, panelPayload };
