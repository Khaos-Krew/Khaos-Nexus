'use strict';

(function bootstrapDndAiHomebrewContract(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndAiHomebrewContractFactory() {
  const CONTENT_TYPES = ['subclass', 'species', 'feat', 'spell', 'item', 'monster', 'background', 'encounter', 'setting-element'];
  const TARGET_TIERS = ['any', 'low', 'mid', 'high', 'epic'];
  const POWER_LEVELS = ['conservative', 'standard', 'cinematic'];
  const CONTENT_ALIASES = { class: 'subclass', 'rule-module': 'setting-element', other: 'setting-element' };
  const TIER_ALIASES = { none: 'any', 'tier-1': 'low', 'tier-2': 'mid', 'tier-3': 'high', 'tier-4': 'epic' };
  const POWER_ALIASES = { low: 'conservative', high: 'cinematic' };

  function alignInput(input = {}) {
    input.contentType = CONTENT_ALIASES[input.contentType] || input.contentType || 'setting-element';
    input.targetTier = TIER_ALIASES[input.targetTier] || input.targetTier || 'any';
    input.powerLevel = POWER_ALIASES[input.powerLevel] || input.powerLevel || 'standard';
    return input;
  }

  function setOptions(select, values, current, labels = {}) {
    if (!select) return;
    const signature = values.join('|');
    if (select.dataset.aiContractOptions !== signature) {
      select.innerHTML = values.map((value) => `<option value="${value}">${labels[value] || value}</option>`).join('');
      select.dataset.aiContractOptions = signature;
    }
    select.value = values.includes(current) ? current : values[0];
  }

  function patchForm(win, controller) {
    const form = win.document.getElementById('dndAiHomebrewForm');
    if (!form || !controller?.state) return false;
    const input = alignInput(controller.state.input || {});
    setOptions(form.elements.contentType, CONTENT_TYPES, input.contentType, { 'setting-element': 'setting element' });
    setOptions(form.elements.targetTier, TARGET_TIERS, input.targetTier);
    setOptions(form.elements.powerLevel, POWER_LEVELS, input.powerLevel);
    if (form.elements.concept) form.elements.concept.maxLength = 4000;
    if (form.elements.system) form.elements.system.maxLength = 100;
    if (form.elements.titleHint) form.elements.titleHint.maxLength = 160;
    for (const field of form.querySelectorAll('textarea[name^="inspirationSignals"]')) field.maxLength = 2880;
    return true;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndAiHomebrewContract) return win?.__khaosDndAiHomebrewContract || null;
    let timer = null;
    let observer = null;
    let scheduled = false;

    function schedulePatch() {
      if (scheduled) return;
      scheduled = true;
      win.setTimeout(() => {
        scheduled = false;
        const controller = win.__khaosDndAiHomebrew;
        if (!controller) return;
        patchForm(win, controller);
      }, 0);
    }

    function attach() {
      const controller = win.__khaosDndAiHomebrew;
      const rootElement = win.document.getElementById('view-dnd');
      if (!controller || !rootElement) {
        timer = win.setTimeout(attach, 50);
        return;
      }
      alignInput(controller.state.input);
      patchForm(win, controller);
      observer = new win.MutationObserver(schedulePatch);
      observer.observe(rootElement, { childList: true, subtree: true });
      win.document.addEventListener('change', (event) => {
        if (!event.target.closest?.('#dndAiHomebrewForm')) return;
        const form = event.target.form;
        if (event.target.name === 'contentType') controller.state.input.contentType = form.elements.contentType.value;
        if (event.target.name === 'targetTier') controller.state.input.targetTier = form.elements.targetTier.value;
        if (event.target.name === 'powerLevel') controller.state.input.powerLevel = form.elements.powerLevel.value;
      }, true);
    }

    const api = {
      disconnect() {
        if (timer) win.clearTimeout(timer);
        observer?.disconnect();
        delete win.__khaosDndAiHomebrewContract;
      }
    };
    win.__khaosDndAiHomebrewContract = api;
    attach();
    return api;
  }

  return { install, alignInput, setOptions, patchForm };
});
