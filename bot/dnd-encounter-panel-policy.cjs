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
  validateButtonExecution
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
function bindingFor(state, panel) {
  return (state.bindings || []).find((item) => item.id === panel.bindingId && item.active !== false) || null;
}
function panelForMessage(state, panelToken) {
  return state.encounterPanels.find((item) => item.panelToken === panelToken) || null;
}
function dmBinding(state, panel, runtime) {
  return (state.bindings || []).find((item) => item.active !== false && item.campaignId === panel.campaignId && item.appId === appId(runtime) && item.guildId === panel.guildId && item.purpose === 'dm_private') || null;
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
    if (panel.status === 'completed' || rendered.snapshot.encounter?.status === 'completed' || rendered.snapshot.encounter?.status === 'archived') rendered.body.components = [];
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

async function handleEncounterRoll(interaction, runtime, controller) {
  const state = dndState(runtime);
  if (!state) throw Object.assign(new Error('D&D encounter data is unavailable.'), { code: 'DND_STATE_UNAVAILABLE' });
  const execution = validateButtonExecution(state, { customId: interaction.customId, discordUserId: interaction.user.id });
  const { panel, action, snapshot, current, manager } = execution;
  requireScope(state, panel.campaignId, appId(runtime), guildId(interaction), 'rolls:create');
  const binding = bindingFor(state, panel);
  if (!binding || binding.appId !== appId(runtime) || binding.guildId !== guildId(interaction) || binding.resourceId !== channelId(interaction)) {
    throw Object.assign(new Error('This encounter action is not valid in the current Discord resource.'), { code: 'DND_ENCOUNTER_BUTTON_CONTEXT' });
  }
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

async function handleDndInteraction(interaction, runtime) {
  if (!isEncounterRollButton(interaction)) return base.handleDndInteraction(interaction, runtime);
  try {
    const controller = runtime.__dndEncounterPanelController || installEncounterPanelRuntime(runtime);
    await handleEncounterRoll(interaction, runtime, controller);
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
  installEncounterPanelRuntime,
  EncounterPanelController,
  safeDmDestination,
  handleEncounterRoll
};
