'use strict';

const discord = require('discord.js');
const { Events, GatewayIntentBits, IntentsBitField, MessageFlags } = discord;
const {
  TempVoiceController,
  presenceIntentReport,
  resolveTempVoiceConfig,
  vcCommand
} = require('./temp-voice.cjs');

const INSTALLED = Symbol.for('khaos.nexus.sentinal.tempVoice.constructor');
const LOGIN_WRAPPED = Symbol.for('khaos.nexus.sentinal.tempVoice.login');
const LISTENERS = Symbol.for('khaos.nexus.sentinal.tempVoice.listeners');

function withTempVoiceIntents(options = {}, env = process.env) {
  const intents = new IntentsBitField(options.intents || []);
  if (resolveTempVoiceConfig(env).requestPresenceIntent) intents.add(GatewayIntentBits.GuildPresences);
  return { ...options, intents };
}

async function registerVcCommand(guild) {
  const definition = vcCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition.name;
}

function installTempVoiceExtension(options = {}) {
  const logger = options.logger || console;
  const env = options.env || process.env;
  const config = resolveTempVoiceConfig(env);
  if (!discord[INSTALLED]) {
    discord[INSTALLED] = true;
    const BaseClient = discord.Client;
    class NexusSentinalTempVoiceClient extends BaseClient {
      constructor(clientOptions = {}) {
        super(withTempVoiceIntents(clientOptions, env));
      }
    }
    discord.Client = NexusSentinalTempVoiceClient;
    logger.log?.(presenceIntentReport(config));
  }
  const ActiveClient = discord.Client;
  if (Object.prototype.hasOwnProperty.call(ActiveClient.prototype, LOGIN_WRAPPED)) return ActiveClient;
  ActiveClient.prototype[LOGIN_WRAPPED] = true;
  const originalLogin = ActiveClient.prototype.login;

  ActiveClient.prototype.login = function nexusTempVoiceLogin(...args) {
    if (!this[LISTENERS] && config.enabled && config.guildId && config.lobbySource !== 'invalid' && config.categorySource !== 'invalid') {
      this[LISTENERS] = true;
      const controller = new TempVoiceController({ env });
      this.on(Events.VoiceStateUpdate, (oldState, newState) => {
        void controller.handleVoiceState(oldState, newState).catch((error) => {
          console.warn(`[Nexus Sentinal] temp-voice voice class=${String(error?.name || 'Error').slice(0, 40)}`);
        });
      });
      if (config.requestPresenceIntent) {
        this.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
          void controller.handlePresence(oldPresence, newPresence).catch((error) => {
            console.warn(`[Nexus Sentinal] temp-voice presence class=${String(error?.name || 'Error').slice(0, 40)}`);
          });
        });
      }
      this.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'vc') return;
        try {
          if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          }
          const result = await controller.handleCommand(interaction);
          const content = String(result?.content || 'Done.').slice(0, 1900);
          if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
          else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        } catch (error) {
          const content = `⚠️ ${String(error?.message || error)}`.slice(0, 1900);
          try {
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
          } catch (replyError) {
            console.warn(`[Nexus Sentinal] temp-voice reply class=${String(replyError?.name || 'Error').slice(0, 40)}`);
          }
        }
      });
      this.once(Events.ClientReady, async () => {
        try {
          const guild = await this.guilds.fetch(config.guildId);
          const lobby = await controller.ensureLobby(guild);
          logger.log?.(`[Nexus Sentinal] temp-voice lobby=${lobby.action || 'unknown'} channel=${lobby.channelId || 'none'}`);
          await registerVcCommand(guild);
          logger.log?.(`[Nexus Sentinal] registered /vc in guild ${guild.id}`);
          await controller.reconcile(guild);
        } catch (error) {
          console.warn(`[Nexus Sentinal] temp-voice startup class=${String(error?.name || 'Error').slice(0, 40)}`);
        }
      });
    }
    return originalLogin.apply(this, args);
  };
  return ActiveClient;
}

module.exports = {
  installTempVoiceExtension,
  registerVcCommand,
  withTempVoiceIntents
};
