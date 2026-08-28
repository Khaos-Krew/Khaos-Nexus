'use strict';

const discord = require('discord.js');
const { Events, PermissionFlagsBits } = discord;
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const { getModule } = require('../backend/modules/catalog.cjs');
const { formatActionResult } = require('./action-formatters.cjs');

const INSTALLED = Symbol.for('khaos.nexus.mentionResponse.constructor');
const PENDING_TTL_MS = 2 * 60 * 1000;

const DENIALS = [
  "You don't have enough badges to command me. Find an Admin and try again.",
  'Nice try. Your badge collection is insufficient for that command.',
  'Command rejected. You are currently suffering from a severe lack of Admin.',
  'I checked your credentials. Adorable. Ask an Admin.',
  'That button is above your pay grade. Go find someone with more badges.',
  'Unauthorized. I require at least one shiny Admin badge before I start breaking things.'
];

const ALIVE_REPLIES = [
  'Unfortunately for everyone else, yes.',
  'Online, watching, and judging your mod list.',
  'Still here. The Nexus has not managed to get rid of me yet.',
  'Operational. Suspiciously operational.',
  'Alive is a strong word. Functional? Absolutely.'
];

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function directMentionText(message, client) {
  if (!message?.content || !client?.user?.id) return '';
  if (!message.mentions?.users?.has?.(client.user.id)) return '';
  const mention = new RegExp(`<@!?${client.user.id}>`, 'g');
  return String(message.content).replace(mention, ' ').replace(/\s+/g, ' ').trim();
}

function memberIsAdmin(message, config) {
  const member = message?.member;
  if (!member) return false;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  if ((config.discord?.ownerUserIds || []).includes(String(message.author.id))) return true;
  const roles = member.roles?.cache;
  if (roles && (config.discord?.operatorRoleIds || []).some((id) => roles.has(String(id)))) return true;
  return false;
}

function resolveModule(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(ark|asa|ragnarok|genesis|gen1)\b/.test(value)) return 'ark';
  if (/\bpalworld\b/.test(value)) return 'palworld';
  if (/\b(minecraft|mc)\b/.test(value)) return 'minecraft';
  return 'ark';
}

