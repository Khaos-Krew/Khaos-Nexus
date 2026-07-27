'use strict';

(() => {
  const byId = (id) => document.getElementById(id);

  function apply(next) {
    const access = next?.autonomy?.access || {};
    const canOperate = Boolean(access.canOperate);
    const canOwn = Boolean(access.canOwn);
    const botStatus = next?.bot?.status || 'stopped';
    const monitor = next?.applicationMonitor || {};
    const update = next?.update || {};

    const set = (id, disabled) => {
      const element = byId(id);
      if (element) element.disabled = Boolean(disabled);
    };

    set('startButton', !canOperate || ['starting', 'connecting', 'online', 'restarting'].includes(botStatus));
    set('restartButton', !canOperate || ['stopped', 'stopping'].includes(botStatus));
    set('stopButton', !canOperate || ['stopped', 'stopping'].includes(botStatus));
    set('sendCurrentErrorButton', !canOperate || !next?.bot?.lastError);
    set('processMonitorQueueButton', !canOperate || !monitor.queueDepth || !next?.config?.hasGithubToken);
    set('downloadUpdateButton', !canOperate || update.status !== 'available');

    ['reportIssueButton', 'exportDiagnosticsButton', 'exportBackupButton', 'checkUpdatesButton'].forEach((id) => set(id, !canOperate));
    [
      'saveDiscordButton', 'saveAndStartButton', 'saveDiscordLoginButton', 'newServerButton',
      'saveServerButton', 'saveModulesButton', 'saveMonitorButton', 'verifyGithubButton',
      'removeGithubTokenButton', 'clearMonitorQueueButton', 'saveSettingsButton', 'installUpdateButton',
      'importBackupButton', 'openDataButton', 'saveAutonomySettingsButton', 'copyAccessRecoveryPathButton'
    ].forEach((id) => set(id, !canOwn));

    document.querySelectorAll('[data-server-test]').forEach((button) => { button.disabled = !canOperate; });
    document.querySelectorAll('[data-server-edit], [data-server-remove]').forEach((button) => { button.disabled = !canOwn; });
  }

  window.khaos.onState((next) => setTimeout(() => apply(next), 0));
  window.khaos.invoke('app:get-state').then((next) => setTimeout(() => apply(next), 250)).catch(() => {});
})();
