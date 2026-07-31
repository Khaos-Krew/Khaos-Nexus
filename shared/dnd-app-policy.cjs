'use strict';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function storedPreference(state, appId) {
  const value = state?.appModulePreferences?.[appId]?.dndEnabled;
  return typeof value === 'boolean' ? value : null;
}

function appDndEnabled(state, appId) {
  const preference = storedPreference(state, appId);
  if (preference !== null) return preference;
  const app = state?.registeredApps?.find((item) => item.id === appId);
  return Boolean(app?.modules?.includes('dnd-workspace'));
}

function applyAppModulePreferences(input) {
  const state = clone(input || {});
  state.registeredApps = Array.isArray(state.registeredApps) ? state.registeredApps : [];
  state.appModulePreferences = state.appModulePreferences && typeof state.appModulePreferences === 'object'
    ? state.appModulePreferences
    : {};
  for (const app of state.registeredApps) {
    const enabled = appDndEnabled(state, app.id);
    const modules = new Set(Array.isArray(app.modules) ? app.modules : []);
    if (enabled) modules.add('dnd-workspace');
    else modules.delete('dnd-workspace');
    app.modules = [...modules];
    app.dndEnabled = enabled;
  }
  return state;
}

function setAppDndPreference(state, appId, enabled, updatedAt = new Date().toISOString()) {
  state.appModulePreferences ||= {};
  state.appModulePreferences[appId] = { dndEnabled: Boolean(enabled), updatedAt };
  return state.appModulePreferences[appId];
}

function isOwnerRole(role) {
  return role === 'owner' || role === 'local-admin';
}

module.exports = {
  storedPreference,
  appDndEnabled,
  applyAppModulePreferences,
  setAppDndPreference,
  isOwnerRole
};