function resolveIntent(text) {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return { kind: 'chat', reply: 'You rang?' };
  if (/\b(you alive|are you alive|u alive|awake|you there)\b/.test(value)) return { kind: 'chat', reply: pick(ALIVE_REPLIES) };
  if (/^(confirm|do it|confirmed|yes,? do it|yes do it)[.!?]*$/.test(value)) return { kind: 'confirm' };
  if (/^(cancel|never mind|nevermind|abort)[.!?]*$/.test(value)) return { kind: 'cancel' };

  const moduleId = resolveModule(value);
  if (/\b(restart|reboot)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'restart', input: extractRestartInput(value) };
  if (/\b(save|saveworld|save world)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'save', input: '' };
  if (/\b(broadcast|announce|announcement)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'broadcast', input: extractBroadcast(value) };
  if (/\b(mod updates?|mods?|mod list)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'mods', input: '' };
  if (/\b(players?|who(?:'s| is)? online|how many(?: people| players)?(?: are)? online)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'players', input: '' };
  if (/\b(status|online|offline|healthy|health|how(?:'s| is) .*looking)\b/.test(value)) return { kind: 'action', moduleId, actionId: 'status', input: '' };
  if (/\b(help|what can you do|commands?)\b/.test(value)) return { kind: 'help' };
  return { kind: 'chat', reply: "I'm listening. Try asking me about ARK status, players, mods, or tell me to save/broadcast/restart if you've got the badges for it." };
}

function extractBroadcast(text) {
  return String(text || '')
    .replace(/^.*?\b(?:broadcast|announce|announcement)\b\s*(?:to\s+)?(?:ark|asa|palworld|minecraft|mc)?\s*[:,-]?\s*/i, '')
    .trim();
}

function extractRestartInput(text) {
  const seconds = String(text || '').match(/\b(\d{1,5})\s*(seconds?|secs?|s)\b/i);
  if (seconds) return seconds[1];
  const minutes = String(text || '').match(/\b(\d{1,4})\s*(minutes?|mins?|m)\b/i);
  if (minutes) return String(Number(minutes[1]) * 60);
  return '';
}

function capabilityFor(moduleId, actionId) {
  return getModule(moduleId)?.capabilities?.find((capability) => capability.id === actionId) || null;
}

function isPrivileged(capability) {
  return Boolean(capability && capability.requiredRole && capability.requiredRole !== 'viewer');
}

function helpText() {
  return [
    '**Sentinal mention controls**',
    'Ask me naturally about **ARK status**, **players**, or **mods**.',
    'Admins can also ask me to **save**, **broadcast**, or **restart** supported servers.',
    'High-impact actions still require confirmation. Slash commands remain available when you want exact controls.'
  ].join('\n');
}

function installMentionResponseExtension(options = {}) {
  const logger = options.logger || console;
  if (discord[INSTALLED]) return discord.Client;
  discord[INSTALLED] = true;

  const BaseClient = discord.Client;
  class NexusSentinalMentionClient extends BaseClient {
    constructor(clientOptions = {}) {
      super(clientOptions);
      const config = loadConfig();
      const backend = new BackendClient(config);
      const pending = new Map();

      this.on(Events.MessageCreate, async (message) => {
        try {
          if (!message?.guild || message.author?.bot) return;
          if (String(message.guild.id) !== String(config.discord?.guildId || '')) return;
          const text = directMentionText(message, this);
          if (!text && !message.mentions?.users?.has?.(this.user?.id)) return;

          const intent = resolveIntent(text);
          const key = String(message.author.id);

          if (intent.kind === 'chat') {
            await message.reply({ content: intent.reply, allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }
          if (intent.kind === 'help') {
            await message.reply({ content: helpText(), allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }
          if (intent.kind === 'cancel') {
            pending.delete(key);
            await message.reply({ content: 'Cancelled. Crisis dramatically averted.', allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }
          if (intent.kind === 'confirm') {
            const item = pending.get(key);
            if (!item || item.expiresAt < Date.now()) {
              pending.delete(key);
              await message.reply({ content: "I don't have a pending command for you. Either it expired or the universe healed itself.", allowedMentions: { repliedUser: false, parse: [] } });
              return;
            }
            if (!memberIsAdmin(message, config)) {
              pending.delete(key);
              logger.warn?.(`[Nexus Sentinal] mention action denied during confirmation actor=${key} module=${item.moduleId} action=${item.actionId}`);
              await message.reply({ content: pick(DENIALS), allowedMentions: { repliedUser: false, parse: [] } });
              return;
            }
            pending.delete(key);
            const result = await backend.invoke(item.moduleId, item.actionId, { input: item.input }, {
              role: 'owner', actorId: key, confirmed: true
            });
            logger.log?.(`[Nexus Sentinal] mention action confirmed actor=${key} module=${item.moduleId} action=${item.actionId} ok=${Boolean(result?.ok)}`);
            await message.reply(formatActionResult(item.moduleId, item.actionId, result));
            return;
          }

          const capability = capabilityFor(intent.moduleId, intent.actionId);
          if (!capability) {
            await message.reply({ content: `I know what you asked, but **${intent.actionId}** is not an approved ${intent.moduleId.toUpperCase()} action.`, allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }

          if (isPrivileged(capability) && !memberIsAdmin(message, config)) {
            logger.warn?.(`[Nexus Sentinal] mention action denied actor=${key} module=${intent.moduleId} action=${intent.actionId}`);
            await message.reply({ content: pick(DENIALS), allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }

          if (intent.actionId === 'broadcast' && !intent.input) {
            await message.reply({ content: 'I can broadcast it, but you forgot the part where you tell me what to say.', allowedMentions: { repliedUser: false, parse: [] } });
            return;
          }

          const role = isPrivileged(capability) ? 'owner' : 'viewer';
          const result = await backend.invoke(intent.moduleId, intent.actionId, { input: intent.input || '' }, {
            role, actorId: key, confirmed: false
          });

          if (result?.code === 'CONFIRMATION_REQUIRED') {
            pending.set(key, {
              moduleId: intent.moduleId,
              actionId: intent.actionId,
              input: intent.input || '',
              expiresAt: Date.now() + PENDING_TTL_MS
            });
            logger.log?.(`[Nexus Sentinal] mention action awaiting confirmation actor=${key} module=${intent.moduleId} action=${intent.actionId}`);
            await message.reply({
              content: `⚠️ **Confirmation required**\n${String(result.message || 'That action is high-impact.').slice(0, 1400)}\n\nMention me with **confirm** within 2 minutes to continue, or **cancel** to abort.`,
              allowedMentions: { repliedUser: false, parse: [] }
            });
            return;
          }

          logger.log?.(`[Nexus Sentinal] mention action actor=${key} module=${intent.moduleId} action=${intent.actionId} privileged=${isPrivileged(capability)} ok=${Boolean(result?.ok)}`);
          await message.reply(formatActionResult(intent.moduleId, intent.actionId, result));
        } catch (error) {
          logger.error?.(`[Nexus Sentinal] mention response failed: ${String(error?.message || error).slice(0, 500)}`);
          try {
            await message.reply({ content: 'Something tripped over a cable in the Nexus. The command did not complete.', allowedMentions: { repliedUser: false, parse: [] } });
          } catch {}
        }
      });

      const cleanup = setInterval(() => {
        const now = Date.now();
        for (const [key, item] of pending) if (item.expiresAt < now) pending.delete(key);
      }, 60_000);
      cleanup.unref?.();
    }
  }

  discord.Client = NexusSentinalMentionClient;
  logger.log?.('[Nexus Sentinal] direct mention personality/action router installed.');
  return NexusSentinalMentionClient;
}

module.exports = {
  DENIALS,
  ALIVE_REPLIES,
  directMentionText,
  memberIsAdmin,
  resolveModule,
  resolveIntent,
  capabilityFor,
  installMentionResponseExtension
};
