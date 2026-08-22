'use strict';

(() => {
  if (window.__khaosMobileOwnerTestBadgeInstalled) return;
  window.__khaosMobileOwnerTestBadgeInstalled = true;

  function installBadge() {
    if (!document.body || document.getElementById('khaosMobileOwnerTestBadge')) return;

    document.documentElement.dataset.khaosMobileOwnerTest = 'true';

    const badge = document.createElement('div');
    badge.id = 'khaosMobileOwnerTestBadge';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-label', 'Mobile Owner Test build');
    badge.textContent = 'MOBILE OWNER TEST • ADR-009';
    Object.assign(badge.style, {
      position: 'fixed',
      right: '18px',
      bottom: '14px',
      zIndex: '2147483000',
      padding: '7px 10px',
      border: '1px solid rgba(255, 55, 92, 0.55)',
      borderRadius: '999px',
      background: 'rgba(20, 7, 12, 0.94)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      color: '#ff4f6d',
      font: '700 10px/1.2 Inter, system-ui, sans-serif',
      letterSpacing: '0.08em',
      pointerEvents: 'none'
    });
    document.body.appendChild(badge);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installBadge, { once: true });
  } else {
    installBadge();
  }
})();
