'use strict';

(() => {
  const PRODUCT = 'Nexus D&D';
  const KEEP_VIEWS = new Set(['dnd', 'setup', 'ai-services', 'logs', 'settings']);

  function setNodeText(node, value) {
    if (!node) return;
    const next = String(value ?? '');
    if (node.textContent !== next) node.textContent = next;
  }

  function text(selector, value) {
    setNodeText(document.querySelector(selector), value);
  }

  function setNodeHtml(node, value) {
    if (!node) return;
    const next = String(value ?? '');
    if (node.innerHTML !== next) node.innerHTML = next;
  }

  function scopeVeyraView() {
    const view = document.getElementById('view-ai-services');
    if (!view) return;

    const intro = view.querySelector('.section-intro');
    if (intro) {
      const h2 = intro.querySelector('h2');
      const p = intro.querySelector('p');
      setNodeText(h2, 'Veyra AI Runtime');
      setNodeText(p, 'Run and configure the local D&D Lorewarden and Co-DM used by Nexus D&D.');
      const check = intro.querySelector('[data-ai-action="check-all"]');
      if (check) {
        check.dataset.aiAction = 'check-dnd';
        setNodeText(check, check.disabled ? 'Checking…' : 'Test Veyra');
      }
    }

    const coreForm = view.querySelector('#aiCoreConnectionForm');
    coreForm?.closest('article')?.classList.add('dnd-standalone-hidden');

    const policyPanel = view.querySelector('.ai-isolation-panel');
    if (policyPanel) policyPanel.classList.add('dnd-standalone-hidden');

    const grid = view.querySelector('.ai-services-grid');
    if (grid) grid.dataset.dndStandalone = 'veyra-only';

    view.querySelectorAll('p, span, small, strong, h3').forEach((node) => {
      const value = node.textContent || '';
      if (/Veyra and Nexus Sentinel|Both AI agents|shared runtime host runs Veyra and Nexus Sentinel/i.test(value)) {
        setNodeText(node, value
          .replace(/Veyra and Nexus Sentinel/gi, 'Veyra')
          .replace(/Both AI agents/gi, 'Veyra')
          .replace(/One supervised local host runs Veyra and Nexus Sentinel as isolated workers with separate memory, tools, credentials, endpoints, and authority\./gi, 'A supervised local runtime runs Veyra for campaign-aware D&D assistance.'));
      }
    });
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
      if (view === 'setup') setNodeHtml(button, '<span>◈</span>D&amp;D Bot Setup');
      if (view === 'dnd') setNodeHtml(button, '<span>⚔</span>Campaigns');
      if (view === 'ai-services') {
        const label = button.querySelector('span')?.outerHTML || '<span>✦</span>';
        setNodeHtml(button, `${label}Veyra AI`);
      }
    });

    document.querySelectorAll('.view[id^="view-"]').forEach((section) => {
      const view = section.id.replace(/^view-/, '');
      if (!KEEP_VIEWS.has(view)) section.classList.add('dnd-standalone-hidden');
    });

    if (typeof viewMeta === 'object' && viewMeta) {
      viewMeta.dnd = ['Campaigns', 'Run campaigns, characters, encounters, maps, NPCs, sessions, Discord play, and AI-assisted game mastering.'];
      viewMeta.setup = ['D&D Bot Setup', 'Connect the dedicated D&D Discord application using protected local credentials.'];
      if (viewMeta['ai-services']) viewMeta['ai-services'] = ['Veyra AI', 'Local Veyra runtime, model health, and D&D intelligence services.'];
      viewMeta.logs = ['Runtime Logs', 'Local D&D app, bot, and AI runtime events.'];
      viewMeta.settings = ['Desktop Settings', 'Startup, updates, backup, restore, and local data controls.'];
    }

    document.querySelectorAll('[data-view-link]').forEach((node) => {
      if (!KEEP_VIEWS.has(String(node.dataset.viewLink || ''))) node.classList.add('dnd-standalone-hidden');
    });

    setNodeText(document.querySelector('.local-badge'), 'LOCAL D&D + VEYRA');

    const setupIntro = document.querySelector('#view-setup .section-intro');
    if (setupIntro) {
      setNodeText(setupIntro.querySelector('h2'), 'Dedicated D&D Discord bot');
      setNodeText(setupIntro.querySelector('p'), 'Use a Discord application/token dedicated to Nexus D&D. These credentials are stored separately from Nexus Sentinel.');
    }

    const settingsIntro = document.querySelector('#view-settings .section-intro');
    if (settingsIntro) {
      setNodeText(settingsIntro.querySelector('h2'), 'Nexus D&D desktop settings');
      setNodeText(settingsIntro.querySelector('p'), 'Control startup, recovery, updates, backups, and local data for the standalone D&D app.');
    }

    scopeVeyraView();
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