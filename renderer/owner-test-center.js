'use strict';

(() => {
  if (window.__khaosOwnerTestCenterInstalled) return;
  window.__khaosOwnerTestCenterInstalled = true;

  const VIEW = 'owner-tests';
  const POLL_MS = 5 * 60 * 1000;
  let loaded = false;
  let polling = null;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function ensureLegacyNavEntry() {
    if (document.querySelector(`.nav-item[data-view="${VIEW}"]:not(.nexus-nav-item)`)) return;
    const navigation = $('navigation') || document.querySelector('.sidebar nav');
    if (!navigation) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item owner-test-legacy-nav';
    button.dataset.view = VIEW;
    button.innerHTML = '<span>🧪</span>Owner Test Updates';
    navigation.appendChild(button);
  }

  function ensureView() {
    let view = $(`view-${VIEW}`);
    if (view) return view;
    const content = document.querySelector('.content');
    if (!content) return null;
    view = document.createElement('section');
    view.className = 'view';
    view.id = `view-${VIEW}`;
    view.innerHTML = `
      <div class="owner-test-center">
        <section class="owner-test-hero">
          <div>
            <span class="eyebrow">Owner validation channel</span>
            <h2>Owner Test Center</h2>
            <p>Pre-release Windows and Android candidates come from successful GitHub Actions runs here. These builds do not need to be published as GitHub Releases first.</p>
          </div>
          <button class="button primary" type="button" data-owner-test-refresh>Refresh test candidates</button>
        </section>
        <div class="callout owner-test-separation"><strong>Separate channels:</strong> the normal in-app updater installs published releases. This page finds owner-test artifacts that still need hands-on validation, so a missing <code>latest.yml</code> cannot hide test work.</div>
        <div class="owner-test-status-line"><span id="ownerTestStatus">Loading GitHub Actions candidates…</span><span id="ownerTestCheckedAt">Not checked</span></div>
        <div class="owner-test-candidates" id="ownerTestCandidates"></div>
      </div>`;
    content.appendChild(view);
    return view;
  }

  function statusTone(run) {
    if (run.status !== 'completed') return 'wait';
    return run.conclusion === 'success' ? 'good' : 'bad';
  }

  function workflowMarkup(run) {
    const state = run.status !== 'completed' ? run.status : run.conclusion || 'completed';
    return `<div class="owner-test-workflow ${statusTone(run)}"><strong>${escapeHtml(run.name)}</strong><small>${escapeHtml(state)} • #${escapeHtml(run.runNumber)}</small></div>`;
  }

  function artifactButton(artifact, label, primary = false) {
    if (!artifact?.url) return `<button class="button" type="button" disabled>${escapeHtml(label)} unavailable</button>`;
    const size = artifact.size ? ` • ${Math.max(1, Math.round(artifact.size / 1024 / 1024))} MB` : '';
    return `<button class="button${primary ? ' primary' : ''}" type="button" data-owner-test-open="${escapeHtml(artifact.url)}">${escapeHtml(label)}${escapeHtml(size)}</button>`;
  }

  function checklistMarkup(candidate) {
    const items = [
      'Confirm every left-sidebar workspace name is fully readable instead of C…, D…, or A….',
      'Open Command Center, D&D, Nexus AI, Discord, Game Servers, Modules, Application Monitor, Live Logs, and Settings to confirm navigation and scrolling.',
      'Open Mobile Companion and confirm the Mobile Gateway / Pair Android Device screen is visible.',
      'Install the matching Android APK from this exact commit and complete QR or six-digit pairing.',
      'Verify Android reconnect/resume, secure pairing state, current functions, server/status reads, and permission handling.',
      'Exercise the feature or regression called out for this candidate, then record PASS or FAIL with the failed step and screenshot/log.'
    ];
    if (!candidate.ready) items.unshift('Do not start hands-on validation yet: this candidate has not cleared all required automated lanes and matched artifacts.');
    return `<ol class="owner-test-checklist">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
  }

  function candidateMarkup(candidate, index) {
    const badge = candidate.ready ? '<span class="tag good">READY TO TEST</span>' : candidate.active ? '<span class="tag">BUILDING</span>' : '<span class="tag">BLOCKED</span>';
    const blockers = [
      ...(candidate.missingWorkflows || []).map((name) => `missing ${name}`),
      ...(candidate.failedWorkflows || []).map((name) => `failed ${name}`),
      !candidate.artifacts?.windows ? 'Windows artifact unavailable' : '',
      !candidate.artifacts?.android ? 'Android artifact unavailable' : ''
    ].filter(Boolean);
    return `<article class="panel owner-test-candidate ${candidate.ready ? 'ready' : 'blocked'}">
      <div class="owner-test-candidate-header">
        <div>
          <span class="eyebrow">${index === 0 ? 'Latest candidate' : 'Recent candidate'}</span>
          <h3>${escapeHtml(candidate.shortSha)} • matched Windows + Android</h3>
          <div class="owner-test-meta"><span>${escapeHtml(candidate.branch)}</span><span>SHA ${escapeHtml(candidate.sha)}</span><span>${escapeHtml(new Date(candidate.updatedAt).toLocaleString())}</span></div>
        </div>
        ${badge}
      </div>
      ${blockers.length ? `<div class="callout">Waiting on: ${escapeHtml(blockers.join(' • '))}</div>` : ''}
      <div class="owner-test-workflows">${(candidate.workflows || []).map(workflowMarkup).join('')}</div>
      <div class="owner-test-downloads">
        ${artifactButton(candidate.artifacts?.windows, 'Download Windows test build', true)}
        ${artifactButton(candidate.artifacts?.android, 'Download Android APK')}
        <button class="button" type="button" data-owner-test-open="${escapeHtml(candidate.runUrl)}">Open CI evidence</button>
      </div>
      <div><span class="eyebrow">What to test</span>${checklistMarkup(candidate)}</div>
    </article>`;
  }

  function render(payload) {
    const candidates = $('ownerTestCandidates');
    if (!candidates) return;
    const list = Array.isArray(payload?.candidates) ? payload.candidates : [];
    $('ownerTestStatus').textContent = list.length
      ? `${list.filter((candidate) => candidate.ready).length} ready candidate${list.filter((candidate) => candidate.ready).length === 1 ? '' : 's'} • source: GitHub Actions`
      : 'No owner-test Actions candidates found.';
    $('ownerTestCheckedAt').textContent = payload?.checkedAt ? `Checked ${new Date(payload.checkedAt).toLocaleTimeString()}` : 'Not checked';
    candidates.innerHTML = list.length
      ? list.map(candidateMarkup).join('')
      : '<article class="panel owner-test-empty"><h3>No candidate is ready yet</h3><p>The normal release updater is not used for this list. Refresh after the owner-test Actions workflows run.</p></article>';
  }

  async function refresh(force = false) {
    const status = $('ownerTestStatus');
    if (status) status.textContent = 'Checking GitHub Actions owner-test runs…';
    try {
      const payload = await window.khaos.invoke('owner-test:list', { force });
      render(payload);
      loaded = true;
    } catch (error) {
      if (status) status.textContent = `Owner Test Center error: ${error.message || error}`;
      notify(`Owner Test Center: ${error.message || error}`);
    }
  }

  function activate() {
    ensureLegacyNavEntry();
    const view = ensureView();
    if (!view) return;
    document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item === view));
    document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === VIEW));
    const title = $('viewTitle');
    const subtitle = $('viewSubtitle');
    if (title) title.textContent = 'Owner Test Center';
    if (subtitle) subtitle.textContent = 'Test pre-release Actions artifacts before they become beta or stable releases.';
    if (!loaded) void refresh(false);
    if (!polling) polling = setInterval(() => {
      if ($(`view-${VIEW}`)?.classList.contains('active')) void refresh(false);
    }, POLL_MS);
    window.khaos?.reportBootStage?.('owner-test-center-opened', { source: 'github-actions' });
  }

  function bind() {
    document.addEventListener('click', (event) => {
      const viewTarget = event.target.closest(`[data-view="${VIEW}"], [data-view-link="${VIEW}"]`);
      if (viewTarget) {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate();
        return;
      }
      const refreshButton = event.target.closest('[data-owner-test-refresh]');
      if (refreshButton) {
        event.preventDefault();
        void refresh(true);
        return;
      }
      const openButton = event.target.closest('[data-owner-test-open]');
      if (openButton) {
        event.preventDefault();
        const url = openButton.dataset.ownerTestOpen;
        window.khaos.invoke('owner-test:open', { url }).catch((error) => notify(error.message || String(error)));
      }
    }, true);
    window.addEventListener('beforeunload', () => {
      if (polling) clearInterval(polling);
      polling = null;
    }, { once: true });
  }

  function install() {
    ensureLegacyNavEntry();
    ensureView();
    bind();
    window.khaos?.reportBootStage?.('owner-test-center-ready', { source: 'github-actions' });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
