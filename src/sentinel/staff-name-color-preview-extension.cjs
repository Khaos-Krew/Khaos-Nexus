'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { buildStaffNameColorPreview } = require('./staff-name-color-preview.cjs');

const INSTALLED = Symbol.for('khaos.nexus.staffNameColorPreview.extension');

function previewRoleLabel(role) {
  return `${String(role?.name || 'unknown').replace(/[\r\n]+/g, ' ').slice(0, 80)}#${String(role?.id || '')}:${String(role?.hexColor || '#000000')}:pos=${Number(role?.position || 0)}`;
}

function previewSummary(preview = {}) {
  const candidateIds = new Set((preview.proposedRoleIds || []).map(String));
  const blockedIds = new Set((preview.blockedRoleIds || []).map(String));
  const roles = Array.isArray(preview.protectedStaffRoles) ? preview.protectedStaffRoles : [];
  const candidates = roles.filter((role) => candidateIds.has(String(role.id))).slice(0, 12).map(previewRoleLabel);
  const blocked = roles.filter((role) => blockedIds.has(String(role.id))).slice(0, 12).map((role) => `${previewRoleLabel(role)}:${(role.blockers || []).join('+') || 'blocked'}`);
  return `selectable=${Number(preview.selectableColorRoleCount || 0)} candidates=${candidateIds.size} blocked=${blockedIds.size} candidateRoles=${candidates.length ? `[${candidates.join(' | ')}]` : '[none]'} blockedRoles=${blocked.length ? `[${blocked.join(' | ')}]` : '[none]'}`;
}

function installStaffNameColorPreviewExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusStaffNameColorPreviewLogin(...args) {
    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        const roles = await guild.roles.fetch();
        const me = guild.members?.me || await guild.members.fetchMe();
        const preview = buildStaffNameColorPreview({
          guildId: String(guild.id || ''),
          roles,
          botHighestRole: me?.roles?.highest || null,
          config
        });
        console.log(`[Nexus Sentinal] staff name color preview: ${previewSummary(preview)}`);
      } catch (error) {
        console.warn(`[Nexus Sentinal] staff name color preview unavailable: ${String(error?.message || error).slice(0, 240)}`);
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installStaffNameColorPreviewExtension, previewRoleLabel, previewSummary };
