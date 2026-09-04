'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { buildStaffNameColorPreview } = require('./staff-name-color-preview.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'staff-name-color-preview';

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

async function runStaffNameColorPreview(client, config, guildId = String(config.discord?.guildId || '')) {
  if (!guildId) return { skipped: 'guild-not-configured' };
  try {
    const guild = await client.guilds.fetch(guildId);
    const roles = await guild.roles.fetch();
    const me = guild.members?.me || await guild.members.fetchMe();
    const preview = buildStaffNameColorPreview({
      guildId: String(guild.id || ''),
      roles,
      botHighestRole: me?.roles?.highest || null,
      config
    });
    console.log(`[Nexus Sentinal] staff name color preview: ${previewSummary(preview)}`);
    return { skipped: '', preview };
  } catch (error) {
    console.warn(`[Nexus Sentinal] staff name color preview unavailable: ${String(error?.message || error).slice(0, 240)}`);
    return { skipped: 'unavailable' };
  }
}

function installStaffNameColorPreviewExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'discord-staff-ui',
    priority: 125,
    async run(client) {
      await runStaffNameColorPreview(client, config);
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  installStaffNameColorPreviewExtension,
  previewRoleLabel,
  previewSummary,
  runStaffNameColorPreview
};
