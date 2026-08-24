'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  if (!api || !content) return;

  function cardByHeading(...labels) {
    return [...content.querySelectorAll('.card')].find((card) => labels.includes(card.querySelector('h3')?.textContent.trim())) || null;
  }

  function sectionByHeading(label) {
    return [...content.querySelectorAll('.section-head')].find((section) => section.querySelector('h3')?.textContent.trim() === label) || null;
  }

  function enhanceServerShopAuthority() {
    const discoveryCard = cardByHeading('Rank / SKU discovery', 'Rank authority discovery');
    if (!discoveryCard || discoveryCard.dataset.serverShopEnhanced === 'true') return;
    const serverShopRows = [...discoveryCard.querySelectorAll('.admin-op-row')].filter((row) => row.querySelector('small')?.textContent.includes('server-shop-managed'));
    if (!serverShopRows.length) return;

    discoveryCard.dataset.serverShopEnhanced = 'true';
    const heading = discoveryCard.querySelector('h3');
    if (heading) heading.textContent = 'Rank authority discovery';

    serverShopRows.forEach((row) => {
      const small = row.querySelector('small');
      if (small) small.textContent = small.textContent.replace('SKU: server-shop-managed', 'Paid access: Server Shop managed');
      const result = row.querySelector('.badge');
      if (result) {
        result.textContent = 'Ready';
        result.classList.remove('warn', 'bad');
        result.classList.add('good');
      }
    });

    const note = discoveryCard.querySelector('.field-note');
    if (note && !note.textContent.includes('Authority:')) note.textContent = `Authority: Discord Server Shop roles • ${note.textContent}`;
    const authorityNote = document.createElement('p');
    authorityNote.className = 'field-note';
    authorityNote.dataset.serverShopNote = 'true';
    authorityNote.textContent = 'Discord Server Shop roles are authoritative. Premium App SKU mappings are not required for the paid ranks.';
    discoveryCard.appendChild(authorityNote);

    const acceptance = sectionByHeading('Acceptance discovery');
    if (acceptance?.querySelector('p')) acceptance.querySelector('p').textContent = 'Read-only checks for Discord rank authority, optional Premium App SKUs, and the hosted provider runtime.';

    const supporter = sectionByHeading('Supporter ranks & entitlements');
    if (supporter?.querySelector('p')) supporter.querySelector('p').textContent = 'Paid ranks currently come from Discord Server Shop roles. Nexus observes those roles and owns only the free Shadow Recruit baseline unless Premium App SKU mappings are explicitly configured later.';

    const syncButton = document.getElementById('syncRanks');
    if (syncButton) syncButton.textContent = 'Sync free rank baseline';
  }

  function installDiscoveryButton() {
    enhanceServerShopAuthority();
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
        const serverShop = discovery.authority === 'server-shop-roles';
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
          if (!serverShop && skuInput && !skuInput.value.trim() && skuIds.length) {
            skuInput.value = skuIds.join(', ');
            skuFields += 1;
          }
        });

        const counts = discovery.counts || {};
        const message = roleFields || skuFields
          ? serverShop
            ? `Filled ${roleFields} role mapping${roleFields === 1 ? '' : 's'}. Server Shop paid ranks do not require Premium App SKU IDs. Review the roles, then press Save mappings.`
            : `Filled ${roleFields} role mapping${roleFields === 1 ? '' : 's'} and ${skuFields} SKU mapping field${skuFields === 1 ? '' : 's'}. Review them, then press Save mappings.`
          : counts.attention
            ? `No new exact mappings could be filled. ${counts.attention} rank${counts.attention === 1 ? '' : 's'} still need manual attention.`
            : serverShop
              ? 'All Server Shop rank-role mappings are ready. Premium App SKU IDs are not required.'
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
