'use strict';

function memberName(member) {
  const destiny = member?.destinyUserInfo || {};
  const bungie = member?.bungieNetUserInfo || {};
  const name = destiny.bungieGlobalDisplayName || destiny.displayName || bungie.bungieGlobalDisplayName || bungie.displayName || 'Unknown';
  const code = destiny.bungieGlobalDisplayNameCode ?? bungie.bungieGlobalDisplayNameCode;
  if (code === undefined || code === null || code === '') return String(name);
  return `${name}#${String(code).padStart(4, '0')}`;
}

function memberRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

function normalizeSummary(json) {
  const detail = json?.Response?.detail || {};
  const founder = json?.Response?.founder || {};
  return {
    groupId: String(detail.groupId || ''),
    name: String(detail.name || '').trim() || 'Clan',
    callsign: String(detail.clanInfo?.clanCallsign || '').trim(),
    memberCount: Number(detail.memberCount) || 0,
    motto: String(detail.motto || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    founder: memberName(founder)
  };
}

function normalizeAdmins(json) {
  return memberRows(json?.Response).map((member) => ({
    name: memberName(member),
    memberType: Number(member?.memberType) || 0,
    founder: Number(member?.memberType) === 5
  }));
}

function normalizeRoster(json, page) {
  const response = json?.Response || {};
  const results = memberRows(response);
  return {
    total: Number(response.totalResults) || results.length,
    hasMore: Boolean(response.hasMore),
    page: Number(response.query?.currentPage) || page,
    members: results.map((member) => ({
      name: memberName(member),
      joinDate: String(member?.joinDate || ''),
      online: typeof member?.isOnline === 'boolean' ? member.isOnline : null
    }))
  };
}

async function fetchClanSummary(client, groupId) {
  const [summary, admins] = await Promise.all([
    client.get(`/GroupV2/${groupId}/`),
    client.get(`/GroupV2/${groupId}/AdminsAndFounder/`)
  ]);
  return { summary, admins };
}

async function fetchClanRoster(client, groupId, page) {
  const current = Math.max(1, Number(page) || 1);
  const result = await client.get(`/GroupV2/${groupId}/Members/`, { currentpage: current });
  return { result, page: current };
}

async function countOnlineMembers(client, groupId, { maxPages = 4 } = {}) {
  let online = 0;
  let complete = false;
  const cap = Math.max(1, Math.min(8, Number(maxPages) || 4));
  for (let page = 1; page <= cap; page += 1) {
    const fetched = await fetchClanRoster(client, groupId, page);
    if (!fetched.result?.ok) return null;
    const roster = normalizeRoster(fetched.result.json, page);
    online += roster.members.filter((member) => member.online === true).length;
    if (!roster.hasMore) {
      complete = true;
      break;
    }
  }
  return { count: online, complete };
}

module.exports = {
  memberName,
  normalizeSummary,
  normalizeAdmins,
  normalizeRoster,
  fetchClanSummary,
  fetchClanRoster,
  countOnlineMembers
};
