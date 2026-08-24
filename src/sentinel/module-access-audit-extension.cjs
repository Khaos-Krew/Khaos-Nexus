'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const {
  auditModuleAccess,
  accessAuditPayload,
  findRoadmapChannel,
  reconcileAuditPanel
} = require('./module-access-audit.cjs');

const INSTALLED = Symbol.for('khaos.nexus.moduleAccessAudit.extension');
const INITIAL_AUDIT_DELAY_MS = 130_000;
const PERIODIC_AUDIT_MS = 15 * 60_000;

async function runModuleAccessAudit(client, config, state, options = {}) {
  const guildId = String(config.discord?.guildId || '');
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const audit = await auditModuleAccess(guild, { state, config, botId: client.user?.id });
  const channels = await guild.channels.fetch();
  const roadmap = findRoadmapChannel(channels);
  let panel = { created: false, duplicatesRemoved: 0, pinned: false };
  if (roadmap?.messages?.fetch && typeof roadmap.send === 'function') {
    panel = await reconcileAuditPanel(roadmap, accessAuditPayload(audit), client.user?.id);
  }
  return {
    reason: options.reason || 'manual',
    roadmapChannelId: String(roadmap?.id || ''),
    panelCreated: Boolean(panel.created),
    duplicatesRemoved: Number(panel.duplicatesRemoved || 0),
    pinned: Boolean(panel.pinned),
    ...audit
  };
}

function installModuleAccessAuditExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const state = new StateStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusModuleAccessAuditLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = async (reason) => {
        try {
          const result = await runModuleAccessAudit(client, config, state, { reason });
          if (result.skipped) return console.warn(`[Nexus Sentinal] module access preflight skipped: ${result.skipped}`);
          console.log(`[Nexus Sentinal] module access preflight (${reason}): ready=${result.counts.ready}/${result.counts.modules} attention=${result.counts.attention} pending=${result.counts.pending} accessRoles=${result.counts.accessRoles} buttonBindings=${result.counts.buttonBindings} staffChecked=${result.counts.staffMembers} panelCreated=${result.panelCreated} duplicatesRemoved=${result.duplicatesRemoved} pinned=${result.pinned} humanTestRequired=${result.humanInteractionStillRequired}`);
          for (const item of result.modules.filter((entry) => entry.status !== 'ready')) {
            console.warn(`[Nexus Sentinal] module access preflight ${item.status}: ${item.moduleId}: ${item.reason || 'needs review'}`);
          }
        } catch (error) {
          console.warn(`[Nexus Sentinal] module access preflight unavailable: ${String(error?.message || error).slice(0, 240)}`);
        }
      };
      const initial = setTimeout(() => run('startup'), INITIAL_AUDIT_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => run('periodic'), PERIODIC_AUDIT_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_AUDIT_DELAY_MS,
  PERIODIC_AUDIT_MS,
  runModuleAccessAudit,
  installModuleAccessAuditExtension
};
