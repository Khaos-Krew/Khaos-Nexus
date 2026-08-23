'use strict';

function thoraReadyBadge(value, label) {
  return badge(label, value ? 'good' : 'warn');
}

function renderIntegratedThora() {
  const thora = draft.thora || {};
  const status = state.thora || {};
  const components = status.components || {};
  const desktopReady = components.desktop === true;
  const quickChatReady = components.quickChat === true;
  const companionReady = components.companion === true;
  const installText = status.installationDirectory
    ? `<p class="mono small-text">${esc(status.installationDirectory)}</p>`
    : '<p>No Thora installation was detected yet.</p>';

  content.innerHTML = `${grid([
    card('Private Household Thora', `${checkField('Enable Thora integration', 'thora.enabled', thora.enabled, 'Only Owner/Co-Owner PCs use this private bridge. Thora keeps its own account, household, memory and rewards data.')}<div class="badges">${thoraReadyBadge(desktopReady, 'Desktop')}${thoraReadyBadge(quickChatReady, 'Quick Chat')}${thoraReadyBadge(companionReady, 'Companion')}</div>${installText}<div class="actions">${button('Detect / choose Thora', 'chooseThora', 'class="secondary"')}${button('Save integration', 'saveThora', 'class="primary"')}</div>`),
    card('Assistant Controls', `<p>Open the part of Thora you want without navigating through a second launcher.</p><div class="actions wrap">${button('Open Thora', 'thoraHome', desktopReady ? '' : 'disabled')}${button('Quick Chat', 'thoraChat', quickChatReady ? 'class="primary"' : 'disabled')}${button('Personal AI', 'thoraPersonal', desktopReady ? '' : 'disabled')}${button('Rewards', 'thoraRewards', desktopReady ? '' : 'disabled')}${button('Household', 'thoraHousehold', desktopReady ? '' : 'disabled')}${button('Companion Studio', 'thoraCompanionStudio', desktopReady ? '' : 'disabled')}${button('Start Companion', 'thoraCompanion', companionReady ? '' : 'disabled')}</div>`),
    card('Privacy Boundary', '<p><strong>Nexus does not import Thora memory, conversations, rewards, Supabase sessions or OpenAI credentials.</strong></p><p>The processes run under the current Windows user, so each person retains their own Thora sign-in/session while shared household data continues to use Thora\'s existing household and RLS model.</p>')
  ])}`;

  bindDraftInputs(content);
  document.getElementById('chooseThora').onclick = async () => {
    try {
      state = await api.chooseThora();
      draft = clone(state.settings);
      notify(state.thora?.configured ? 'Thora installation selected.' : 'Thora selection updated.');
      show('thora');
    } catch (error) { notify(error.message || String(error), 'bad'); }
  };
  document.getElementById('saveThora').onclick = () => saveDraft('Private Thora integration settings saved.');

  const targets = {
    thoraHome: 'home',
    thoraChat: 'quick-chat',
    thoraPersonal: 'personal',
    thoraRewards: 'rewards',
    thoraHousehold: 'household',
    thoraCompanionStudio: 'companion-studio',
    thoraCompanion: 'companion'
  };
  Object.entries(targets).forEach(([id, target]) => {
    const element = document.getElementById(id);
    if (!element || element.disabled) return;
    element.onclick = async () => {
      try {
        await api.launchThora(target);
        notify(`Thora ${human(target)} opened.`);
      } catch (error) { notify(error.message || String(error), 'bad'); }
    };
  });
}

views.thora = {
  title: 'Thora',
  subtitle: 'Private household AI, Quick Chat, rewards and companion controls',
  render: renderIntegratedThora
};
