'use strict';

(() => {
  if (window.__nexusSentinelLiveCopyInstalled) return;
  window.__nexusSentinelLiveCopyInstalled = true;

  let scheduled = false;
  let observer = null;

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function patchViewMeta() {
    try {
      if (typeof viewMeta !== 'object' || !viewMeta) return;
      viewMeta.dashboard = ['Command Center', 'Run Nexus Sentinel, Discord operations, and Palworld control locally from this PC.'];
      viewMeta.setup = ['Discord', 'Connect the Nexus Sentinel Discord application using protected local credentials.'];
      viewMeta.servers = ['Palworld Servers', 'Configure Palworld REST or legacy RCON connections and guarded server operations.'];
      viewMeta.modules = ['Modules', 'Control the Discord, Palworld, and supporting desktop modules available in Nexus Sentinel.'];
      viewMeta.monitor = ['Application Monitor', 'Owner-only redacted diagnostics, recovery evidence, and optional GitHub reporting.'];
      viewMeta.logs = ['Live Logs', 'Inspect current Nexus Sentinel desktop and Discord runtime activity.'];
      viewMeta.settings = ['Settings', 'Control startup, access, backups, recovery, and local desktop preferences.'];
    } catch {}
  }

  function patchDashboard() {
    setText(document.querySelector('#view-dashboard .local-banner strong'), 'Nexus Sentinel local command network');
    setText(document.querySelector('#view-dashboard .local-banner div span'), 'Discord, Palworld, modules, logs, backups, and protected operator settings run from this PC.');
    setText(document.querySelector('#view-dashboard .hero-panel .eyebrow'), 'Nexus Sentinel runtime');
    setText(document.querySelector('#view-dashboard .metric-card:nth-child(3) > span'), 'Palworld servers');
    setText(document.querySelector('#view-dashboard .metric-card:nth-child(3) > small'), 'Configured Palworld targets');

    const start = document.getElementById('startButton');
    if (start && /^Start Bot$/i.test(start.textContent || '')) setText(start, 'Start Sentinel');

    const quickCards = [...document.querySelectorAll('#view-dashboard .quick-card')];
    for (const card of quickCards) {
      if (/Game Servers|Palworld Servers/i.test(card.textContent || '')) {
        setText(card.querySelector('strong'), 'Palworld Servers');
        setText(card.querySelector('span'), 'Status, players, saves, moderation, settings, and guarded controls');
      }
      if (/Application Monitor/i.test(card.textContent || '')) {
        setText(card.querySelector('span'), 'Owner-only recovery, reports, and redacted diagnostics');
      }
    }

    const heroStatus = document.getElementById('heroStatus');
    if (heroStatus) {
      const value = String(heroStatus.textContent || '');
      if (/^Khaos Nexus is online$/i.test(value)) setText(heroStatus, 'Nexus Sentinel is online');
      if (/^Khaos Nexus requires attention$/i.test(value)) setText(heroStatus, 'Nexus Sentinel requires attention');
    }
  }

  function patchServers() {
    const intro = document.querySelector('#view-servers .section-intro');
    if (intro) {
      setText(intro.querySelector('h2'), 'Palworld server control');
      setText(intro.querySelector('p'), 'Manage Palworld REST or legacy RCON connections, players, saves, announcements, moderation, metrics, and shutdown controls.');
    }

    const add = document.getElementById('newServerButton');
    if (add) setText(add, 'Add Palworld Server');

    document.querySelectorAll('#view-servers .empty-state').forEach((empty) => {
      setText(empty.querySelector('h3'), 'No Palworld servers configured');
      setText(empty.querySelector('p'), 'Add your first Palworld REST or legacy RCON connection. Credentials remain protected on this PC.');
    });

    const editor = document.getElementById('serverEditor');
    if (editor) {
      const title = document.getElementById('serverEditorTitle');
      if (title && /^Add game server$/i.test(title.textContent || '')) setText(title, 'Add Palworld server');
      const game = document.getElementById('serverGame');
      if (game) {
        [...game.options].forEach((option) => { if (option.value !== 'palworld') option.remove(); });
        game.value = 'palworld';
        game.disabled = true;
      }
      editor.querySelectorAll('label').forEach((label) => {
        const text = String(label.childNodes?.[0]?.textContent || '').trim();
        if (/^RCON port$/i.test(text)) label.childNodes[0].textContent = 'Management port';
        if (/^RCON password$/i.test(text)) label.childNodes[0].textContent = 'Admin / RCON password';
      });
    }
  }

  function patchModules() {
    const view = document.getElementById('view-modules');
    if (!view) return;
    view.querySelectorAll(':scope > .section-intro, :scope > .migration-panel, :scope > #moduleGrid, :scope > .callout').forEach((node) => node.classList.add('sentinel-legacy-module-ui'));
    document.getElementById('nexusModuleCenter')?.classList.add('sentinel-hidden');
  }

  function patchSetup() {
    const intro = document.querySelector('#view-setup .section-intro');
    if (intro) {
      setText(intro.querySelector('h2'), 'Nexus Sentinel Discord control');
      setText(intro.querySelector('p'), 'Connect the Nexus Sentinel bot using protected local credentials. The token is encrypted by Windows and is never shown again.');
    }
  }

  function patchSettings() {
    const intro = document.querySelector('#view-settings .section-intro');
    if (intro) {
      const heading = intro.querySelector('h2');
      if (heading && /settings/i.test(heading.textContent || '')) setText(heading, 'Nexus Sentinel desktop settings');
    }
  }

  function apply() {
    scheduled = false;
    patchViewMeta();
    patchDashboard();
    patchSetup();
    patchServers();
    patchModules();
    patchSettings();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else queueMicrotask(apply);

  observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  window.addEventListener('beforeunload', () => {
    observer?.disconnect();
    observer = null;
  }, { once: true });
})();
