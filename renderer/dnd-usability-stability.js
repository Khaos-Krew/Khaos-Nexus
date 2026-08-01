'use strict';

(function bootstrapDndUsabilityStability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndUsabilityStabilityFactory() {
  const EDITABLE_SELECTOR = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  const COMMIT_ACTION = /(^|[-_:])(save|create|update|add|remove|delete|archive|restore|activate|pause|complete|start|end|advance|publish|repair|install|approve|reject|submit|retire|bind|grant|reveal|hide|sync|upload|generate|import|roll|set|assign|clear|apply)([-_:]|$)/i;
  const READ_ONLY_ACTION = /(^|[-_:])(load|open|export|test|preview|copy|refresh)([-_:]|$)/i;

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

  function isCommitAction(action) {
    const value = String(action || '');
    return COMMIT_ACTION.test(value) && !READ_ONLY_ACTION.test(value);
  }

  function shouldBlockWorkspaceRender(state = {}) {
    return Boolean(state.dirty && !state.suppressGuard);
  }

  function findInnerHtmlDescriptor(win) {
    let prototype = win?.Element?.prototype || null;
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'innerHTML');
      if (descriptor?.get && descriptor?.set) return descriptor;
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  function controlKey(control, index) {
    if (control.id) return `id:${control.id}`;
    if (control.name) return `name:${control.name}`;
    const dataKey = [...(control.attributes || [])]
      .find((attribute) => String(attribute.name || '').startsWith('data-dnd-'));
    if (dataKey) return `${dataKey.name}:${dataKey.value}`;
    return `${String(control.tagName || 'control').toLowerCase()}:${control.type || ''}:${index}`;
  }

  function captureDraft(root, doc = root?.ownerDocument) {
    if (!root?.querySelectorAll) return null;
    const controls = [...root.querySelectorAll(EDITABLE_SELECTOR)];
    const active = doc?.activeElement;
    return {
      controls: controls.map((control, index) => ({
        key: controlKey(control, index),
        value: control.value,
        checked: Boolean(control.checked),
        selectedIndex: Number.isInteger(control.selectedIndex) ? control.selectedIndex : -1,
        scrollTop: Number(control.scrollTop || 0),
        selectionStart: typeof control.selectionStart === 'number' ? control.selectionStart : null,
        selectionEnd: typeof control.selectionEnd === 'number' ? control.selectionEnd : null
      })),
      activeKey: active && root.contains(active) ? controlKey(active, controls.indexOf(active)) : '',
      rootScrollTop: Number(root.scrollTop || 0),
      rootScrollLeft: Number(root.scrollLeft || 0)
    };
  }

  function restoreDraft(root, snapshot, doc = root?.ownerDocument) {
    if (!root?.querySelectorAll || !snapshot?.controls) return false;
    const controls = [...root.querySelectorAll(EDITABLE_SELECTOR)];
    const byKey = new Map(controls.map((control, index) => [controlKey(control, index), control]));
    for (const saved of snapshot.controls) {
      const control = byKey.get(saved.key);
      if (!control) continue;
      if ('value' in control) control.value = saved.value;
      if ('checked' in control) control.checked = saved.checked;
      if (saved.selectedIndex >= 0 && 'selectedIndex' in control) control.selectedIndex = saved.selectedIndex;
      if ('scrollTop' in control) control.scrollTop = saved.scrollTop;
    }
    root.scrollTop = snapshot.rootScrollTop;
    root.scrollLeft = snapshot.rootScrollLeft;
    const active = snapshot.activeKey ? byKey.get(snapshot.activeKey) : null;
    if (active?.focus) {
      active.focus({ preventScroll: true });
      if (typeof active.setSelectionRange === 'function' && snapshot.controls) {
        const saved = snapshot.controls.find((item) => item.key === snapshot.activeKey);
        if (saved?.selectionStart !== null && saved?.selectionEnd !== null) {
          try { active.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch { /* unsupported input type */ }
        }
      }
    } else if (doc?.activeElement && !root.contains(doc.activeElement)) {
      // Preserve focus outside the workspace.
    }
    return true;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndUsabilityStability) return win?.__khaosDndUsabilityStability || null;
    const doc = win.document;
    const state = {
      dirty: false,
      commitPending: false,
      pendingHtml: null,
      pendingExternal: false,
      snapshot: null,
      patchedRoot: null,
      descriptor: null,
      suppressGuard: false,
      observer: null,
      retry: null,
      enhanceScheduled: false
    };

    function notify(message) {
      if (typeof win.toast === 'function') win.toast(message);
    }

    function workspace() {
      return doc.getElementById('view-dnd');
    }

    function removeNotice() {
      doc.getElementById('dndDraftPreservationNotice')?.remove();
    }

    function showNotice() {
      const root = workspace();
      if (!root || !state.dirty || state.pendingHtml === null) return;
      let notice = doc.getElementById('dndDraftPreservationNotice');
      if (notice) return;
      notice = doc.createElement('div');
      notice.id = 'dndDraftPreservationNotice';
      notice.className = 'callout dnd-draft-preservation-notice';
      const message = doc.createElement('div');
      const title = doc.createElement('strong');
      title.textContent = 'Unsaved changes are protected';
      const detail = doc.createElement('span');
      detail.textContent = 'Khaos Nexus received newer campaign data but will not replace this form until you save or discard your edits.';
      message.append(title, detail);
      const actions = doc.createElement('div');
      actions.className = 'form-actions';
      const keep = doc.createElement('button');
      keep.type = 'button';
      keep.className = 'button';
      keep.dataset.dndDraftAction = 'keep';
      keep.textContent = 'Keep editing';
      const discard = doc.createElement('button');
      discard.type = 'button';
      discard.className = 'button danger';
      discard.dataset.dndDraftAction = 'discard';
      discard.textContent = 'Discard edits and refresh';
      actions.append(keep, discard);
      notice.append(message, actions);
      root.prepend(notice);
    }

    function rawSet(root, html) {
      if (!root || !state.descriptor?.set) return false;
      state.suppressGuard = true;
      try {
        state.descriptor.set.call(root, String(html ?? ''));
      } finally {
        state.suppressGuard = false;
      }
      return true;
    }

    function enhanceNow() {
      const repair = win.__khaosDndUsabilityRepair;
      if (typeof repair?.enhance === 'function') repair.enhance();
    }

    function clearDraft({ applyPending = false } = {}) {
      const root = workspace();
      const pending = state.pendingHtml;
      state.dirty = false;
      state.commitPending = false;
      state.pendingExternal = false;
      state.snapshot = null;
      state.pendingHtml = null;
      root?.removeAttribute('data-dnd-draft-state');
      removeNotice();
      if (applyPending && pending !== null && rawSet(root, pending)) enhanceNow();
    }

    function finishCommit() {
      if (!state.commitPending) return;
      clearDraft({ applyPending: true });
    }

    function patchWorkspace(root) {
      if (!root || state.patchedRoot === root) return;
      state.descriptor = findInnerHtmlDescriptor(win);
      if (!state.descriptor) return;
      try {
        Object.defineProperty(root, 'innerHTML', {
          configurable: true,
          enumerable: state.descriptor.enumerable,
          get() { return state.descriptor.get.call(root); },
          set(value) {
            if (shouldBlockWorkspaceRender(state)) {
              state.pendingHtml = String(value ?? '');
              state.pendingExternal = true;
              showNotice();
              return;
            }
            state.descriptor.set.call(root, value);
          }
        });
        state.patchedRoot = root;
      } catch {
        state.patchedRoot = null;
      }
    }

    function markDirty(target) {
      const root = workspace();
      if (!root || !target?.matches?.(EDITABLE_SELECTOR) || !root.contains(target)) return;
      state.dirty = true;
      state.snapshot = captureDraft(root, doc);
      root.setAttribute('data-dnd-draft-state', 'dirty');
    }

    function actionName(target) {
      const action = target?.closest?.('[data-dnd-action], [data-dnd-repair-action], [data-dnd-owner-action], [data-dnd-world-action], [data-dnd-map-action], [data-dnd-npc-action], [data-dnd-encounter-action]');
      if (!action) return '';
      return action.dataset.dndAction || action.dataset.dndRepairAction || action.dataset.dndOwnerAction || action.dataset.dndWorldAction || action.dataset.dndMapAction || action.dataset.dndNpcAction || action.dataset.dndEncounterAction || '';
    }

    function hasDndDataAttribute(target) {
      return [...(target?.attributes || [])].some((attribute) => String(attribute.name || '').startsWith('data-dnd-'));
    }

    function protectNavigation(event) {
      if (!state.dirty) return false;
      const target = event.target;
      const navigation = target?.closest?.('[data-dnd-tab], [data-dnd-repair-tab], [data-dnd-action="new-campaign"]');
      if (!navigation) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      notify('Save or discard the current D&D edits before changing campaigns or tabs.');
      showNotice();
      return true;
    }

    function scheduleEnhance(records) {
      if (state.enhanceScheduled) return;
      const root = workspace();
      const touchedWorkspace = records.some((record) => root && (record.target === root || root.contains(record.target)));
      if (!touchedWorkspace && !shouldEnhanceMutation(records)) return;
      state.enhanceScheduled = true;
      const run = () => {
        state.enhanceScheduled = false;
        patchWorkspace(workspace());
        enhanceNow();
        if (state.dirty && state.snapshot) restoreDraft(workspace(), state.snapshot, doc);
      };
      if (typeof win.queueMicrotask === 'function') win.queueMicrotask(run);
      else Promise.resolve().then(run);
    }

    function attach() {
      const repair = win.__khaosDndUsabilityRepair;
      const root = workspace();
      if (!repair?.state || typeof repair.enhance !== 'function' || !root) {
        state.retry = win.setTimeout(attach, 25);
        return;
      }

      patchWorkspace(root);
      repair.state.observer?.disconnect?.();
      const observer = new win.MutationObserver((records) => scheduleEnhance(records));
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      repair.state.observer = observer;
      state.observer = observer;

      doc.addEventListener('input', (event) => markDirty(event.target), true);
      doc.addEventListener('change', (event) => {
        if (event.target?.id === 'dndCampaignSelect' && state.dirty) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const current = state.snapshot?.controls?.find((item) => item.key === 'id:dndCampaignSelect');
          if (current) event.target.value = current.value;
          notify('Save or discard the current D&D edits before changing campaigns.');
          showNotice();
          return;
        }
        markDirty(event.target);
        if (hasDndDataAttribute(event.target) && event.target?.id !== 'dndCampaignSelect') state.commitPending = true;
      }, true);
      doc.addEventListener('click', (event) => {
        const draftAction = event.target?.closest?.('[data-dnd-draft-action]')?.dataset.dndDraftAction;
        if (draftAction === 'keep') {
          event.preventDefault();
          removeNotice();
          return;
        }
        if (draftAction === 'discard') {
          event.preventDefault();
          clearDraft({ applyPending: true });
          notify('Unsaved D&D edits were discarded.');
          return;
        }
        if (protectNavigation(event)) return;
        const action = actionName(event.target);
        if (isCommitAction(action)) state.commitPending = true;
      }, true);

      if (typeof win.khaos?.onDnd === 'function') {
        win.khaos.onDnd(() => {
          if (state.commitPending) finishCommit();
          else if (state.dirty && state.pendingHtml !== null) showNotice();
        });
      }

      win.__khaosDndUsabilityStability = {
        state,
        observer,
        captureDraft: () => captureDraft(workspace(), doc),
        discardDraft: () => clearDraft({ applyPending: true }),
        disconnect() {
          if (state.retry) win.clearTimeout(state.retry);
          observer.disconnect();
        }
      };
    }

    attach();
    return win.__khaosDndUsabilityStability;
  }

  return {
    EDITABLE_SELECTOR,
    nodeRestoresBaseWorkspace,
    shouldEnhanceMutation,
    isCommitAction,
    shouldBlockWorkspaceRender,
    captureDraft,
    restoreDraft,
    install
  };
});
