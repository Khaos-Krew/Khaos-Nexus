'use strict';

const { appendDisclaimer, clanJoinLine } = require('../panels.cjs');
const { formatCt } = require('../bungie/time.cjs');

function onlineText(online) {
  if (online == null || typeof online.count !== 'number') return '';
  return online.complete === false ? `${online.count}+` : String(online.count);
}

function renderClanSummary({ summary, online = null } = {}) {
  const name = summary?.name || 'KHAOS NEXUS';
  const callsign = summary?.callsign ? ` [${summary.callsign}]` : '';
  const members = Number(summary?.memberCount) || 0;
  const groupId = String(summary?.groupId || '').trim();
  const onlineLabel = onlineText(online);
  const lines = [
    `**${name}**${callsign}`,
    onlineLabel ? `Members: ${members} • Online: ${onlineLabel}` : `Members: ${members}`,
    groupId ? clanJoinLine(groupId) : 'Join:'
  ];
  return {
    title: `👥 ${name}`.slice(0, 250),
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 })
  };
}

function renderRoster({ summary, roster, page } = {}) {
  const name = summary?.name || 'KHAOS NEXUS';
  const members = roster?.members || [];
  const lines = [`**${name}** roster, page ${page}`, `Members: ${roster?.total || members.length}`];
  if (!members.length) lines.push('No members on this page.');
  for (const member of members) {
    const when = member.joinDate ? formatCt(member.joinDate) : '';
    const online = member.online === true ? 'online' : member.online === false ? 'offline' : '';
    const extra = [when, online].filter(Boolean).join(' • ');
    lines.push(extra ? `• ${member.name} • ${extra}` : `• ${member.name}`);
  }
  if (roster?.hasMore) lines.push('Another page is available.');
  return {
    title: `👥 ${name} roster`.slice(0, 250),
    description: appendDisclaimer(lines.join('\n'))
  };
}

module.exports = { renderClanSummary, renderRoster };
