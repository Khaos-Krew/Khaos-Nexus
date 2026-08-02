'use strict';

(function installDndDraftPreservationBridge(win) {
  if (!win?.document || win.__khaosDndDraftPreservationBridge) return;
  win.__khaosDndDraftPreservationBridge = true;
  const SUCCESS_MESSAGE = /\b(saved|created|planned|updated|installed|started|ended|refreshed|unbound|selected|approved|rejected|submitted|retired|generated|imported|uploaded|completed|repaired)\b/i;

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

  function finishSuccessfulCommit() {
    const guard = win.__khaosDndUsabilityStability;
    const state = guard?.state;
    const toast = win.document.getElementById('toast');
    if (!guard || !state?.commitPending || !toast) return;
    if (!SUCCESS_MESSAGE.test(String(toast.textContent || ''))) return;
    if (state.pendingHtml === null) {
      state.commitPending = false;
      return;
    }
    guard.discardDraft();
  }

  function attachToastObserver() {
    const toast = win.document.getElementById('toast');
    if (!toast) {
      win.setTimeout(attachToastObserver, 25);
      return;
    }
    const observer = new win.MutationObserver(() => {
      if (typeof win.queueMicrotask === 'function') win.queueMicrotask(finishSuccessfulCommit);
      else Promise.resolve().then(finishSuccessfulCommit);
    });
    observer.observe(toast, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    win.__khaosDndDraftPreservationBridgeObserver = observer;
  }

  attachToastObserver();
})(typeof window !== 'undefined' ? window : null);
