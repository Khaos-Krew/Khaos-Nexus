'use strict';

(() => {
  let state = null;
  let actionRunning = false;
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function iconFor(status) {
    if (status === 'pass') return '✓';
    if (status === 'warn') return '!';
    if (status === 'fail') return '×';
    if (status === 'running') return '•';
    return '·';
  }

  function displayLabel(check) {
    if (check?.id === 'discord-restore') return 'Discord desktop sign-in (optional)';
    if (check?.id === 'renderer-modules') return 'Optional desktop modules';
    return check?.label || 'Startup check';
  }

  function displayDetail(check) {
    const detail = String(check?.detail || check?.status || '');
    if (check?.id === 'discord-restore' && !/optional|does not block/i.test(detail)) {
      return `${detail} This does not block local startup.`;
    }
    return detail;
  }

  function progressFor(payload) {
    const checks = payload?.checks || [];
    const total = Math.max(1, checks.length + 2);
    const complete = checks.filter((check) => ['pass', 'warn', 'fail'].includes(check.status)).length;
    let value = 6 + (complete / total) * 78;
    if (payload?.rendererBridgeReady) value += 5;
    if (payload?.rendererModulesReady) value += 7;
    if (payload?.completed) value = Math.max(value, 94);
    if (payload?.releaseAllowed) value = 100;
    return Math.max(3, Math.min(100, value));
  }

  function titleFor(payload) {
    if (payload?.released) return payload.limitedMode ? 'Opening limited mode' : 'Khaos Nexus is ready';
    if (payload?.overall === 'failed') return 'Startup needs attention';
    if (payload?.profile?.recovered) return 'Previous profile recovered';
    if (payload?.rendererModulesReady && !payload?.completed) return 'Finishing health checks';
    if (payload?.phase === 'health-check-complete') return 'Health checks complete';
    return 'Verifying local startup';
  }

  function detailFor(payload) {
    const checks = payload?.checks || [];
    const running = checks.find((check) => check.status === 'running' || check.status === 'pending');
    if (running) return displayDetail(running);
    const failed = checks.find((check) => check.status === 'fail');
    if (failed) return displayDetail(failed);
    if (payload?.profile?.recovered) return 'The v0.17-compatible profile was restored transactionally before services loaded.';
    if (payload?.completed) return 'Local data, protected storage, IPC, and the base desktop interface were checked.';
    return 'Loading the same canonical data path used by v0.17.2…';
  }

  function renderChecks(payload) {
    const checks = payload?.checks || [];
    $('startupChecks').innerHTML = checks.length ? checks.map((check) => `
      <div class="check-row ${escapeHtml(check.status)}" data-startup-check="${escapeHtml(check.id || '')}">
        <span class="check-icon">${iconFor(check.status)}</span>
        <span><strong>${escapeHtml(displayLabel(check))}</strong><small>${escapeHtml(displayDetail(check))}</small></span>
      </div>`).join('') : `
      <div class="check-row running">
        <span class="check-icon">•</span>
        <span><strong>Starting health service</strong><small>Waiting for the local profile preflight.</small></span>
      </div>`;
  }

  function render(payload) {
    state = payload || state;
    if (!state) return;
    const progress = progressFor(state);
    $('startupTitle').textContent = titleFor(state);
    $('startupPercent').textContent = `${Math.round(progress)}%`;
    $('startupProgress').style.width = `${progress}%`;
    $('startupDetail').textContent = detailFor(state);

    const remaining = Math.max(0, Number(state.minimumRemainingMs) || 0);
    $('startupCountdown').textContent = remaining > 0
      ? `Minimum startup check: ${Math.ceil(remaining / 1000)}s`
      : state.completed ? 'Minimum check complete' : 'Continuing health checks';

    renderChecks(state);
    const criticalFailures = (state.checks || []).filter((check) => check.critical && check.status === 'fail');
    const attention = criticalFailures.length > 0 || (state.elapsedMs >= 75000 && !state.completed);
    $('startupAttention').classList.toggle('hidden', !attention);
    $('startupAttentionText').textContent = criticalFailures.length
      ? criticalFailures.map((check) => `${displayLabel(check)}: ${displayDetail(check)}`).join(' • ')
      : 'The startup health check did not complete within the expected time.';

    for (const id of ['retryStartup', 'openDataFolder', 'continueLimited']) $(id).disabled = actionRunning;
  }

  async function runAction(action) {
    if (actionRunning) return;
    actionRunning = true;
    render(state);
    try { await action(); }
    catch (error) {
      $('startupAttention').classList.remove('hidden');
      $('startupAttentionText').textContent = error.message || String(error);
    } finally {
      actionRunning = false;
      render(state);
    }
  }

  $('retryStartup').addEventListener('click', () => runAction(() => window.khaosStartup.retry()));
  $('openDataFolder').addEventListener('click', () => runAction(() => window.khaosStartup.openDataFolder()));
  $('continueLimited').addEventListener('click', () => runAction(() => window.khaosStartup.continueLimited()));

  window.khaosStartup.onState(render);
  window.khaosStartup.getState().then(render).catch((error) => {
    $('startupAttention').classList.remove('hidden');
    $('startupAttentionText').textContent = `Startup health state could not be read: ${error.message || String(error)}`;
  });

  setInterval(() => {
    if (!state || state.released) return;
    state = { ...state, elapsedMs: Number(state.elapsedMs || 0) + 250, minimumRemainingMs: Math.max(0, Number(state.minimumRemainingMs || 0) - 250) };
    render(state);
  }, 250);
})();
