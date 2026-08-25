'use strict';

const DEFAULT_MINIMUM_LEVEL = 10;

function minimumCreatorLevel(config = {}, env = process.env) {
  const configured = Number(config.discord?.creatorProgram?.minimumLevel ?? config.creatorProgram?.minimumLevel ?? env.NEXUS_CREATOR_MIN_LEVEL ?? DEFAULT_MINIMUM_LEVEL);
  if (!Number.isFinite(configured)) return DEFAULT_MINIMUM_LEVEL;
  return Math.max(1, Math.min(1000, Math.floor(configured)));
}

function evaluateCreatorEligibility(profileResponse, minimumLevel = DEFAULT_MINIMUM_LEVEL) {
  const requiredLevel = Math.max(1, Number(minimumLevel) || DEFAULT_MINIMUM_LEVEL);
  if (!profileResponse?.ok || !profileResponse?.profile) {
    return {
      eligible: false,
      verifiable: false,
      currentLevel: 0,
      requiredLevel,
      reason: 'level-unavailable'
    };
  }
  const currentLevel = Math.max(1, Number(profileResponse.profile.level) || 1);
  return {
    eligible: currentLevel >= requiredLevel,
    verifiable: true,
    currentLevel,
    requiredLevel,
    reason: currentLevel >= requiredLevel ? 'eligible' : 'level-too-low'
  };
}

function eligibilityMessage(result = {}) {
  if (!result.verifiable) {
    return '⚠️ Nexus could not verify your Community Level right now, so the Creator Program application cannot be opened. Please try again later.';
  }
  if (!result.eligible) {
    return `🔒 The Content Creator Program unlocks at **Nexus Community Level ${result.requiredLevel}**. You are currently **Level ${result.currentLevel}**. Keep participating in the community and try again once you reach the requirement.`;
  }
  return `✅ Creator Program application unlocked at Community Level ${result.currentLevel}.`;
}

module.exports = {
  DEFAULT_MINIMUM_LEVEL,
  minimumCreatorLevel,
  evaluateCreatorEligibility,
  eligibilityMessage
};
