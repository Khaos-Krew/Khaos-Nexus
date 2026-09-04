'use strict';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clean(value, max = 200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function enabledSourceIds(state, campaignId) {
  const rows = (state.campaignSources || []).filter((item) => item.campaignId === campaignId && clean(item.sourceId, 100));
  const bySource = new Map();
  for (const row of rows) {
    const sourceId = clean(row.sourceId, 100);
    if (!bySource.has(sourceId)) bySource.set(sourceId, []);
    bySource.get(sourceId).push(row);
  }
  const enabled = new Set();
  for (const [sourceId, selections] of bySource) {
    if (selections.length && selections.every((item) => item.enabled === true)) enabled.add(sourceId);
  }
  return enabled;
}

function sourceIsCampaignEligible(source) {
  if (!source || source.active === false) return false;
  if (source.metadata?.kind === 'homebrew_source' && source.metadata?.visibility !== 'campaign') return false;
  return true;
}

function sourceContext(source) {
  return {
    id: source.id,
    name: clean(source.name, 160),
    ruleset: clean(source.ruleset, 80),
    sourceVersion: clean(source.sourceVersion, 80),
    licenseType: clean(source.licenseType, 80),
    attributionText: clean(source.attributionText, 1000),
    contentOrigin: clean(source.metadata?.contentOrigin || source.metadata?.kind || '', 80)
  };
}

function contentEntryContext(entry, source) {
  return {
    id: entry.id,
    sourceId: entry.sourceId,
    contentType: clean(entry.contentType, 80),
    name: clean(entry.name, 180),
    summary: clean(entry.summary, 8000),
    fullText: source.isFullTextAllowed === true ? String(entry.fullText || '').slice(0, 50000) : '',
    contentOrigin: clean(entry.contentOrigin, 80),
    externalReferenceUrl: clean(entry.externalReferenceUrl, 800)
  };
}

function homebrewContext(record) {
  return {
    id: record.id,
    entryId: clean(record.entryId, 100),
    contentType: clean(record.contentType, 80),
    name: clean(record.name, 180),
    body: clone(record.body || {}),
    revision: Number(record.revision || 1),
    approvedAt: String(record.approvedAt || '')
  };
}

function campaignContentContext(state, campaignIdInput) {
  const campaignId = clean(campaignIdInput, 100);
  if (!campaignId) return { sources: [], entries: [], homebrew: [] };

  const enabled = enabledSourceIds(state, campaignId);
  const sources = (state.sources || []).filter((source) => enabled.has(source.id) && sourceIsCampaignEligible(source));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const entries = (state.contentEntries || []).filter((entry) => {
    if (entry.active === false || !sourceById.has(entry.sourceId)) return false;
    return !entry.campaignId || entry.campaignId === campaignId;
  });
  const homebrew = (state.homebrew || []).filter((record) => record.campaignId === campaignId && record.status === 'approved');

  return {
    sources: sources.map(sourceContext),
    entries: entries.map((entry) => contentEntryContext(entry, sourceById.get(entry.sourceId))),
    homebrew: homebrew.map(homebrewContext)
  };
}

module.exports = {
  campaignContentContext,
  enabledSourceIds,
  sourceIsCampaignEligible
};
