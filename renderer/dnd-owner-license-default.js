'use strict';

(function bootstrapLicenseDefault(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function licenseDefaultFactory() {
  function applySafeSourceDefault(modal) {
    const form = modal?.querySelector?.('#dndOwnerSourceForm');
    if (!form) return false;
    const id = form.elements?.id?.value || '';
    if (id) return false;
    const license = form.elements?.licenseType;
    const fullText = form.elements?.isFullTextAllowed;
    if (license) license.value = 'metadata_only';
    if (fullText) fullText.checked = false;
    return true;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndLicenseDefault) return win?.__khaosDndLicenseDefault || null;
    const observer = new win.MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes || []) {
          if (node.nodeType === 1 && (node.id === 'dndOwnerModal' || node.querySelector?.('#dndOwnerSourceForm'))) applySafeSourceDefault(node);
        }
      }
    });
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    const current = win.document.getElementById('dndOwnerModal');
    if (current) applySafeSourceDefault(current);
    const api = { observer, applySafeSourceDefault };
    win.__khaosDndLicenseDefault = api;
    return api;
  }

  return { applySafeSourceDefault, install };
});
