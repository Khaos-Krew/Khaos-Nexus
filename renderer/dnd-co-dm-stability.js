'use strict';

(function bootstrapDndCoDmStability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndCoDmStabilityFactory() {
  function ensureTab(win, state) {
    const root = win.document.getElementById('view-dnd');
    const tabs = root?.querySelector('.dnd-tabs');
    if (!tabs) return null;
    let button = tabs.querySelector('[data-dnd-co-dm-tab="co-dm"]');
    if (!button) {
      button = win.document.createElement('button');
      button.type = 'button';
      button.className = 'dnd-tab';
      button.dataset.dndCoDmTab = 'co-dm';
      button.textContent = 'Co-DM';
      tabs.appendChild(button);
    }
    button.classList.toggle('active', Boolean(state?.active));
    return button;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndCoDmStability) return win?.__khaosDndCoDmStability || null;
    let attachTimer = null;
    let observer = null;
    let recovering = false;

    function attach() {
      const coDm = win.__khaosDndCoDm;
      const root = win.document.getElementById('view-dnd');
      if (!coDm?.state || !root) {
        attachTimer = win.setTimeout(attach, 50);
        return;
      }
      coDm.state.observer?.disconnect?.();
      ensureTab(win, coDm.state);
      observer = new win.MutationObserver(() => {
        ensureTab(win, coDm.state);
        if (!coDm.state.active || recovering) return;
        const panel = root.querySelector('.dnd-tab-panel');
        if (panel?.querySelector('.dnd-co-dm')) return;
        recovering = true;
        Promise.resolve(coDm.refresh?.()).catch(() => {}).finally(() => { recovering = false; });
      });
      observer.observe(root, { childList: true, subtree: true });
      coDm.state.observer = observer;
    }

    const api = {
      disconnect() {
        if (attachTimer) win.clearTimeout(attachTimer);
        observer?.disconnect();
        delete win.__khaosDndCoDmStability;
      }
    };
    win.__khaosDndCoDmStability = api;
    attach();
    return api;
  }

  return { install, ensureTab };
});
