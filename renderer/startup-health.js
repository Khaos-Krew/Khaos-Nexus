'use strict';

(() => {
  let state = null;
  let meta = null;
  let actionRunning = false;
  const $ = (id) => document.getElementById(id);
  const TERMINAL = new Set(['pass', 'warn', 'fail']);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function checkById(id) {
    return (state?.checks || []).find((check) => check.id === id) || null;
  }

  function displayLabel(check) {
    const labels = {
      'profile-location': 'Nexus profile location',
      'config-file': 'Command configuration',
      'data-integrity': 'Module data integrity',
      'data-write': 'Local data write access',
      'secure-storage': 'Security matrix',
      'config-store': 'Command services configuration',
      'logger': 'Nexus event logging',
      'discord-restore': 'Discord services',
      'renderer-bridge': 'Renderer bridge',
      'renderer-modules': 'Command modules',
      'startup-timeout': 'Startup release gate'
    };
    return labels[check?.id] || check?.label || 'Nexus startup check';
  }

  function displayDetail(check) {
    const detail = String(check?.detail || check?.status || '');
    if (check?.id === 'discord-restore' && !/optional|does not block/i.test(detail)) {
      return `${detail} Discord access is optional for local startup.`;
    }
    return detail;
  }

  function progressFor(payload) {
    const checks = payload?.checks || [];
    const total = Math.max(1, checks.length + 2);
    const complete = checks.filter((check) => TERMINAL.has(check.status)).length;
    let value = 6 + (complete / total) * 78;
    if (payload?.rendererBridgeReady) value += 5;
    if (payload?.rendererModulesReady) value += 7;
    if (payload?.completed) value = Math.max(value, 94);
    if (payload?.releaseAllowed || (payload?.released && !payload?.limitedMode)) value = 100;
    return Math.max(3, Math.min(100, value));
  }

  function titleFor(payload) {
    if (payload?.released) return payload.limitedMode ? 'LIMITED MODE ACTIVE' : 'NEXUS ONLINE';
    if (payload?.overall === 'failed') return 'STARTUP NEEDS ATTENTION';
    if (payload?.profile?.recovered) return 'NEXUS PROFILE RESTORED';
    if (payload?.rendererModulesReady && !payload?.completed) return 'SYNCHRONIZING COMMAND GRID';
    if (payload?.phase === 'health-check-complete') return 'FINALIZING COMMAND CENTER';
    return 'INITIALIZING NEXUS CORE';
  }

  function detailFor(payload) {
    const checks = payload?.checks || [];
    const running = checks.find((check) => check.status === 'running' || check.status === 'pending');
    if (running) return `${displayLabel(running)} — ${displayDetail(running)}`;
    const failed = checks.find((check) => check.status === 'fail');
    if (failed) return `${displayLabel(failed)} — ${displayDetail(failed)}`;
    if (payload?.released && payload?.limitedMode) return 'Command Center released with degraded startup protections acknowledged.';
    if (payload?.released) return 'Protected startup complete. Command Center is online.';
    if (payload?.profile?.recovered) return 'Previous Nexus profile restored before command services initialized.';
    if (payload?.completed) return 'Nexus profile, protected storage, renderer bridge, and command modules are verified.';
    return 'Establishing protected local startup state…';
  }

  function groupStatus(ids, optional = false) {
    const checks = ids.map(checkById).filter(Boolean);
    if (!checks.length) return { state: optional ? 'optional' : 'pending', text: optional ? 'OPTIONAL' : 'PENDING', percent: 0 };
    if (checks.some((check) => check.status === 'fail' && check.critical)) return { state: 'fail', text: 'ATTENTION', percent: groupPercent(checks) };
    if (checks.some((check) => check.status === 'running' || check.status === 'pending')) return { state: 'syncing', text: 'SYNCING', percent: groupPercent(checks) };
    if (checks.some((check) => check.status === 'warn' || check.status === 'fail')) return { state: optional ? 'optional' : 'warn', text: optional ? 'OPTIONAL' : 'WARNING', percent: groupPercent(checks) };
    return { state: 'online', text: 'ONLINE', percent: 100 };
  }

  function groupPercent(checksOrIds) {
    const checks = typeof checksOrIds[0] === 'string'
      ? checksOrIds.map(checkById).filter(Boolean)
      : checksOrIds;
    if (!checks.length) return 0;
    const done = checks.filter((check) => TERMINAL.has(check.status)).length;
    return Math.round((done / checks.length) * 100);
  }

  function setDiagnostic(name, status) {
    const value = Math.max(0, Math.min(100, Number(status.percent) || 0));
    const valueNode = $(`diag${name}Value`);
    const barNode = $(`diag${name}Bar`);
    if (valueNode) valueNode.textContent = `${value}%`;
    if (barNode) barNode.style.width = `${value}%`;
  }

  function sequenceState(ids, options = {}) {
    if (options.launch) {
      if (state?.released && !state?.limitedMode) return { state: 'online', text: 'ONLINE' };
      if (state?.released && state?.limitedMode) return { state: 'warn', text: 'LIMITED' };
      if (state?.overall === 'failed') return { state: 'fail', text: 'BLOCKED' };
      if (state?.completed) return { state: 'running', text: 'FINALIZING' };
      return { state: 'pending', text: 'PENDING' };
    }
    const checks = ids.map(checkById).filter(Boolean);
    if (!checks.length) return { state: options.optional ? 'warn' : 'pending', text: options.optional ? 'OPTIONAL' : 'PENDING' };
    if (checks.some((check) => check.status === 'fail' && check.critical)) return { state: 'fail', text: 'ATTENTION' };
    if (checks.some((check) => check.status === 'running' || check.status === 'pending')) return { state: 'running', text: 'STABILIZING' };
    if (checks.some((check) => check.status === 'warn' || check.status === 'fail')) return { state: 'warn', text: options.optional ? 'OPTIONAL' : 'WARNING' };
    return { state: 'complete', text: 'COMPLETE' };
  }

  function renderSequence() {
    const steps = [
      ['LOAD NEXUS PROFILE', ['profile-location']],
      ['VERIFY SECURITY MATRIX', ['secure-storage', 'data-write']],
      ['RESTORE COMMAND CONFIG', ['config-file', 'config-store', 'data-integrity']],
      ['LOAD COMMAND MODULES', ['renderer-modules']],
      ['CONNECT DISCORD SERVICES', ['discord-restore'], { optional: true }],
      ['INITIALIZE RENDERER BRIDGE', ['renderer-bridge']],
      ['LAUNCH COMMAND CENTER', [], { launch: true }]
    ];

    $('startupChecks').innerHTML = steps.map(([label, ids, options = {}], index) => {
      const status = sequenceState(ids, options);
      const symbol = status.state === 'complete' || status.state === 'online' ? '✓' : status.state === 'fail' ? '×' : status.state === 'warn' ? '!' : status.state === 'running' ? '•' : '○';
      return `<div class="sequence-row" data-state="${escapeHtml(status.state)}">
        <span class="sequence-index">${String(index + 1).padStart(2, '0')}</span>
        <span class="sequence-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(status.text)}</small></span>
        <span class="sequence-indicator">${symbol}</span>
      </div>`;
    }).join('');
  }

  function setModule(id, status) {
    const node = $(id);
    if (!node) return;
    node.dataset.state = status.state;
    const label = node.querySelector('em');
    if (label) label.textContent = status.text;
  }

  function renderModules() {
    const core = groupStatus(['profile-location', 'config-file', 'data-integrity', 'data-write', 'config-store']);
    const security = groupStatus(['secure-storage']);
    const modules = groupStatus(['renderer-modules']);
    const network = groupStatus(['discord-restore'], true);
    const command = state?.released
      ? { state: state.limitedMode ? 'warn' : 'online', text: state.limitedMode ? 'LIMITED' : 'ONLINE' }
      : state?.completed
        ? { state: 'syncing', text: 'FINALIZING' }
        : state?.overall === 'failed'
          ? { state: 'fail', text: 'BLOCKED' }
          : { state: 'pending', text: 'PENDING' };

    setModule('moduleCore', core);
    setModule('moduleSecurity', security);
    setModule('moduleModules', modules);
    setModule('moduleNetwork', network);
    setModule('moduleAI', { state: 'standby', text: 'STANDBY' });
    setModule('moduleCommand', command);
  }

  function integrityFor(payload) {
    const critical = (payload?.checks || []).filter((check) => check.critical);
    if (!critical.length) return { value: 8, label: 'INITIALIZING' };
    const failures = critical.filter((check) => check.status === 'fail').length;
    const passed = critical.filter((check) => check.status === 'pass').length;
    const terminal = critical.filter((check) => TERMINAL.has(check.status)).length;
    if (failures) return { value: Math.round((passed / critical.length) * 100), label: 'ATTENTION' };
    if (payload?.completed || payload?.releaseAllowed || (payload?.released && !payload?.limitedMode)) return { value: 100, label: payload?.released ? 'ONLINE' : 'STABLE' };
    return { value: Math.max(8, Math.round((terminal / critical.length) * 100)), label: 'STABILIZING' };
  }

  function renderDiagnostics() {
    const core = groupStatus(['profile-location', 'config-file', 'data-integrity', 'data-write', 'config-store']);
    const security = groupStatus(['secure-storage']);
    const modules = groupStatus(['renderer-modules']);
    const renderer = groupStatus(['renderer-bridge']);
    setDiagnostic('Core', core);
    setDiagnostic('Security', security);
    setDiagnostic('Modules', modules);
    setDiagnostic('Renderer', renderer);

    const integrity = integrityFor(state);
    $('integrityRing').style.setProperty('--integrity', `${integrity.value}%`);
    $('integrityValue').textContent = `${integrity.value}%`;
    $('integrityLabel').textContent = integrity.label;

    const overall = state?.released
      ? state.limitedMode ? 'LIMITED MODE' : 'ONLINE'
      : state?.overall === 'failed' ? 'ATTENTION'
        : state?.completed ? 'STABLE'
          : 'INITIALIZING';
    $('overallStatus').textContent = overall;
    $('overallDetail').textContent = state?.released
      ? state.limitedMode ? 'Command Center running with startup limitations' : 'All protected startup gates released'
      : state?.overall === 'failed' ? 'Critical Nexus startup check requires review'
        : 'Protected startup gate active';
  }

  function renderOverview() {
    const checks = state?.checks || [];
    const active = checks.filter((check) => check.status === 'running' || check.status === 'pending').length;
    const secure = checkById('secure-storage');
    $('overviewVersion').textContent = meta?.appVersion ? `v${meta.appVersion}` : '—';
    $('overviewProfile').textContent = String(state?.profile?.status || 'pending').toUpperCase();
    $('overviewChecks').textContent = String(active);
    $('overviewRenderer').textContent = state?.rendererBridgeReady ? 'ONLINE' : 'PENDING';
    $('overviewSecurity').textContent = secure?.status === 'pass' ? 'SECURE' : secure?.status === 'warn' ? 'LIMITED' : secure?.status === 'fail' ? 'ATTENTION' : 'VERIFYING';
  }

  function renderMeta() {
    if (!meta) return;
    const version = meta.appVersion ? `v${meta.appVersion}` : 'DESKTOP';
    $('startupVersion').textContent = version;
    $('overviewVersion').textContent = version;
    $('startupRuntime').textContent = `ELECTRON ${meta.electronVersion || '—'} • ${Number(meta.cpuThreads) || 0} THREADS`;
    $('platformState').textContent = meta.platform === 'win32' ? 'WINDOWS' : String(meta.platform || 'LOCAL').toUpperCase();
    $('archState').textContent = String(meta.architecture || process?.arch || 'X64').toUpperCase();
    $('footerProtocol').textContent = `NEXUS OS ${version} • STARTUP PROTOCOL v1`;
  }

  function formatElapsed(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function render(payload) {
    state = payload || state;
    if (!state) return;

    const progress = progressFor(state);
    $('bootShell').dataset.overall = state.overall || 'running';
    $('startupTitle').textContent = titleFor(state);
    $('startupPercent').textContent = `${Math.round(progress)}%`;
    $('startupProgress').style.width = `${progress}%`;
    $('startupDetail').textContent = detailFor(state);
    $('profileState').textContent = String(state.profile?.status || 'pending').toUpperCase();
    $('modeState').textContent = state.released ? (state.limitedMode ? 'LIMITED' : 'ONLINE') : 'PROTECTED';
    $('elapsedState').textContent = formatElapsed(state.elapsedMs);

    const checks = state.checks || [];
    const complete = checks.filter((check) => TERMINAL.has(check.status)).length;
    $('checkCount').textContent = `${String(complete).padStart(2, '0')} / ${String(checks.length).padStart(2, '0')}`;

    const remaining = Math.max(0, Number(state.minimumRemainingMs) || 0);
    $('startupCountdown').textContent = remaining > 0
      ? `RELEASE GATE ${formatElapsed(remaining)}`
      : state.completed ? 'RELEASE GATE COMPLETE' : 'HEALTH CHECKS ACTIVE';
    $('progressPhase').textContent = state.released
      ? state.limitedMode ? 'LIMITED MODE' : 'COMMAND CENTER ONLINE'
      : String(state.phase || 'PROTECTED STARTUP').replace(/-/g, ' ').toUpperCase();

    renderSequence();
    renderDiagnostics();
    renderModules();
    renderOverview();
    renderMeta();

    const criticalFailures = checks.filter((check) => check.critical && check.status === 'fail');
    const attention = criticalFailures.length > 0 || (Number(state.elapsedMs) >= 75000 && !state.completed);
    $('startupAttention').classList.toggle('hidden', !attention);
    $('startupAttentionText').textContent = criticalFailures.length
      ? criticalFailures.map((check) => `${displayLabel(check)}: ${displayDetail(check)}`).join(' • ')
      : 'The protected startup sequence did not complete within the expected time.';

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

  Promise.allSettled([
    window.khaosStartup.getMeta(),
    window.khaosStartup.getState()
  ]).then(([metaResult, stateResult]) => {
    if (metaResult.status === 'fulfilled') {
      meta = metaResult.value;
      renderMeta();
    }
    if (stateResult.status === 'fulfilled') render(stateResult.value);
    else {
      $('startupAttention').classList.remove('hidden');
      $('startupAttentionText').textContent = `Startup health state could not be read: ${stateResult.reason?.message || String(stateResult.reason)}`;
    }
  });

  setInterval(() => {
    if (!state || state.released) return;
    state = {
      ...state,
      elapsedMs: Number(state.elapsedMs || 0) + 250,
      minimumRemainingMs: Math.max(0, Number(state.minimumRemainingMs || 0) - 250)
    };
    render(state);
  }, 250);
})();
