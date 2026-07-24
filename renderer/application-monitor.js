'use strict';

(() => {
  if (typeof viewMeta !== 'undefined') {
    viewMeta.monitor = ['Application Monitor', 'Automatic recovery, redacted diagnostics, and GitHub issue delivery.'];
  }

  const byId = (id) => document.getElementById(id);
  const recentRendererErrors = new Map();
  let current = null;
  let configSignature = '';

  function titleCase(value) {
    return String(value || 'idle').replace(/(^|[-_\s])\w/g, (character) => character.toUpperCase());
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
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function render(next) {
    current = next;
    const config = next?.config?.monitor || {};
    const monitor = next?.applicationMonitor || {};
    const botError = next?.bot?.lastError;
    const nextSignature = JSON.stringify({ config, hasGithubToken: Boolean(next?.config?.hasGithubToken) });

    if (nextSignature !== configSignature) {
      configSignature = nextSignature;
      if (byId('autoReportEnabled')) byId('autoReportEnabled').checked = Boolean(config.autoReportEnabled);
      if (byId('monitorRepository')) byId('monitorRepository').value = config.reportRepository || '';
      if (byId('monitorLabels')) byId('monitorLabels').value = Array.isArray(config.reportLabels) ? config.reportLabels.join(', ') : '';
      if (byId('duplicateWindowHours')) byId('duplicateWindowHours').value = Number(config.duplicateWindowHours || 72);
      if (byId('maxReportsPerDay')) byId('maxReportsPerDay').value = Number(config.maxReportsPerDay || 10);
      if (byId('githubTokenState')) {
        byId('githubTokenState').textContent = next?.config?.hasGithubToken
          ? 'A GitHub token is stored in Windows protected credential storage.'
          : 'No GitHub monitor token is stored. Automatic reports will remain queued locally.';
      }
    }

    const status = monitor.status || (config.autoReportEnabled ? 'waiting-for-token' : 'disabled');
    if (byId('autoReportStatus')) {
      byId('autoReportStatus').textContent = config.autoReportEnabled ? titleCase(status) : 'Disabled';
      byId('autoReportStatus').className = `severity monitor-${status}`;
    }
    if (byId('monitorQueueDepth')) byId('monitorQueueDepth').textContent = String(monitor.queueDepth || 0);
    if (byId('monitorSentToday')) byId('monitorSentToday').textContent = `${monitor.sentToday || 0} / ${monitor.maxReportsPerDay || config.maxReportsPerDay || 10}`;
    if (byId('monitorLastDelivery')) byId('monitorLastDelivery').textContent = relativeTime(monitor.lastDeliveryAt);
    if (byId('monitorDestination')) byId('monitorDestination').textContent = monitor.repository || config.reportRepository || 'Not configured';

    const deliveryParts = [];
    if (!config.autoReportEnabled) deliveryParts.push('Automatic reporting is off.');
    else if (!next?.config?.hasGithubToken) deliveryParts.push('Waiting for a protected GitHub token.');
    else deliveryParts.push(`Monitor is ${titleCase(status).toLowerCase()}.`);
    if (monitor.queueDepth) deliveryParts.push(`${monitor.queueDepth} report${monitor.queueDepth === 1 ? '' : 's'} queued.`);
    if (monitor.lastDeliveryAction) deliveryParts.push(`Last action: ${monitor.lastDeliveryAction}.`);
    if (monitor.lastError) deliveryParts.push(`Last delivery error: ${monitor.lastError}`);
    if (byId('monitorDeliveryState')) byId('monitorDeliveryState').textContent = deliveryParts.join(' ');

    if (byId('sendCurrentErrorButton')) byId('sendCurrentErrorButton').disabled = !botError;
    if (byId('processMonitorQueueButton')) byId('processMonitorQueueButton').disabled = !monitor.queueDepth || !next?.config?.hasGithubToken;
    if (byId('clearMonitorQueueButton')) byId('clearMonitorQueueButton').disabled = !monitor.queueDepth;
    if (byId('openLastIssueButton')) byId('openLastIssueButton').disabled = !monitor.lastIssueUrl;
  }

  async function saveSettings(showMessage = true) {
    const payload = {
      autoReportEnabled: Boolean(byId('autoReportEnabled')?.checked),
      reportRepository: byId('monitorRepository')?.value || '',
      reportLabels: String(byId('monitorLabels')?.value || '').split(',').map((item) => item.trim()).filter(Boolean),
      duplicateWindowHours: Number(byId('duplicateWindowHours')?.value || 72),
      maxReportsPerDay: Number(byId('maxReportsPerDay')?.value || 10)
    };
    await invoke('config:save-monitor', payload);
    const token = String(byId('githubToken')?.value || '').trim();
    if (token) {
      await invoke('secret:set-github-token', token);
      byId('githubToken').value = '';
    }
    const latest = await invoke('app:get-state');
    render(latest);
    if (showMessage) notify('Application Monitor settings saved.');
    return latest;
  }

  function captureRendererError(errorLike) {
    const error = errorLike instanceof Error ? errorLike : new Error(String(errorLike || 'Renderer error'));
    const message = String(error.message || 'Renderer error').slice(0, 1000);
    const stack = String(error.stack || '').slice(0, 12000);
    const key = `${message}\n${stack}`;
    const now = Date.now();
    const previous = recentRendererErrors.get(key) || 0;
    recentRendererErrors.set(key, now);
    for (const [entry, time] of recentRendererErrors) if (now - time > 5 * 60 * 1000) recentRendererErrors.delete(entry);
    if (now - previous < 60000) return;
    window.khaos.invoke('monitor:capture-renderer', { message, stack }).catch(() => {});
  }

  function bind() {
    byId('saveMonitorButton')?.addEventListener('click', () => saveSettings(true));
    byId('verifyGithubButton')?.addEventListener('click', async () => {
      await saveSettings(false);
      const result = await invoke('monitor:verify');
      notify(`GitHub connection verified for ${result.repository}.`);
    });
    byId('removeGithubTokenButton')?.addEventListener('click', async () => {
      if (!confirm('Remove the protected GitHub monitor token? Queued reports will remain local.')) return;
      await invoke('secret:set-github-token', '');
      render(await invoke('app:get-state'));
      notify('GitHub monitor token removed.');
    });
    byId('sendCurrentErrorButton')?.addEventListener('click', async () => {
      const result = await invoke('monitor:send-current');
      render(await invoke('app:get-state'));
      notify(result.delivered ? `Error report ${result.action} on GitHub.` : 'Error report queued locally.');
    });
    byId('processMonitorQueueButton')?.addEventListener('click', async () => {
      const result = await invoke('monitor:process-queue');
      render(await invoke('app:get-state'));
      notify(`Monitor queue processed. ${result.delivered || 0} delivered.`);
    });
    byId('clearMonitorQueueButton')?.addEventListener('click', async () => {
      if (!confirm('Clear all locally queued application reports?')) return;
      await invoke('monitor:clear-queue');
      render(await invoke('app:get-state'));
      notify('Application Monitor queue cleared.');
    });
    byId('openLastIssueButton')?.addEventListener('click', () => invoke('monitor:open-last-issue'));

    window.addEventListener('error', (event) => captureRendererError(event.error || new Error(event.message || 'Renderer error')));
    window.addEventListener('unhandledrejection', (event) => captureRendererError(event.reason));
    window.khaos.onState(render);
  }

  function loadExtension(src) {
    if (document.querySelector(`script[src="${src}"]`)) return;
    const script = document.createElement('script');
    script.src = src;
    script.defer = true;
    document.body.appendChild(script);
  }

  async function initializeMonitorUi() {
    bind();
    render(await invoke('app:get-state'));
    loadExtension('discord-auth.js');
    loadExtension('autonomy.js');
    loadExtension('readiness.js');
    loadExtension('permission-state.js');
    setInterval(() => {
      if (current?.applicationMonitor?.lastDeliveryAt && byId('monitorLastDelivery')) {
        byId('monitorLastDelivery').textContent = relativeTime(current.applicationMonitor.lastDeliveryAt);
      }
    }, 30000);
  }

  initializeMonitorUi().catch((error) => notify(`Application Monitor UI failed: ${error.message}`));
})();
