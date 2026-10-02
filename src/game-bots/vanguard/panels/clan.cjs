'use strict';

const { formatCt } = require('../bungie/time.cjs');

function adminLabel(member) {
  if (member.founder || member.memberType === 5) return 'Founder';
  if (member.memberType === 3) return 'Admin';
  return 'Admin';
}

function renderClanSummary({ summary, admins = [] } = {}) {
  const name = summary?.name || 'Clan';
  const callsign = summary?.callsign ? ` [${summary.callsign}]` : '';
  const lines = [
    `**${name}**${callsign}`,
    `Members: ${Number(summary?.memberCount) || 0}`,
    `Founder: ${summary?.founder || 'Unknown'}`
  ];
  if (summary?.motto) lines.push(summary.motto);
  const staff = admins.filter((member) => member.memberType === 3 || member.memberType === 5 || member.founder);
  if (staff.length) {
    lines.push('Admins:');
    for (const member of staff.slice(0, 15)) lines.push(`• ${adminLabel(member)} — ${member.name}`);
  }
  return {
    title: `Vanguard • Clan ${name}`.slice(0, 250),
    description: lines.join('\n').slice(0, 4000)
  };
}

function renderRoster({ summary, roster, page } = {}) {
  const name = summary?.name || 'Clan';
  const members = roster?.members || [];
  const lines = [`**${name}** roster, page ${page}`, `Members: ${roster?.total || members.length}`];
  if (!members.length) lines.push('No members on this page.');
  for (const member of members) {
    const when = member.joinDate ? formatCt(member.joinDate) : '';
    const online = member.online === true ? 'online' : member.online === false ? 'offline' : '';
    const extra = [when, online].filter(Boolean).join(' · ');
    lines.push(extra ? `• ${member.name} — ${extra}` : `• ${member.name}`);
  }
  if (roster?.hasMore) lines.push('Another page is available.');
  return {
    title: `Vanguard • Clan ${name}`.slice(0, 250),
    description: lines.join('\n').slice(0, 4000)
  };
}

module.exports = { renderClanSummary, renderRoster };
