'use strict';

const PROFILE_DEFINITIONS = Object.freeze({
  'community-pulse': Object.freeze({
    id: 'community-pulse',
    decisionRule: 'plurality',
    visibility: 'public',
    minVotes: 0,
    tieRule: 'no-decision',
    durationMinutes: 48 * 60,
    multiSelect: false,
    excludeCreator: false
  }),
  'yes-no-decision': Object.freeze({
    id: 'yes-no-decision',
    decisionRule: 'majority',
    visibility: 'results-after-close',
    minVotes: 5,
    tieRule: 'no-decision',
    durationMinutes: 48 * 60,
    multiSelect: false,
    excludeCreator: false,
    options: Object.freeze(['Yes', 'No'])
  }),
  'suggestion-gate': Object.freeze({
    id: 'suggestion-gate',
    decisionRule: 'threshold',
    visibility: 'public',
    minVotes: 5,
    thresholdPercent: 60,
    tieRule: 'no-decision',
    durationMinutes: 72 * 60,
    multiSelect: false,
    excludeCreator: true,
    options: Object.freeze(['Approve', 'Reject'])
  }),
  'event-scheduling': Object.freeze({
    id: 'event-scheduling',
    decisionRule: 'plurality',
    visibility: 'public',
    minVotes: 0,
    tieRule: 'staff-review',
    durationMinutes: 48 * 60,
    multiSelect: true,
    excludeCreator: false
  }),
  'staff-decision': Object.freeze({
    id: 'staff-decision',
    decisionRule: 'majority',
    visibility: 'results-after-close',
    minVotes: 2,
    tieRule: 'staff-review',
    durationMinutes: 24 * 60,
    multiSelect: false,
    excludeCreator: false
  }),
  'nexus-governance': Object.freeze({
    id: 'nexus-governance',
    decisionRule: 'supermajority',
    visibility: 'results-after-close',
    minVotes: 10,
    thresholdPercent: 66,
    tieRule: 'staff-review',
    durationMinutes: 72 * 60,
    multiSelect: false,
    excludeCreator: false
  })
});

function profileById(value = 'community-pulse') {
  const id = String(value || 'community-pulse').trim().toLowerCase();
  const profile = PROFILE_DEFINITIONS[id];
  if (!profile) throw new Error(`Unknown Nexus poll profile: ${id}`);
  return profile;
}

function applyPollProfile(input = {}, now = new Date()) {
  const profile = profileById(input.profile || 'community-pulse');
  const opensAt = input.opensAt ? new Date(input.opensAt) : new Date(now);
  if (Number.isNaN(opensAt.getTime())) throw new Error('Poll opensAt must be a valid date.');
  const closesAt = input.closesAt
    ? new Date(input.closesAt)
    : new Date(opensAt.getTime() + profile.durationMinutes * 60_000);
  if (Number.isNaN(closesAt.getTime())) throw new Error('Poll closesAt must be a valid date.');

  const options = Array.isArray(input.options) && input.options.length
    ? input.options
    : profile.options ? [...profile.options] : [];
  const multiSelect = input.multiSelect === undefined ? profile.multiSelect : input.multiSelect === true;

  return {
    ...profile,
    ...input,
    profile: profile.id,
    options,
    opensAt: opensAt.toISOString(),
    closesAt: closesAt.toISOString(),
    decisionRule: input.decisionRule || profile.decisionRule,
    visibility: input.visibility || profile.visibility,
    minVotes: input.minVotes === undefined ? profile.minVotes : input.minVotes,
    tieRule: input.tieRule || profile.tieRule,
    thresholdPercent: input.thresholdPercent === undefined ? profile.thresholdPercent : input.thresholdPercent,
    multiSelect,
    maxSelections: multiSelect ? (input.maxSelections || options.length || 1) : 1,
    excludeCreator: input.excludeCreator === undefined ? profile.excludeCreator : input.excludeCreator === true
  };
}

module.exports = {
  PROFILE_DEFINITIONS,
  applyPollProfile,
  profileById
};
