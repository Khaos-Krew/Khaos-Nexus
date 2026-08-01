'use strict';

const base = require('./dnd-runtime-policy.cjs');
const {
  clean,
  id,
  nowIso,
  requireScope,
  rollDice
} = require('../shared/dnd-discord.cjs');
const {
  ensureEncounterPanelCollections,
  panelPayload,
  validateButtonExecution,
  buttonId,
  actionsForTurn,
  currentEncounterState,
  managerFor
} = require('../shared/dnd-encounter-panels.cjs');

function appId(runtime) { return String(runtime.getBootstrap()?.config?.discordApp?.id || 'nexus-bot'); }
function guildId(interaction) { return String(interaction.guildId || interaction.guild?.id || ''); }
function channelId(interaction) { return String(interaction.channelId || interaction.channel?.id || ''); }
function dndState(runtime) {
  const state = runtime.getBootstrap()?.config?.dnd || null;
  if (state) ensureEncounterPanelCollections(state);
  return state;
}
function emitMutation(runtime, operation, data, interaction = null) {
  runtime.send('dnd-state-change', {
    operation,
    data,
    appId: appId(runtime),
    guildId: interaction ? guildId(interaction) : clean(data.guildId, 30),
    actorId: interaction ? String(interaction.user?.id || '') : 'encounter-panel-runtime'
  });
}
function isEncounterRollButton(interaction) {
  return Boolean(interaction?.isButton?.() && String(interaction.customId || '').startsWith('dnd:er:'));
}
function isEncounterMoreButton(interaction) {
  return Boolean(interaction?.isButton?.() && String(interaction.customId || '').startsWith('dnd:em:'));
}
function bindingFor(state, panel) {
  return (state.bindings || []).find((item) => item.id === panel.bindingId && item.active !== false) || null;
}
function dmBinding(state, panel, runtime) {
  return (state.bindings || []).find((item) => item.active !== false && item.campaignId === panel.campaignId && item.appId === appId(runtime) && item.guildId === panel.guildId && item.purpose === 'dm_private') || null;
}
function componentStyle(action) {
  return action.rollType === 'damage' ? 4 : action.rollType === 'healing' ? 3 : 1;
}
function actionRows(actions, panel, encounter, currentIndex) {
  const rows = [];
  for (let offset = 0; offset < actions.length; offset += 5) {
    rows.push({
      type: 1,
      components: actions.slice(offset, offset + 5).map((action) => ({
        type: 2,
        style: componentStyle(action),
        label: action.label.slice(0, 80),
        custom_id: buttonId(panel, action, encounter, currentIndex)
      }))
    });
  }
  return rows;
}
function moreButtonId(panel, encounter, currentIndex) {
  return `dnd:em:${panel.panelToken}:${panel.actionRevision}:${encounter.round || 1}:${currentIndex}:v1`;
}
function parseMoreButtonId(customId) {
  const parts = String(customId || '').split(':');
  if (parts.length !== 7 || parts[0] !== 'dnd' || parts[1] !== 'em' || parts[6] !== 'v1') return null;
  return {
    panelToken: clean(parts[2], 24),
    actionRevision: Number(parts[3]),
    round: Number(parts[4]),
    currentIndex: Number(parts[5])
  };
}

class EncounterPanelController {
  constructor(runtime) {
    this.runtime = runtime;
    this.timer = null;
    this.refreshing = false;
    this.pending = false;
  }

