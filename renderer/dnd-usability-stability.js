'use strict';

(function bootstrapDndUsabilityStability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndUsabilityStabilityFactory() {
  function nodeRestoresBaseWorkspace(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'view-dnd') return true;
    if (node.matches?.('.dnd-tabs, .dnd-tab-panel, #dndCampaignSelect')) return true;
    return Boolean(node.querySelector?.('.dnd-tabs, .dnd-tab-panel, #dndCampaignSelect'));
  }

  function shouldEnhanceMutation(records = []) {
    return records.some((record) => {
      if (record.type !== 'childList') return false;
      if (record.target?.closest?.('.dnd-character-management, #dndUsabilityModal')) return false;
      return [...(record.addedNodes || [])].some(nodeRestoresBaseWorkspace);
    });
  }

  function install(win) {
    if (!win?.document || win.__khaosDndUsabilityStability) return win?.__khaosDndUsabilityStability || null;
    let retry = null;
    const attach = () => {
      const repair = win.__khaosDndUsabilityRepair;
      if (!repair?.state || typeof repair.enhance !== 'function') {
        retry = win.setTimeout(attach, 25);
        return;
      }
      repair.state.observer?.disconnect?.();
      let scheduled = false;
      const observer = new win.MutationObserver((records) => {
        if (!shouldEnhanceMutation(records) || scheduled) return;
        scheduled = true;
        win.setTimeout(() => {
          scheduled = false;
          repair.enhance();
        }, 0);
      });
      observer.observe(win.document.documentElement, { childList: true, subtree: true });
      repair.state.observer = observer;
      win.__khaosDndUsabilityStability = {
        observer,
        disconnect() {
          if (retry) win.clearTimeout(retry);
          observer.disconnect();
        }
      };
    };
    attach();
    return win.__khaosDndUsabilityStability;
  }

  return { nodeRestoresBaseWorkspace, shouldEnhanceMutation, install };
});
