'use strict';

// Citadel exposes this server beneath a per-service folder while the normal
// Sentinel config paths are already stored as fully-qualified SFTP paths.
// Patch only the recovery module's captured settings function so the rest of
// Sentinel keeps its existing path behavior unchanged.
const sftpConfig = require('./ark-sftp-config.cjs');
const original = sftpConfig.sftpSettingsFromEnv;

sftpConfig.sftpSettingsFromEnv = function recoverySftpSettings(prefix = 'ARK_GEN1') {
  const settings = original(prefix);
  return {
    ...settings,
    root: settings.root || '72.46.128.202_8080',
  };
};

require('./citadel-gen1-api-bypass-recovery-startup.cjs');

// Restore the shared export immediately. The recovery module already captured
// the scoped function above; modules loaded afterward see the normal function.
sftpConfig.sftpSettingsFromEnv = original;