  onConfigUpdate() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refreshAll().catch((error) => this.runtime.log?.('warn', `Encounter panel refresh failed: ${error.message}`)), 150);
    this.timer.unref?.();
  }

  async refreshAll() {
    if (this.refreshing) { this.pending = true; return; }
    if (!this.runtime.client?.isReady?.()) return;
    const state = dndState(this.runtime);
    if (!state) return;
    this.refreshing = true;
    try {
      const panels = state.encounterPanels.filter((panel) => panel.autoRefresh && ['active', 'paused', 'completed', 'stale'].includes(panel.status));
      for (const panel of panels) {
        const binding = bindingFor(state, panel);
        if (!binding || binding.appId !== appId(this.runtime)) continue;
        await this.refreshOne(panel, state).catch((error) => this.markStale(panel, error));
      }
    } finally {
      this.refreshing = false;
      if (this.pending) { this.pending = false; this.onConfigUpdate(); }
    }
  }

  async markStale(panel, error) {
    const message = String(error?.message || error || 'Encounter panel could not be refreshed.').slice(0, 1000);
    if (panel.status === 'stale' && panel.lastError === message) return;
    emitMutation(this.runtime, 'encounter-panel.stale', {
      ...panel,
      status: 'stale',
      lastError: message,
      staleReason: 'Discord binding, channel, permissions, or message is unavailable.',
      updatedAt: nowIso()
    });
  }

  async refreshOne(panel, state = dndState(this.runtime)) {
    const binding = bindingFor(state, panel);
    if (!binding) throw new Error('Encounter panel binding was not found.');
    if (binding.appId !== appId(this.runtime)) return { skipped: true };
    const channel = await this.runtime.client.channels.fetch(binding.resourceId);
    if (!channel?.isTextBased?.()) throw new Error('Encounter panel binding is not text-capable.');
    const rendered = panelPayload(state, panel);
    const encounterDone = panel.status === 'completed' || rendered.snapshot.encounter?.status === 'completed' || rendered.snapshot.encounter?.status === 'archived';
    if (encounterDone) {
      rendered.body.components = [];
    } else if (rendered.actions.length > 19) {
      rendered.body.components = actionRows(rendered.actions.slice(0, 19), panel, rendered.snapshot.encounter, rendered.snapshot.currentIndex);
      rendered.body.components.push({
        type: 1,
        components: [{ type: 2, style: 2, label: 'More Actions…', custom_id: moreButtonId(panel, rendered.snapshot.encounter, rendered.snapshot.currentIndex) }]
      });
    }
    let message = null;
    if (panel.messageId) {
      try { message = await channel.messages.fetch(panel.messageId); }
      catch { message = null; }
    }
    if (message && panel.contentHash === rendered.hash && panel.status !== 'stale') return { unchanged: true, panel, message };
    if (message) await message.edit(rendered.body);
    else message = await channel.send(rendered.body);
    const encounterStatus = rendered.snapshot.encounter?.status;
    const nextStatus = encounterStatus === 'completed' || encounterStatus === 'archived' ? 'completed' : encounterStatus === 'paused' ? 'paused' : 'active';
    const value = {
      ...panel,
      bindingId: binding.id,
      appId: binding.appId,
      guildId: binding.guildId,
      messageId: String(message.id),
      contentHash: rendered.hash,
      status: nextStatus,
      lastRefreshedAt: nowIso(),
      lastError: '',
      staleReason: '',
      updatedAt: nowIso()
    };
    emitMutation(this.runtime, 'encounter-panel.upsert', value);
    return { unchanged: false, panel: value, message };
  }
}

async function safeDmDestination(runtime, state, panel) {
  const binding = dmBinding(state, panel, runtime);
  if (!binding) return null;
  try {
    const channel = await runtime.client.channels.fetch(binding.resourceId);
    if (!base.hasSafeDmPermissions(channel, runtime.client.user)) return null;
    return { binding, channel };
  } catch {
    return null;
  }
}

function rollDetail(interaction, action, result, current, manager) {
  const actor = interaction.user?.displayName || interaction.user?.username || interaction.user?.id || 'Player';
  const override = manager && current.discordUserId !== interaction.user.id ? ' · DM override' : '';
  return `**${actor}** used **${action.label}** for **${current.nameSnapshot || current.name || 'the current combatant'}**${override}\n\`${result.normalized}\`: [${result.rolls.join(', ')}]${result.modifier ? ` ${result.modifier > 0 ? '+' : ''}${result.modifier}` : ''} = **${result.total}**`;
}
function assertBindingContext(state, panel, interaction, runtime) {
  const binding = bindingFor(state, panel);
  if (!binding || binding.appId !== appId(runtime) || binding.guildId !== guildId(interaction) || binding.resourceId !== channelId(interaction)) {
    throw Object.assign(new Error('This encounter action is not valid in the current Discord resource.'), { code: 'DND_ENCOUNTER_BUTTON_CONTEXT' });
  }
  return binding;
}

async function handleEncounterRoll(interaction, runtime, controller) {
  const state = dndState(runtime);
  if (!state) throw Object.assign(new Error('D&D encounter data is unavailable.'), { code: 'DND_STATE_UNAVAILABLE' });
  const execution = validateButtonExecution(state, { customId: interaction.customId, discordUserId: interaction.user.id });
  const { panel, action, snapshot, current, manager } = execution;
  requireScope(state, panel.campaignId, appId(runtime), guildId(interaction), 'rolls:create');
  assertBindingContext(state, panel, interaction, runtime);
  let destination = null;
  if (action.privacy !== 'public') {
    destination = await safeDmDestination(runtime, state, panel);
    if (!destination) throw Object.assign(new Error('This private roll requires an available DM-only campaign binding with safe permissions.'), { code: 'MISSING_DM_ROLL_DESTINATION' });
  }
  const result = rollDice(action.expression);
  const detail = rollDetail(interaction, action, result, current, manager);
  const roll = {
    id: id('roll'),
    campaignId: panel.campaignId,
    encounterId: panel.encounterId,
    characterId: current.characterId || '',
    userId: interaction.user.id,
    discordUserId: interaction.user.id,
    appId: appId(runtime),
    guildId: guildId(interaction),
    channelId: channelId(interaction),
    interactionId: String(interaction.id || ''),
    expression: result.original,
    normalizedExpression: result.normalized,
    rolls: result.rolls,
    keptIndexes: result.keptIndexes,
    modifier: result.modifier,
    total: result.total,
    privacy: action.privacy,
    deliveredToDm: action.privacy !== 'public',
    parserVersion: '1',
    metadata: {
      source: 'encounter-panel',
      panelId: panel.id,
      encounterId: panel.encounterId,
      actionId: action.id,
      actionRevision: panel.actionRevision,
      rollType: action.rollType,
      currentCombatantId: current.id,
      round: snapshot.encounter.round,
      currentTurnIndex: snapshot.currentIndex,
      managerOverride: Boolean(manager && current.discordUserId !== interaction.user.id),
      automaticStateMutation: false
    },
    createdAt: nowIso()
  };
  if (action.privacy === 'public') {
    emitMutation(runtime, 'roll.create', roll, interaction);
    await interaction.reply({ content: detail });
  } else {
    await destination.channel.send({ content: `${action.privacy === 'blind' ? 'Blind' : 'DM-only'} encounter action for <@${interaction.user.id}>\n${detail}` });
    emitMutation(runtime, 'roll.create', roll, interaction);
    await interaction.reply({ content: action.privacy === 'blind' ? `**${action.label}** was rolled and delivered privately to the DM.` : `${detail}\nDelivered to the configured DM-only destination.`, ephemeral: true });
  }
  await controller.refreshOne(panel).catch(() => null);
}

