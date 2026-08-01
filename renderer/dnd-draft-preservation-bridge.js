'use strict';

(function installDndDraftPreservationBridge(win) {
  if (!win?.document || win.__khaosDndDraftPreservationBridge) return;
  win.__khaosDndDraftPreservationBridge = true;

  win.document.addEventListener('change', (event) => {
    if (event.target?.id !== 'dndCampaignSelect') return;
    const guard = win.__khaosDndUsabilityStability;
    const state = guard?.state;
    if (!state) return;

    // The primary guard stops propagation before this listener when a real draft
    // already exists. Reaching this listener means the campaign selector itself
    // was the first change and should remain a normal navigation action.
    if (state.pendingHtml === null && state.commitPending === false) {
      state.dirty = false;
      state.snapshot = null;
      event.target.closest('#view-dnd')?.removeAttribute('data-dnd-draft-state');
    }
  }, true);
})(typeof window !== 'undefined' ? window : null);
