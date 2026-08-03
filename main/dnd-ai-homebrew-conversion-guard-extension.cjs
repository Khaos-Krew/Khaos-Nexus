'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiHomebrewConversionGuard) return;

  class DndAiHomebrewConversionGuardStore extends Original {
    convertDndAiHomebrewProposal(input = {}) {
      const result = super.convertDndAiHomebrewProposal(input);
      const removed = this.removeDndAiHomebrewProposal(result.proposal.id);
      if (!removed) {
        throw Object.assign(new Error('The AI proposal converted successfully, but it could not be removed from the proposal queue.'), {
          code: 'DND_AI_HOMEBREW_PROPOSAL_MOVE_FAILED',
          homebrewId: result.homebrew.id
        });
      }
      return { ...result, proposalRemoved: true };
    }
  }

  Object.defineProperty(DndAiHomebrewConversionGuardStore, '__khaosDndAiHomebrewConversionGuard', { value: true });
  target.ConfigStore = DndAiHomebrewConversionGuardStore;
}

module.exports = { install };
