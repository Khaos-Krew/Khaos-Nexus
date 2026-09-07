'use strict';

const { PROTOCOL_DEFINITIONS, PROTOCOL_STATES, DARK_ZONE_STATES } = require('./nexus-protocol-core.cjs');

function clean(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function formatState(value) {
  const state = clean(value, 48).replace(/_/g, ' ');
  return state ? state.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Unknown';
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(Number(ms || 0) / 60000));
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function protocolSummary(snapshot = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  const activeRuns = Object.values(snapshot.protocolRuns || {})
    .filter((run) => [PROTOCOL_STATES.ACTIVE, PROTOCOL_STATES.PARTIAL_ACTIVATION, PROTOCOL_STATES.CALIBRATING, PROTOCOL_STATES.FORGING].includes(run.state))
    .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
  const fields = activeRuns.slice(0, 10).map((run) => {
    const definition = PROTOCOL_DEFINITIONS[run.protocolId];
    const elapsed = run.startedAt ? formatDuration(now - run.startedAt) : 'Not started';
    return {
      name: `${definition?.name || run.protocolId} • ${clean(run.map || 'cluster', 80)}`,
      value: `State: **${formatState(run.state)}**\nElapsed: ${elapsed}${run.objectiveKey ? `\nObjective: ${clean(run.objectiveKey, 96)}` : ''}`,
      inline: false
    };
  });
  return {
    title: 'Nexus Protocol • Network Status',
    description: activeRuns.length
      ? `${activeRuns.length} Protocol ${activeRuns.length === 1 ? 'operation is' : 'operations are'} currently in progress.`
      : 'No Nexus Protocol operations are currently active.',
    fields,
    footer: { text: `Protocol store revision ${Number(snapshot.revision || 0)}` },
    components: [
      { type: 'button', customId: 'nexus_protocol_refresh', label: 'Refresh', style: 'secondary' },
      { type: 'button', customId: 'nexus_protocol_progress', label: 'My Progress', style: 'primary' },
      { type: 'button', customId: 'nexus_protocol_leaderboard', label: 'Protocol Score', style: 'secondary' },
      { type: 'button', customId: 'nexus_protocol_dark_zone', label: 'Dark Zone', style: 'secondary' }
    ]
  };
}

function leaderboardView(snapshot = {}, seasonId, rows = []) {
  const season = snapshot.seasons?.[seasonId] || null;
  const lines = rows.slice(0, 15).map((row) => `**#${row.rank}** • ${clean(row.accountId, 48)} — **${Number(row.score || 0)}** pts (${Number(row.runs || 0)} runs)`);
  return {
    title: `Nexus Protocol Score • ${clean(season?.name || seasonId || 'Season', 80)}`,
    description: lines.length ? lines.join('\n') : 'No eligible Protocol Score entries yet.',
    footer: { text: 'Only eligible completed participation records count toward seasonal Protocol Score.' }
  };
}

function participantProgressView(participant = {}, options = {}) {
  const runName = clean(options.runName || participant.runId || 'Current Protocol', 80);
  if (!participant || !participant.runId) {
    return {
      title: `Nexus Protocol • ${runName}`,
      description: 'No recorded Protocol progress for this operation yet.',
      footer: { text: 'Progress is read-only here and is calculated from the durable Protocol event ledger.' }
    };
  }
  const eligible = participant.eligible === true;
  const reasons = Array.isArray(participant.eligibilityReasons)
    ? participant.eligibilityReasons.map((reason) => clean(reason, 80)).filter(Boolean)
    : [];
  const lines = [
    `Protocol Score: **${Number(participant.score || 0)}**${eligible ? '' : ` (raw ${Number(participant.rawScore || 0)})`}`,
    `Eligibility: **${eligible ? 'Eligible' : 'Not yet eligible'}**`,
    `Active time: **${Number(participant.activeMinutes || 0)}m**`,
    `Objective contribution: **${Number(participant.objectiveContribution || 0)}**`,
    `Kill contribution: **${Number(participant.killContribution || 0)}**`,
    `Processed events: **${Number(participant.processedEvents || 0)}**`
  ];
  if (!eligible && reasons.length) lines.push(`Needs: ${reasons.join(', ')}`);
  if (participant.completed) lines.push('Completion recorded: **Yes**');
  return {
    title: `Nexus Protocol • ${runName}`,
    description: lines.join('\n'),
    footer: { text: 'Progress is read-only here and is calculated from the durable Protocol event ledger.' }
  };
}

function darkZoneView(record = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  const state = Object.values(DARK_ZONE_STATES).includes(record.state) ? record.state : DARK_ZONE_STATES.SAFE;
  const lines = [`State: **${formatState(state)}**`, `Enrollment: **${record.enrollmentMode === 'tribe' ? 'Tribe' : 'Solo'}**`];
  if (state === DARK_ZONE_STATES.ENLISTING && Number(record.effectiveAt || 0) > now) {
    lines.push(`Enlistment active in: **${formatDuration(record.effectiveAt - now)}**`);
  }
  if (state === DARK_ZONE_STATES.COOLDOWN && Number(record.safeAt || 0) > now) {
    lines.push(`PvE protection returns in: **${formatDuration(record.safeAt - now)}**`);
  }
  if (Array.isArray(record.registeredTameIds) && record.registeredTameIds.length) {
    lines.push(`Registered PvP tames: **${record.registeredTameIds.length}**`);
  }
  return {
    title: 'Nexus Protocol • Dark Zone',
    description: lines.join('\n'),
    footer: { text: 'PvE remains protected unless the relevant player/tribe is actively enlisted.' },
    components: [
      { type: 'button', customId: 'nexus_darkzone_enlist_solo', label: 'Enlist Solo', style: 'danger', disabled: ![DARK_ZONE_STATES.SAFE, DARK_ZONE_STATES.COOLDOWN].includes(state) },
      { type: 'button', customId: 'nexus_darkzone_enlist_tribe', label: 'Enlist Tribe', style: 'danger', disabled: ![DARK_ZONE_STATES.SAFE, DARK_ZONE_STATES.COOLDOWN].includes(state) },
      { type: 'button', customId: 'nexus_darkzone_withdraw', label: 'Withdraw', style: 'secondary', disabled: state !== DARK_ZONE_STATES.ENLISTED }
    ]
  };
}

module.exports = { formatState, formatDuration, protocolSummary, leaderboardView, participantProgressView, darkZoneView };
