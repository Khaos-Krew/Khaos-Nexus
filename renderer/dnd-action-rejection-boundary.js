'use strict';

(function bootstrapDndActionRejectionBoundary(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.addEventListener) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndActionRejectionBoundaryFactory() {
  const REMOTE_DND_INVOCATION = /Error invoking remote method ['"]dnd:[a-z0-9:-]+['"]/i;

  function rejectionText(reason) {
    if (reason instanceof Error) return `${reason.code || ''} ${reason.message || ''} ${reason.stack || ''}`;
    if (reason && typeof reason === 'object') return `${reason.code || ''} ${reason.message || ''} ${reason.stack || ''}`;
    return String(reason || '');
  }

  function isReportedDndInvokeRejection(reason) {
    return REMOTE_DND_INVOCATION.test(rejectionText(reason));
  }

  function install(win) {
    if (!win?.addEventListener || win.__khaosDndActionRejectionBoundary) {
      return win?.__khaosDndActionRejectionBoundary || null;
    }

    const onUnhandledRejection = (event) => {
      if (!isReportedDndInvokeRejection(event?.reason)) return;
      // The preload boundary already captured and redacted this failed IPC call,
      // and the D&D call helper already displayed the visible error. Suppress only
      // the duplicate default/unhandled path; unrelated programming failures remain visible.
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
    };

    win.addEventListener('unhandledrejection', onUnhandledRejection, true);
    const api = {
      onUnhandledRejection,
      disconnect() {
        win.removeEventListener?.('unhandledrejection', onUnhandledRejection, true);
        delete win.__khaosDndActionRejectionBoundary;
      }
    };
    win.__khaosDndActionRejectionBoundary = api;
    return api;
  }

  return {
    REMOTE_DND_INVOCATION,
    rejectionText,
    isReportedDndInvokeRejection,
    install
  };
});
