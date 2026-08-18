'use strict';

const electron = require('electron');

const refs = { autonomy: null, discordAuth: null };
let installed = false;

const OWNER_ONLY_CHANNELS = new Map([
  ['monitor:verify', 'Verify Application Monitor reporting'],
  ['monitor:process-queue', 'Send Application Monitor queue'],
  ['monitor:clear-queue', 'Clear Application Monitor queue'],
  ['monitor:send-current', 'Send the current Application Monitor error'],
  ['monitor:open-last-issue', 'Open the last Application Monitor issue']
]);

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__nexusSentinelOwnerMonitorCapture) return;

  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }

  Object.defineProperty(Captured, '__nexusSentinelOwnerMonitorCapture', { value: true });
  target[exportName] = Captured;
}

function assertOwner(channel) {
  const action = OWNER_ONLY_CHANNELS.get(String(channel || '')) || 'Use Application Monitor';
  if (!refs.autonomy?.assertAccess) {
    const error = new Error('Nexus Sentinel owner access is not ready yet.');
    error.code = 'SENTINEL_OWNER_ACCESS_NOT_READY';
    throw error;
  }
  return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
}

function patchIpcHandle() {
  const ipc = electron.ipcMain;
  if (!ipc || ipc.__nexusSentinelOwnerMonitorPatched) return;
  const originalHandle = ipc.handle.bind(ipc);

  ipc.handle = function sentinelOwnerOnlyHandle(channel, listener) {
    const name = String(channel || '');
    if (!OWNER_ONLY_CHANNELS.has(name)) return originalHandle(name, listener);
    return originalHandle(name, (event, ...args) => {
      assertOwner(name);
      return listener(event, ...args);
    });
  };

  Object.defineProperty(ipc, '__nexusSentinelOwnerMonitorPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  patchIpcHandle();
}

module.exports = {
  install,
  assertOwner,
  patchIpcHandle,
  OWNER_ONLY_CHANNELS,
  refs
};