function validateMoreExecution(state, interaction, runtime) {
  const parsed = parseMoreButtonId(interaction.customId);
  if (!parsed) throw Object.assign(new Error('More Actions button is invalid.'), { code: 'DND_ENCOUNTER_BUTTON_INVALID' });
  const panel = state.encounterPanels.find((item) => item.panelToken === parsed.panelToken && item.status === 'active');
  if (!panel) throw Object.assign(new Error('Encounter panel is no longer active.'), { code: 'DND_ENCOUNTER_BUTTON_STALE' });
  requireScope(state, panel.campaignId, appId(runtime), guildId(interaction), 'rolls:create');
  assertBindingContext(state, panel, interaction, runtime);
  const snapshot = currentEncounterState(state, panel.encounterId);
  if (!snapshot.encounter || snapshot.encounter.status !== 'active' || parsed.actionRevision !== panel.actionRevision || parsed.round !== Number(snapshot.encounter.round || 1) || parsed.currentIndex !== snapshot.currentIndex) {
    throw Object.assign(new Error('This More Actions button belongs to a previous turn or action revision.'), { code: 'DND_ENCOUNTER_BUTTON_STALE' });
  }
  const current = snapshot.currentCombatant;
  const manager = managerFor(state, panel.campaignId, interaction.user.id);
  if (!current || !manager && (!current.discordUserId || current.discordUserId !== interaction.user.id)) {
    throw Object.assign(new Error('Only the current character or a campaign DM may view these actions.'), { code: 'DND_ENCOUNTER_BUTTON_FORBIDDEN' });
  }
  return { panel, snapshot, current, manager, actions: actionsForTurn(state, panel, current).slice(19) };
}

async function handleMoreActions(interaction, runtime) {
  const state = dndState(runtime);
  if (!state) throw Object.assign(new Error('D&D encounter data is unavailable.'), { code: 'DND_STATE_UNAVAILABLE' });
  const result = validateMoreExecution(state, interaction, runtime);
  if (!result.actions.length) {
    await interaction.reply({ content: 'No additional actions are available for this turn.', ephemeral: true });
    return;
  }
  await interaction.reply({
    content: `Additional actions for **${result.current.nameSnapshot || result.current.name || 'the current combatant'}**`,
    components: actionRows(result.actions.slice(0, 6), result.panel, result.snapshot.encounter, result.snapshot.currentIndex),
    ephemeral: true
  });
}

async function handleDndInteraction(interaction, runtime) {
  if (!isEncounterRollButton(interaction) && !isEncounterMoreButton(interaction)) return base.handleDndInteraction(interaction, runtime);
  try {
    const controller = runtime.__dndEncounterPanelController || installEncounterPanelRuntime(runtime);
    if (isEncounterMoreButton(interaction)) await handleMoreActions(interaction, runtime);
    else await handleEncounterRoll(interaction, runtime, controller);
    return true;
  } catch (error) {
    runtime.log?.('warn', `D&D encounter action rejected: ${error.code || error.message}`);
    const response = { content: error.message || 'The encounter action failed.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(response).catch(() => interaction.followUp(response).catch(() => {}));
    else await interaction.reply(response).catch(() => {});
    return true;
  }
}

function installEncounterPanelRuntime(runtime) {
  if (runtime.__dndEncounterPanelController) return runtime.__dndEncounterPanelController;
  const controller = new EncounterPanelController(runtime);
  runtime.__dndEncounterPanelController = controller;
  runtime.client.once('clientReady', () => controller.onConfigUpdate());
  if (runtime.client.isReady?.()) controller.onConfigUpdate();
  return controller;
}

module.exports = {
  ...base,
  handleDndInteraction,
  isEncounterRollButton,
  isEncounterMoreButton,
  installEncounterPanelRuntime,
  EncounterPanelController,
  safeDmDestination,
  handleEncounterRoll,
  handleMoreActions,
  validateMoreExecution,
  moreButtonId,
  parseMoreButtonId,
  actionRows
};
