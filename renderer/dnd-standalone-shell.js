'use strict';

(() => {
  const PRODUCT = 'Nexus D&D';
  const KEEP_VIEWS = new Set(['dnd', 'setup', 'ai-services', 'nexus-ai', 'logs', 'settings']);

  function text(selector, value) {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  }

  function scopeNavigation() {
    document.documentElement.dataset.nexusProduct = 'dnd-standalone';
    document.title = PRODUCT;

    text('.brand strong', PRODUCT);
    text('.brand span', 'Local AI Campaign Command Center');
    const image = document.querySelector('.brand img');
    if (image) image.alt = PRODUCT;

    document.querySelectorAll('.nav-item[data-view]').forEach((button) => {
      const view = String(button.dataset.view || '');
      button.classList.toggle('dnd-standalone-hidden', !KEEP_VIEWS.has(view));
      if (view === 'setup') button.innerHTML = '<span>◈</span>D&amp;D Bot Setup';
      if (view === 'dnd') button.innerHTML = '<span>⚔</span>Campaigns';
      if (view === 'ai-services' || view === 'nexus-ai') {
        const label = button.querySelector('span')?.outerHTML || '<span>✦</span>';
        button.innerHTML = `${label}Veyra AI`;
      }
    });

    document.querySelectorAll('.view[id^="view-"]').forEach((section) => {
      const view = section.id.replace(/^view-/, '');
      if (!KEEP_VIEWS.has(view)) section.classList.add('dnd-standalone-hidden');
    });

    if (typeof viewMeta === 'object' && viewMeta) {
      viewMeta.dnd = ['Campaigns', 'Run campaigns, characters, encounters, maps, NPCs, sessions, Discord play, and AI-assisted game mastering.'];
      viewMeta.setup = ['D&D Bot Setup', 'Connect the dedicated D&D Discord application using protected local credentials.'];
      if (viewMeta['ai-services']) viewMeta['ai-services'] = ['Veyra AI', 'Local AI runtime, model health, and D&D intelligence services.'];
      if (viewMeta['nexus-ai']) viewMeta['nexus-ai'] = ['Veyra AI', 'Local AI tools used by the D&D command center.'];
      viewMeta.logs = ['Runtime Logs', 'Local D&D app, bot, and AI runtime events.'];
      viewMeta.settings = ['Desktop Settings', 'Startup, updates, backup, restore, and local data controls.'];
    }

    document.querySelectorAll('[data-view-link]').forEach((node) => {
      if (!KEEP_VIEWS.has(String(node.dataset.viewLink || ''))) node.classList.add('dnd-standalone-hidden');
    });

    const footerBadge = document.querySelector('.local-badge');
    if (footerBadge) footerBadge.textContent = 'LOCAL D&D + AI';

    const setupIntro = document.querySelector('#view-setup .section-intro');
    if (setupIntro) {
      const h2 = setupIntro.querySelector('h2');
      const p = setupIntro.querySelector('p');
      if (h2) h2.textContent = 'Dedicated D&D Discord bot';
      if (p) p.textContent = 'Use a Discord application/token dedicated to Nexus D&D. These credentials are stored separately from Nexus Sentinel.';
    }

    const settingsIntro = document.querySelector('#view-settings .section-intro');
    if (settingsIntro) {
      const h2 = settingsIntro.querySelector('h2');
      const p = settingsIntro.querySelector('p');
      if (h2) h2.textContent = 'Nexus D&D desktop settings';
      if (p) p.textContent = 'Control startup, recovery, updates, backups, and local data for the standalone D&D app.';
    }
  }

  function openDefaultView() {
    const dndButton = document.querySelector('.nav-item[data-view="dnd"]');
    const dndView = document.getElementById('view-dnd');
    if (!dndButton || !dndView) return false;
    if (!dndView.classList.contains('active')) dndButton.click();
    return true;
  }

  function apply() {
    scopeNavigation();
    if (!openDefaultView()) return false;
    text('#viewTitle', 'Campaigns');
    text('#viewSubtitle', 'Standalone local D&D command center with Veyra AI and a dedicated Discord bot.');
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (apply() || attempts >= 80) clearInterval(timer);
  }, 100);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply(), { once: true });
  } else {
    queueMicrotask(apply);
  }

  const observer = new MutationObserver(() => scopeNavigation());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 12000);
})();
