'use strict';

const OFFLINE_PASSIVE_CAP_HOURS = 48;

const NEXUS_ECONOMY_RANK_PERKS = Object.freeze({
  'shadow-recruit': Object.freeze({
    onlinePointsPerFiveMinutes: 2,
    offlinePointsPerHour: 0,
    shopText: 'Earn Nexus Points while actively playing on linked ARK servers.'
  }),
  'cipher-runner': Object.freeze({
    onlinePointsPerFiveMinutes: 4,
    offlinePointsPerHour: 4,
    shopText: 'Earn boosted Nexus Points while playing plus 4 Nexus Points per offline hour, accruing for up to 48 hours.'
  }),
  'nexus-raider': Object.freeze({
    onlinePointsPerFiveMinutes: 4,
    offlinePointsPerHour: 6,
    shopText: 'Earn boosted Nexus Points while playing plus 6 Nexus Points per offline hour, accruing for up to 48 hours.'
  }),
  'khaos-warden': Object.freeze({
    onlinePointsPerFiveMinutes: 4,
    offlinePointsPerHour: 8,
    shopText: 'Earn boosted Nexus Points while playing plus 8 Nexus Points per offline hour, accruing for up to 48 hours.'
  }),
  'blackout-legend': Object.freeze({
    onlinePointsPerFiveMinutes: 4,
    offlinePointsPerHour: 10,
    shopText: 'Earn boosted Nexus Points while playing plus 10 Nexus Points per offline hour, accruing for up to 48 hours.'
  }),
  'origin-founder': Object.freeze({
    onlinePointsPerFiveMinutes: 4,
    offlinePointsPerHour: 10,
    shopText: 'Legacy Founder economy perk: boosted online earnings plus 10 Nexus Points per offline hour, accruing for up to 48 hours.'
  })
});

function economyPerkForRank(rankId) {
  return NEXUS_ECONOMY_RANK_PERKS[String(rankId || '').trim().toLowerCase()] || NEXUS_ECONOMY_RANK_PERKS['shadow-recruit'];
}

module.exports = { OFFLINE_PASSIVE_CAP_HOURS, NEXUS_ECONOMY_RANK_PERKS, economyPerkForRank };
