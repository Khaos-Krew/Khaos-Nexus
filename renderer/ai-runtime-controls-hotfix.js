'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  let busy = false;
  let pollTimer = null;

  function toast(message) {
    const element = byId('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 4200);
  }

  function serviceState(payload, key) {
    return payload?.services?.find((service) => service.key === key) || { key, status: 'stopped', error: '' };
  }

  function statusTone(status) {
    const value = String(status || '').toLowerCase();
    if (['running', 'ready'].includes(value)) return 'good';
    if (value === 'failed') return 'bad';
    return '';
  }

  function updateCard(key, service) {
    const prefix = key === 'dnd' ? 'dndAi' : 'nexusAi';
    const badge = byId(`${prefix}ServiceBadge`);
    const runtime = byId(`${prefix}ServiceRuntime`);
    if (badge) {
      badge.textContent = service.status || 'stopped';
      badge.className = `tag ${statusTone(service.status)}`.trim();
    }
    if (runtime) {
      runtime.textContent = service.error
        ? `Error: ${service.error}`
        : service.endpoint || (service.version ? `Version ${service.version}` : 'Bundled / isolated');
    }
    document.querySelectorAll(`[data-ai-service="${key}"]`).forEach((button) => {
      const action = button.dataset.aiAction;
      const active = ['starting', 'running', 'ready', 'stopping'].includes(service.status);
      button.disabled = busy || (action === 'start' && active) || ((action === 'stop' || action === 'restart') && !active);
    });
  }

  async function refresh() {
    try {
      const payload = await window.khaos.invoke('ai:runtimes-status');
      updateCard('dnd', serviceState(payload, 'dnd'));
      updateCard('core', serviceState(payload, 'core'));
    } catch (error) {
      updateCard('dnd', { status: 'failed', error: error?.message || 'Unable to read service status.' });
      updateCard('core', { status: 'failed', error: error?.message || 'Unable to read service status.' });
    }
  }

  async function perform(action, service) {
    if (busy) return;
    busy = true;
    await refresh();
    try {
      await window.khaos.invoke(`ai:runtimes-${action}`, { service });
      toast(`${service === 'all' ? 'AI services' : service === 'dnd' ? 'D&D AI' : 'Nexus AI Core'} ${action} requested.`);
    } catch (error) {
      toast(error?.message || `Unable to ${action} AI service.`);
      window.khaos?.reportRendererActionError?.({
        source: 'ai-runtime-controls',
        operation: `${action}-${service}`,
        message: error?.message || `Unable to ${action} AI service.`
      });
    } finally {
      busy = false;
      setTimeout(refresh, 350);
    }
  }

  function controls(key) {
    return `<div class="nexus-inline-actions ai-runtime-actions" aria-label="AI service controls">
      <button class="button primary" type="button" data-ai-action="start" data-ai-service="${key}">Start</button>
      <button class="button" type="button" data-ai-action="restart" data-ai-service="${key}">Restart</button>
      <button class="button" type="button" data-ai-action="stop" data-ai-service="${key}">Stop</button>
    </div>`;
  }

  function install() {
    const dndCard = document.querySelector('.service-dnd-ai');
    const coreCard = document.querySelector('.service-core-ai');
    if (!dndCard || !coreCard) {
      setTimeout(install, 100);
      return;
    }
    if (document.querySelector('.ai-runtime-actions')) return;

    dndCard.insertAdjacentHTML('beforeend', controls('dnd'));
    coreCard.insertAdjacentHTML('beforeend', controls('core'));

    const heroButton = document.querySelector('.nexus-ai-hero [data-khaos-open="ai"]');
    if (heroButton) {
      heroButton.removeAttribute('data-khaos-open');
      heroButton.dataset.aiAction = 'start';
      heroButton.dataset.aiService = 'all';
      heroButton.textContent = 'Start All AI Services';
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-ai-action][data-ai-service]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      perform(button.dataset.aiAction, button.dataset.aiService);
    });

    refresh();
    pollTimer = setInterval(refresh, 2500);
    window.addEventListener('beforeunload', () => clearInterval(pollTimer), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
