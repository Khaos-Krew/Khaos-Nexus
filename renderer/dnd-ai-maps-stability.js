'use strict';

(function installDndAiMapStability(win) {
  const api = win?.__khaosDndAiMaps;
  const root = win?.document?.getElementById('view-dnd');
  if (!api || !root || win.__khaosDndAiMapStability) return;

  api.state.observer?.disconnect?.();
  const observer = new MutationObserver(() => {
    const mapsView = root.querySelector('.dnd-live-maps');
    if (mapsView && !mapsView.querySelector('[data-dnd-ai-map-studio]')) api.schedule();
  });
  observer.observe(root, { childList: true, subtree: true });
  api.state.observer = observer;

  root.addEventListener('input', (event) => {
    if (!event.target.closest?.('#dndAiMapForm')) return;
    const preview = root.querySelector('.dnd-ai-map-preview');
    if (!preview || !api.state.preview) return;
    api.state.preview = null;
    preview.className = 'dnd-ai-map-preview empty-state';
    preview.innerHTML = '<p>The form changed. Preview the exact normalized request again before generation.</p>';
  });

  win.__khaosDndAiMapStability = { observer };
})(window);
