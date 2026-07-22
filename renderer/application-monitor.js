'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  let current = null;

  function titleCase(value) {
    return String(value || 'idle').replace(/(^|[-_\s])\w/g, (char) => char.toUpperCase());
  }

  function relativeTime(value) {
    if (!value) return 'Never';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(value).toLocaleString();
  }

  function notify(message) {
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  async function invoke(channel, payload) {
    try {
      return await window.khaos.invoke(channel, payload);
    } catch (error) {
      notify(error.message || String(error));
      throw error;
    }
  }

  function render(next) {
    current = next;
    const config = next?.config?.monitor || {};
    const monitor = next?.applicationMonitor || {};
    const botError = next?.bot?.lastError;

    byId('autoReportEnabled').checked = Boolean(config.autoReportEnabled);
    byId('monitorRepository').value = config.reportRepository || '';
    byId('monitorLabels').value = Array.isArray(config.reportLabels) ? config.reportLabels.join(', ') : '';
    byId('duplicateWindowHours').value = Number(config.duplicateWindowHours || 72);
    byId('maxReportsPerDay').value = Number(config.maxReportsPerDay || 10);

    byId('githubTokenState').textContent = next?.config?.hasGithubToken
      ? 'A GitHub token is stored in Windows protected credential storage.'
      : 'No GitHub monitor token is stored. Automatic reports will remain queued locally.';

    const status = monitor.status || (config.autoReportEnabled ? 'waiting-for-token' : 'disabled');
    byId('autoReportStatus').textContent = config.autoReportEnabled ? titleCase(status) : 'Disabled';
    byId('autoReportStatus').className = `severity monitor-${status}`;
    byId('monitorQueueDepth').textContent = String(monitor.queueDepth || 0);
    byId('monitorSentToday').textContent = `${monitor.sentToday || 0} / ${monitor.maxReportsPerDay || config.maxReportsPerDay || 10}`;
    byId('monitorLastDelivery').textContent = relativeTime(monitor.lastDeliveryAt);
    byId('monitorDestination').textContent = monitor.repository || config.reportRepository || 'Not configured';

    const deliveryParts = [];
    if (!config.autoReportEnabled) deliveryParts.push('Automatic reporting is off.');
    else if (!next?.config?.hasGithubToken) deliveryParts.push('Waiting for a protected GitHub token.');
    else deliveryParts.push(`Monitor is ${titleCase(status).toLowerCase()}.`);
    if (monitor.queueDepth) deliveryParts.push(`${monitor.queueDepth} report${monitor.queueDepth === 1 ? '' : 's'} queued.`);
    if (monitor.lastDeliveryAction) deliveryParts.push(`Last action: ${monitor.lastDeliveryAction}.`);
    if (monitor.lastError) deliveryParts.push(`Last delivery error: ${monitor.lastError}`);
    byId('monitorDeliveryState').textContent = deliveryParts.join(' ');

    byId('sendCurrentErrorButton').disabled = !botError;
    byId('processMonitorQueueButton').disabled = !monitor.queueDepth || !next?.config?.hasGithubToken;
    byId('clearMonitorQueueButton').disabled = !monitor.queueDepth;
    byId('openLastIssueButton').disabled = !monitor.lastIssueUrl;
  }

  async function saveSettings(showMessage = true) {
    const payload = {
      autoReportEnabled: byId('autoReportEnabled').checked,
      reportRepository: byId('monitorRepository').value,
      reportLabels: byId('monitorLabels').value.split(',').map((item) => item.trim()).filter(Boolean),
      duplicateWindowHours: Number(byId('duplicateWindowHours').value),
      maxReportsPerDay: Number(byId('maxReportsPerDay').value)
    };
    await invoke('config:save-monitor', payload);
    const token = byId('githubToken').value.trim();
    if (token) {
      await invoke('secret:set-github-token', token);
      byId('githubToken').value = '';
    }
    const latest = await invoke('app:get-state');
    render(latest);
    if (showMessage) notify('Application Monitor settings saved.');
    return latest;
  }

  function bind() {
    byId('saveMonitorButton').addEventListener('click', () => saveSettings(true));
    byId('verifyGithubButton').addEventListener('click', async () => {
      await saveSettings(false);
      const result = await invoke('monitor:verify');
      notify(`GitHub connection verified for ${result.repository}.`);
    });
    byId('removeGithubTokenButton').addEventListener('click', async () => {
      if (!confirm('Remove the protected GitHub monitor token? Queued reports will remain local.')) return;
      await invoke('secret:set-github-token', '');
      render(await invoke('app:get-state'));
      notify('GitHub monitor token removed.');
    });
    byId('sendCurrentErrorButton').addEventListener('click', async () => {
      const result = await invoke('monitor:send-current');
      render(await invoke('app:get-state'));
      notify(result.delivered ? `Error report ${result.action} on GitHub.` : 'Error report queued locally.');
    });
    byId('processMonitorQueueButton').addEventListener('click', async () => {
      const result = await invoke('monitor:process-queue');
      render(await invoke('app:get-state'));
      notify(`Monitor queue processed. ${result.delivered || 0} delivered.`);
    });
    byId('clearMonitorQueueButton').addEventListener('click', async () => {
      if (!confirm('Clear all locally queued application reports?')) return;
      await invoke('monitor:clear-queue');
      render(await invoke('app:get-state'));
      notify('Application Monitor queue cleared.');
    });
    byId('openLastIssueButton').addEventListener('click', () => invoke('monitor:open-last-issue'));

    window.addEventListener('error', (event) => {
      window.khaos.invoke('monitor:capture-renderer', {
        message: event.error?.message || event.message || 'Renderer error',
        stack: event.error?.stack || ''
      }).catch(() => {});
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      window.khaos.invoke('monitor:capture-renderer', { message: reason.message, stack: reason.stack || '' }).catch(() => {});
    });

    window.khaos.onState(render);
  }

  async function initializeMonitorUi() {
    bind();
    render(await invoke('app:get-state'));
    setInterval(() => {
      if (current?.applicationMonitor?.lastDeliveryAt) {
        byId('monitorLastDelivery').textContent = relativeTime(current.applicationMonitor.lastDeliveryAt);
      }
    }, 30000);
  }

  initializeMonitorUi().catch((error) => notify(`Application Monitor UI failed: ${error.message}`));
})();
