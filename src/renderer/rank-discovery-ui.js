'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  if (!api || !content) return;

  function installDiscoveryButton() {
    const save = document.getElementById('saveRankMap');
    if (!save || document.getElementById('discoverRankMap')) return;
    const actions = save.closest('.actions');
    if (!actions) return;

    const button = document.createElement('button');
    button.id = 'discoverRankMap';
    button.className = 'secondary';
    button.textContent = 'Discover matching roles & SKUs';
    actions.insertBefore(button, save);

    const note = document.createElement('p');
    note.className = 'field-note';
    note.textContent = 'Discovery fills only blank fields from exact, unambiguous Discord matches. Review the results, then press Save mappings.';
    actions.parentElement?.appendChild(note);

    button.onclick = async () => {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Discovering…';
      try {
        const scan = await api.sentinalScan();
        const discovery = scan?.sections?.rankDiscovery;
        if (!discovery || discovery.error) throw new Error(discovery?.error || 'Rank discovery is unavailable.');
        const suggestions = discovery.suggestedSettings || {};
        let roleFields = 0;
        let skuFields = 0;

        content.querySelectorAll('.rank-config-row').forEach((row) => {
          const id = row.dataset.rank;
          const roleInput = row.querySelector('[data-rank-role]');
          const skuInput = row.querySelector('[data-rank-skus]');
          const roleId = String(suggestions.rankRoles?.[id] || '');
          const skuIds = Array.isArray(suggestions.rankSkus?.[id]) ? suggestions.rankSkus[id] : [];
          if (roleInput && !roleInput.value.trim() && roleId) {
            roleInput.value = roleId;
            roleFields += 1;
          }
          if (skuInput && !skuInput.value.trim() && skuIds.length) {
            skuInput.value = skuIds.join(', ');
            skuFields += 1;
          }
        });

        const counts = discovery.counts || {};
        const message = roleFields || skuFields
          ? `Filled ${roleFields} role mapping${roleFields === 1 ? '' : 's'} and ${skuFields} SKU mapping field${skuFields === 1 ? '' : 's'}. Review them, then press Save mappings.`
          : counts.attention
            ? `No new exact mappings could be filled. ${counts.attention} rank${counts.attention === 1 ? '' : 's'} still need manual attention.`
            : 'All discoverable mappings are already filled.';
        window.alert(message);
      } catch (error) {
        window.alert(error.message || String(error));
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    };
  }

  const observer = new MutationObserver(installDiscoveryButton);
  observer.observe(content, { childList: true, subtree: true });
  installDiscoveryButton();
})();
