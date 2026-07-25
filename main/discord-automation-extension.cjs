'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const {
  normalizeDiscordAutomationConfig,
  normalizeRoleMenu,
  normalizeLayout,
  normalizeAuditEntry
} = require('../shared/discord-automation.cjs');
const { DiscordAutomationService } = require('./services/discord-automation-service.cjs');

const refs = { configStore: null, logger: null, autonomy: null, discordAuth: null, supervisor: null, service: null };
let installed = false;

function migrationStepIds() {
  try { return require('../shared/module-catalog.cjs').MIGRATION_STEPS.map((step) => step.id); }
  catch { return ['inventory', 'data', 'services', 'interface', 'access', 'validation']; }
}
function promoteCatalog() {
  const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
  const updates = {
    'role-menus': {
      stage: 'live', launchView: 'discord-automation',
      description: 'Publish protected button role menus for games, platforms, pronouns, notifications, and category visibility.',
      features: ['Button role menus', 'Toggle and exclusive modes', 'Discord role hierarchy checks', 'Persistent message updates', 'Member self-service roles']
    },
    'color-roles': {
      stage: 'live', launchView: 'discord-automation',
      description: 'Exclusive name-color menus with visual previews and safe role hierarchy validation.',
      features: ['Hex color previews', 'One-color-at-a-time behavior', 'Button publishing', 'Staff-compatible hierarchy checks', 'Automatic sibling-role cleanup']
    },
    'discord-organization': {
      stage: 'live', launchView: 'discord-automation',
      description: 'Preview and apply additive Discord category, text, announcement, and voice-channel layouts without deleting existing content.',
      features: ['Layout blueprints', 'Additive preview', 'Duplicate prevention', 'Text, announcement, and voice channels', 'No destructive synchronization']
    },
    'discord-audit-logging': {
      stage: 'live', launchView: 'discord-automation',
      description: 'Structured local audit history with optional protected Discord-channel publishing.',
      features: ['Actor and role context', 'Success, blocked, and failed outcomes', 'Bounded retention', 'JSON export', 'Optional Discord audit channel']
    }
  };
  for (const [id, patch] of Object.entries(updates)) {
    const module = MODULE_CATALOG.find((item) => item.id === id);
    if (module) Object.assign(module, patch);
  }
}
function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) refs.service = new DiscordAutomationService({ configStore: refs.configStore, logger: refs.logger });
  return refs.service;
}
function ensureConfig(store) {
  const current = store.config.discordAutomation;
  const normalized = normalizeDiscordAutomationConfig(current || {});
  let changed = JSON.stringify(current || null) !== JSON.stringify(normalized);
  store.config.discordAutomation = normalized;
  const states = store.config.general?.moduleMigration;
  if (states && typeof states === 'object') {
    for (const id of ['role-menus', 'color-roles', 'discord-organization', 'discord-audit-logging']) {
      if (states[id] && !states[id].updatedAt) {
        states[id].enabled = true;
        states[id].completedSteps = migrationStepIds();
        changed = true;
      }
    }
  }
  if (changed) store.saveConfig();
}
function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDiscordAutomationPatched) return;
  class DiscordAutomationConfigStore extends Original {
    constructor(...args) { super(...args); refs.configStore = this; ensureConfig(this); ensureService(); }
    getDiscordAutomation() { ensureConfig(this); return JSON.parse(JSON.stringify(this.config.discordAutomation)); }
    upsertRoleMenu(input) {
      ensureConfig(this); const item = normalizeRoleMenu(input); const list = this.config.discordAutomation.roleMenus;
      const index = list.findIndex((entry) => entry.id === item.id); if (index >= 0) list[index] = item; else list.push(item);
      this.config.discordAutomation = normalizeDiscordAutomationConfig(this.config.discordAutomation); this.saveConfig(); return item;
    }
    setRoleMenuPublication(id, patch = {}) {
      ensureConfig(this); const index = this.config.discordAutomation.roleMenus.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected role menu was not found.');
      this.config.discordAutomation.roleMenus[index] = normalizeRoleMenu({ ...this.config.discordAutomation.roleMenus[index], ...patch, id });
      this.saveConfig(); return this.config.discordAutomation.roleMenus[index];
    }
    removeRoleMenu(id) {
      ensureConfig(this); this.config.discordAutomation.roleMenus = this.config.discordAutomation.roleMenus.filter((item) => item.id !== id); this.saveConfig(); return this.getDiscordAutomation();
    }
    upsertLayout(input) {
      ensureConfig(this); const item = normalizeLayout(input); const list = this.config.discordAutomation.layouts;
      const index = list.findIndex((entry) => entry.id === item.id); if (index >= 0) list[index] = item; else list.push(item);
      this.config.discordAutomation = normalizeDiscordAutomationConfig(this.config.discordAutomation); this.saveConfig(); return item;
    }
    setLayoutApplied(id, appliedAt) {
      ensureConfig(this); const index = this.config.discordAutomation.layouts.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('The selected Discord layout was not found.');
      this.config.discordAutomation.layouts[index] = normalizeLayout({ ...this.config.discordAutomation.layouts[index], id, lastAppliedAt: appliedAt });
      this.saveConfig(); return this.config.discordAutomation.layouts[index];
    }
    removeLayout(id) {
      if (id === 'default-nexus-layout') throw new Error('The built-in Nexus layout cannot be removed. Duplicate and edit it instead.');
      ensureConfig(this); this.config.discordAutomation.layouts = this.config.discordAutomation.layouts.filter((item) => item.id !== id); this.saveConfig(); return this.getDiscordAutomation();
    }
    setDiscordAuditSettings(input = {}) {
      ensureConfig(this);
      this.config.discordAutomation = normalizeDiscordAutomationConfig({ ...this.config.discordAutomation, audit: { ...this.config.discordAutomation.audit, ...input } });
      this.saveConfig(); return this.config.discordAutomation.audit;
    }
    appendDiscordAudit(input) {
      ensureConfig(this); const entry = normalizeAuditEntry(input);
      const retention = this.config.discordAutomation.audit.retention;
      this.config.discordAutomation.auditEntries = [...this.config.discordAutomation.auditEntries, entry].slice(-retention);
      this.saveConfig(); return entry;
    }
    clearDiscordAudit() { ensureConfig(this); this.config.discordAutomation.auditEntries = []; this.saveConfig(); return []; }
  }
  Object.defineProperty(DiscordAutomationConfigStore, '__khaosDiscordAutomationPatched', { value: true });
  target.ConfigStore = DiscordAutomationConfigStore;
}
function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}
function actor() {
  const auth = refs.discordAuth?.getState?.() || {};
  return { actorId: String(auth.user?.id || ''), actorName: String(auth.user?.globalName || auth.user?.username || 'Local operator'), actorRole: activeRole() };
}
function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 };
  if ((rank[activeRole()] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}
async function audit(input) {
  if (!refs.configStore) return null;
  const entry = refs.configStore.appendDiscordAudit({ ...actor(), ...input, time: input.time || new Date().toISOString() });
  refs.logger?.write?.(entry.outcome === 'failed' ? 'error' : entry.outcome === 'blocked' ? 'warn' : 'info', `Discord automation: ${entry.action}`, { auditId: entry.id, target: entry.targetName, summary: entry.summary }, 'discord-automation');
  try { await ensureService()?.publishAuditEntry(entry, refs.configStore.getDiscordAutomation().audit); }
  catch (error) { refs.logger?.warn?.('Discord audit entry could not be published to Discord.', { message: error.message, auditId: entry.id }); }
  broadcast();
  return entry;
}
function pushBotConfig() {
  if (refs.supervisor?.child) refs.supervisor.child.postMessage({ type: 'config-update', payload: refs.configStore.getRuntimeBootstrap() });
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath); const Original = target[exportName];
  if (!Original || Original.__khaosDiscordAutomationCapturePatched) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; ensureService(); }
    botPath() {
      if (refName === 'supervisor') {
        return electron.app.isPackaged
          ? path.join(process.resourcesPath, 'app.asar', 'bot', 'entry.cjs')
          : path.join(__dirname, '..', 'bot', 'entry.cjs');
      }
      return super.botPath?.();
    }
    handleMessage(message) {
      if (refName === 'supervisor' && message?.type === 'discord-audit') {
        audit({ ...message.payload, category: 'member-role-interaction' }).catch(() => {});
        return;
      }
      return super.handleMessage(message);
    }
  }
  Object.defineProperty(Captured, '__khaosDiscordAutomationCapturePatched', { value: true });
  target[exportName] = Captured;
}
function payload() {
  const publicConfig = refs.configStore.getPublicConfig();
  return {
    role: activeRole(), guildId: publicConfig.discord?.guildId || '', botConfigured: Boolean(publicConfig.hasDiscordToken),
    automation: refs.configStore.getDiscordAutomation(), bot: refs.supervisor?.getState?.() || null
  };
}
function broadcast() {
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('discord-automation:update', state);
}
function registerIpc() {
  if (registerIpc.done || !refs.configStore) return; registerIpc.done = true;
  electron.ipcMain.handle('discord-automation:get', () => { assertAccess('viewer', 'View Discord Automation'); return payload(); });
  electron.ipcMain.handle('discord-automation:resources', (_event, guildId) => { assertAccess('operator', 'Load Discord roles and channels'); return ensureService().resources(guildId); });
  electron.ipcMain.handle('discord-automation:save-menu', async (_event, menu) => {
    assertAccess('operator', 'Save Discord role menus'); const saved = refs.configStore.upsertRoleMenu(menu); pushBotConfig();
    await audit({ action: 'role-menu.saved', outcome: 'success', targetType: 'role-menu', targetId: saved.id, targetName: saved.name, summary: `Saved ${saved.kind} menu with ${saved.options.length} options.` });
    return payload();
  });
  electron.ipcMain.handle('discord-automation:remove-menu', async (_event, id) => {
    assertAccess('operator', 'Remove Discord role menus'); const existing = refs.configStore.getDiscordAutomation().roleMenus.find((item) => item.id === id);
    if (existing?.messageId) throw new Error('Delete the published Discord message before removing its configuration.');
    refs.configStore.removeRoleMenu(id); pushBotConfig(); await audit({ action: 'role-menu.removed', outcome: 'success', targetType: 'role-menu', targetId: id, targetName: existing?.name || id, summary: 'Removed role-menu configuration.' }); return payload();
  });
  electron.ipcMain.handle('discord-automation:publish-menu', async (_event, id) => {
    assertAccess('operator', 'Publish Discord role menus'); const menu = refs.configStore.getDiscordAutomation().roleMenus.find((item) => item.id === id);
    if (!menu) throw new Error('The selected role menu was not found.');
    try {
      const result = await ensureService().publishRoleMenu(menu);
      refs.configStore.setRoleMenuPublication(id, { guildId: result.guildId, channelId: result.channelId, messageId: result.messageId, publishedAt: result.publishedAt });
      pushBotConfig(); await audit({ action: 'role-menu.published', outcome: 'success', targetType: 'role-menu', targetId: id, targetName: menu.name, summary: result.replaced ? 'Published a replacement role-menu message.' : 'Updated the persistent role-menu message.' });
      return { result, state: payload() };
    } catch (error) { await audit({ action: 'role-menu.published', outcome: 'failed', targetType: 'role-menu', targetId: id, targetName: menu.name, summary: error.message }); throw error; }
  });
  electron.ipcMain.handle('discord-automation:delete-published-menu', async (_event, id) => {
    assertAccess('operator', 'Delete published Discord role menus'); const menu = refs.configStore.getDiscordAutomation().roleMenus.find((item) => item.id === id);
    if (!menu) throw new Error('The selected role menu was not found.');
    await ensureService().deletePublishedMenu(menu); refs.configStore.setRoleMenuPublication(id, { messageId: '', publishedAt: null }); pushBotConfig();
    await audit({ action: 'role-menu.unpublished', outcome: 'success', targetType: 'role-menu', targetId: id, targetName: menu.name, summary: 'Deleted the published Discord message.' }); return payload();
  });
  electron.ipcMain.handle('discord-automation:save-layout', async (_event, layout) => {
    assertAccess('operator', 'Save Discord server layouts'); const saved = refs.configStore.upsertLayout(layout);
    await audit({ action: 'layout.saved', outcome: 'success', targetType: 'discord-layout', targetId: saved.id, targetName: saved.name, summary: `Saved additive layout with ${saved.categories.length} categories.` }); return payload();
  });
  electron.ipcMain.handle('discord-automation:remove-layout', async (_event, id) => {
    assertAccess('operator', 'Remove Discord server layouts'); const existing = refs.configStore.getDiscordAutomation().layouts.find((item) => item.id === id); refs.configStore.removeLayout(id);
    await audit({ action: 'layout.removed', outcome: 'success', targetType: 'discord-layout', targetId: id, targetName: existing?.name || id, summary: 'Removed layout configuration.' }); return payload();
  });
  electron.ipcMain.handle('discord-automation:preview-layout', async (_event, id) => {
    assertAccess('operator', 'Preview Discord server layouts'); const layout = refs.configStore.getDiscordAutomation().layouts.find((item) => item.id === id);
    if (!layout) throw new Error('The selected Discord layout was not found.'); return ensureService().previewLayout(layout);
  });
  electron.ipcMain.handle('discord-automation:apply-layout', async (_event, id) => {
    assertAccess('owner', 'Apply Discord server layouts'); const layout = refs.configStore.getDiscordAutomation().layouts.find((item) => item.id === id);
    if (!layout) throw new Error('The selected Discord layout was not found.');
    try {
      const result = await ensureService().applyLayout(layout); refs.configStore.setLayoutApplied(id, result.appliedAt);
      await audit({ action: 'layout.applied', outcome: 'success', targetType: 'discord-layout', targetId: id, targetName: layout.name, summary: `Created ${result.created.length} missing categories or channels. Existing content was not deleted.` }); return { result, state: payload() };
    } catch (error) { await audit({ action: 'layout.applied', outcome: 'failed', targetType: 'discord-layout', targetId: id, targetName: layout.name, summary: error.message }); throw error; }
  });
  electron.ipcMain.handle('discord-automation:save-audit', async (_event, settings) => {
    assertAccess('owner', 'Change Discord audit settings'); const saved = refs.configStore.setDiscordAuditSettings(settings);
    await audit({ action: 'audit.settings-updated', outcome: 'success', targetType: 'audit-settings', targetName: 'Discord Audit', summary: saved.publishToDiscord ? 'Local and Discord audit publishing enabled.' : 'Local audit history enabled; Discord publishing disabled.' }); return payload();
  });
  electron.ipcMain.handle('discord-automation:clear-audit', () => { assertAccess('owner', 'Clear Discord automation audit history'); refs.configStore.clearDiscordAudit(); broadcast(); return payload(); });
  electron.ipcMain.handle('discord-automation:export-audit', async () => {
    assertAccess('operator', 'Export Discord automation audit history');
    const result = await electron.dialog.showSaveDialog({ title: 'Export Discord automation audit log', defaultPath: path.join(electron.app.getPath('documents'), `khaos-nexus-discord-audit-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: 'JSON audit log', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), entries: refs.configStore.getDiscordAutomation().auditEntries }, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
}
function patchBrowserLoader() {
  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosDiscordAutomationUiPatched) return;
  const original = prototype.loadFile;
  prototype.loadFile = function patchedLoadFile(...args) {
    this.webContents.once('did-finish-load', () => {
      this.webContents.executeJavaScript(`(() => {
        if (!document.querySelector('link[href="discord-automation.css"]')) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'discord-automation.css'; document.head.appendChild(link); }
        if (!document.querySelector('script[src="discord-automation.js"]')) { const script = document.createElement('script'); script.src = 'discord-automation.js'; script.defer = true; document.body.appendChild(script); }
      })();`).catch(() => {});
    });
    return original.apply(this, args);
  };
  Object.defineProperty(prototype, '__khaosDiscordAutomationUiPatched', { value: true });
}
function install() {
  if (installed) return; installed = true; promoteCatalog(); patchConfigStore();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/bot-supervisor.cjs', 'BotSupervisor', 'supervisor');
  patchBrowserLoader();
  electron.app.whenReady().then(() => { const wait = () => { if (refs.configStore && refs.logger) { ensureService(); registerIpc(); } else setTimeout(wait, 100); }; wait(); });
}

module.exports = { install, refs, ensureConfig, audit };
