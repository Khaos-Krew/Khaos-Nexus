'use strict';

const { ButtonInteraction, MessageFlags } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { BackendClient } = require('./backend-client.cjs');
const {
  minimumCreatorLevel,
  evaluateCreatorEligibility,
  eligibilityMessage
} = require('./creator-level-gate.cjs');

const INSTALLED = Symbol.for('khaos.nexus.creatorLevelGate.extension');
const APPLY_BUTTON_ID = 'kn:creator:apply';

function installCreatorLevelGateExtension() {
  if (ButtonInteraction.prototype[INSTALLED]) return;
  ButtonInteraction.prototype[INSTALLED] = true;

  const config = loadConfig();
  const backend = new BackendClient(config);
  const minimumLevel = minimumCreatorLevel(config);
  const originalShowModal = ButtonInteraction.prototype.showModal;

  ButtonInteraction.prototype.showModal = async function nexusCreatorLevelGateShowModal(modal, ...args) {
    if (String(this.customId || '') !== APPLY_BUTTON_ID) {
      return originalShowModal.call(this, modal, ...args);
    }

    let response = null;
    try {
      response = await backend.communityLevel(String(this.user?.id || ''));
    } catch {
      response = { ok: false };
    }
    const eligibility = evaluateCreatorEligibility(response, minimumLevel);
    if (!eligibility.eligible) {
      await this.reply({
        content: eligibilityMessage(eligibility),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
      return undefined;
    }

    return originalShowModal.call(this, modal, ...args);
  };
}

module.exports = {
  APPLY_BUTTON_ID,
  installCreatorLevelGateExtension
};
