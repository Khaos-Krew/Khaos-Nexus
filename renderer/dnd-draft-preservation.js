'use strict';

(() => {
  if (window.__khaosDndDraftPreservationLoaded) return;
  window.__khaosDndDraftPreservationLoaded = true;

  const state = {
    root: null,
    descriptor: null,
    dirty: false,
    pendingHtml: null,
    lastAppliedHtml: null,
    allowUntil: 0,
    applying: false,
    patchTimer: null
  };

  const editableSelector = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"]';
  const draftScopeSelector = '.form-panel, form, .dnd-editor, [data-dnd-draft-scope], .dnd-form, .modal, .dialog';
  const commitPattern = /\b(save|create|update|apply|add|publish|install|import|generate|confirm|submit)\b/i;

  function isInsideRoot(node) {
    return Boolean(state.root && node instanceof Node && state.root.contains(node));
  }

  function isDraftControl(node) {
    if (!(node instanceof Element) || !node.matches(editableSelector) || !isInsideRoot(node)) return false;
    if (node.closest('[data-dnd-refresh-status]')) return false;
    if (node.id === 'dndCampaignSelect') return false;
    if (node.matches('[type="search"], [data-dnd-filter], [data-dnd-search]')) return false;
    return Boolean(node.closest(draftScopeSelector));
  }

  function isCommitControl(node) {
    const button = node instanceof Element ? node.closest('button, [role="button"]') : null;
    if (!button || !isInsideRoot(button)) return false;
    const action = [
      button.dataset.dndAction,
      button.dataset.dndNpcAction,
      button.dataset.dndMapAction,
      button.dataset.dndPanelAction,
      button.dataset.dndContentAction,
      button.getAttribute('aria-label'),
      button.textContent
    ].filter(Boolean).join(' ');
    return commitPattern.test(action);
  }

  function captureUiState() {
    if (!state.root) return null;
    const active = document.activeElement;
    const focus = active && state.root.contains(active) ? {
      id: active.id || '',
      name: active.getAttribute?.('name') || '',
      dataAction: active.getAttribute?.('data-dnd-action') || '',
      selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
      selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
    } : null;
    const workspace = document.querySelector('main.content');
    return {
      focus,
      rootScrollTop: state.root.scrollTop,
      rootScrollLeft: state.root.scrollLeft,
      workspaceScrollTop: workspace?.scrollTop || 0,
      workspaceScrollLeft: workspace?.scrollLeft || 0
    };
  }

  function restoreUiState(snapshot) {
    if (!snapshot || !state.root) return;
    state.root.scrollTop = snapshot.rootScrollTop;
    state.root.scrollLeft = snapshot.rootScrollLeft;
    const workspace = document.querySelector('main.content');
    if (workspace) {
      workspace.scrollTop = snapshot.workspaceScrollTop;
      workspace.scrollLeft = snapshot.workspaceScrollLeft;
    }
    const focus = snapshot.focus;
    if (!focus) return;
    let target = null;
    if (focus.id) target = document.getElementById(focus.id);
    if (!target && focus.name) target = state.root.querySelector(`[name="${CSS.escape(focus.name)}"]`);
    if (!target && focus.dataAction) target = state.root.querySelector(`[data-dnd-action="${CSS.escape(focus.dataAction)}"]`);
    if (!target || typeof target.focus !== 'function') return;
    target.focus({ preventScroll: true });
    if (focus.selectionStart != null && typeof target.setSelectionRange === 'function') {
      try { target.setSelectionRange(focus.selectionStart, focus.selectionEnd ?? focus.selectionStart); } catch {}
    }
  }

  function removeStatus() {
    state.root?.querySelector('[data-dnd-refresh-status]')?.remove();
  }

  function renderStatus() {
    if (!state.root) return;
    removeStatus();
    if (!state.dirty && !state.pendingHtml) return;
    const banner = document.createElement('div');
    banner.className = 'dnd-draft-refresh-status';
    banner.dataset.dndRefreshStatus = 'true';
    banner.setAttribute('role', 'status');

    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Unsaved changes protected';
    const detail = document.createElement('span');
    detail.textContent = state.pendingHtml
      ? 'New live data is waiting. Save your changes or discard the draft to refresh.'
      : 'Background refresh is paused while you edit.';
    copy.append(title, detail);
    banner.appendChild(copy);

    if (state.pendingHtml) {
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.className = 'button';
      discard.textContent = 'Discard Draft & Refresh';
      discard.addEventListener('click', () => {
        const html = state.pendingHtml;
        state.dirty = false;
        state.pendingHtml = null;
        state.allowUntil = Date.now() + 1000;
        applyHtml(html, 'discard');
      });
      banner.appendChild(discard);
    }

    state.root.prepend(banner);
  }

  function markDirty() {
    if (state.dirty) return;
    state.dirty = true;
    renderStatus();
  }

  function beginCommit() {
    state.dirty = false;
    state.pendingHtml = null;
    state.allowUntil = Date.now() + 10000;
    removeStatus();
  }

  function applyHtml(value, reason = 'render') {
    if (!state.root || !state.descriptor) return;
    const html = String(value ?? '');
    const snapshot = captureUiState();
    state.applying = true;
    try {
      state.descriptor.set.call(state.root, html);
      state.lastAppliedHtml = html;
    } finally {
      state.applying = false;
    }
    if (reason !== 'discard') renderStatus();
    requestAnimationFrame(() => restoreUiState(snapshot));
  }

  function patchRoot(root) {
    if (!root || root.__khaosDraftPreservationPatched) return;
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!descriptor?.get || !descriptor?.set) return;

    state.root = root;
    state.descriptor = descriptor;
    state.lastAppliedHtml = descriptor.get.call(root);

    Object.defineProperty(root, 'innerHTML', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        const html = String(value ?? '');
        if (state.applying) {
          descriptor.set.call(this, html);
          return;
        }
        if (html === state.lastAppliedHtml) return;
        if (state.dirty && Date.now() > state.allowUntil) {
          state.pendingHtml = html;
          renderStatus();
          return;
        }
        applyHtml(html, 'render');
      }
    });

    Object.defineProperty(root, '__khaosDraftPreservationPatched', { value: true });
    renderStatus();
  }

  function findAndPatchRoot() {
    const root = document.getElementById('view-dnd');
    if (root) {
      patchRoot(root);
      if (state.patchTimer) {
        clearInterval(state.patchTimer);
        state.patchTimer = null;
      }
    }
  }

  document.addEventListener('input', (event) => {
    if (isDraftControl(event.target)) markDirty();
  }, true);

  document.addEventListener('change', (event) => {
    if (isDraftControl(event.target)) markDirty();
  }, true);

  document.addEventListener('click', (event) => {
    if (isCommitControl(event.target)) beginCommit();
  }, true);

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.dirty) {
      const active = document.activeElement;
      const panel = active instanceof Element ? active.closest(draftScopeSelector) : null;
      const save = panel?.querySelector('button[data-dnd-action^="save-"], button[data-dnd-action*="save"], button.primary');
      if (save && !save.disabled) {
        event.preventDefault();
        save.click();
      }
    }
  }, true);

  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', findAndPatchRoot, { once: true });
  } else {
    findAndPatchRoot();
  }
  state.patchTimer = setInterval(findAndPatchRoot, 250);
  state.patchTimer.unref?.();
})();
