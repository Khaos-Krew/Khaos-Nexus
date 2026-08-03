'use strict';

let installed = false;

function clean(value, maximum = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maximum);
}

function cleanArray(value, maximumItems = 100, maximumLength = 1000) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maximumItems)
    .map((item) => clean(item, maximumLength))
    .filter(Boolean);
}

function boundedSafetyRecord(input = {}) {
  const pauseWords = cleanArray(input.pauseWords);
  return {
    contentRating: ['family', 'teen', 'mature'].includes(input.contentRating) ? input.contentRating : 'teen',
    lines: cleanArray(input.lines),
    veils: cleanArray(input.veils),
    pauseWords: pauseWords.length ? pauseWords : ['pause', 'red card']
  };
}

function safetyRecord(state = {}, campaignId = '') {
  const campaign = (state.campaigns || []).find((item) => item.id === campaignId && item.active !== false) || {};
  return boundedSafetyRecord({
    contentRating: campaign.contentRating,
    lines: campaign.safety?.lines,
    veils: campaign.safety?.veils,
    pauseWords: campaign.safety?.pauseWords
  });
}

function safetyText(state, campaignId) {
  return `Safety settings:\n${JSON.stringify(safetyRecord(state, campaignId), null, 2)}`;
}

function appendSafetyContext(context, state, campaignId, targetLimit) {
  const addition = safetyText(state, campaignId);
  const limit = Math.max(8000, Math.min(100000, Number(targetLimit || context.characterLimit || 48000)));
  const separator = '\n\n';
  const maximumBase = Math.max(0, limit - addition.length - separator.length);
  const base = String(context.text || '').slice(0, maximumBase);
  const text = `${base}${base ? separator : ''}${addition}`.slice(0, limit);
  const safetyCharacters = Math.max(0, text.length - base.length - (base ? separator.length : 0));
  const sections = (context.sections || []).filter((item) => item.id !== 'safety');
  sections.push({
    id: 'safety',
    label: 'Safety settings',
    reason: safetyCharacters < addition.length ? 'truncated by context character limit' : 'included',
    count: 1,
    characters: addition.length,
    includedCharacters: safetyCharacters
  });
  return {
    ...context,
    characterLimit: limit,
    characters: text.length,
    sections,
    text,
    preview: text.slice(0, 8000)
  };
}

function sanitizeLegacyCampaignRequest(request = {}) {
  return {
    ...request,
    playerCharacters: (request.playerCharacters || []).map((item) => ({
      name: clean(item.name, 100),
      summary: clean(item.summary, 4000)
    })),
    safety: boundedSafetyRecord({
      contentRating: request.contentRating,
      lines: request.safety?.lines,
      veils: request.safety?.veils,
      pauseWords: request.safety?.pauseWords
    })
  };
}

function install() {
  if (installed) return;
  installed = true;

  const coDm = require('./dnd-co-dm.cjs');
  if (!coDm.__khaosAiSafetyPreviewPatched) {
    const originalContext = coDm.buildCampaignContext;
    coDm.buildCampaignContext = function buildPreviewedCampaignContext(state, campaignId, options, settings = {}) {
      const desiredLimit = Number(settings.contextCharacterLimit || state?.coDmSettings?.contextCharacterLimit || 48000);
      const reserve = safetyText(state, campaignId).length + 2;
      const context = originalContext(state, campaignId, options, {
        ...settings,
        contextCharacterLimit: Math.max(8000, desiredLimit - reserve)
      });
      return appendSafetyContext(context, state, campaignId, desiredLimit);
    };
    Object.defineProperty(coDm, '__khaosAiSafetyPreviewPatched', { value: true });
  }

  const service = require('./dnd-ai-service.cjs');
  if (!service.__khaosAiCharacterPrivacyPatched) {
    const originalLegacyRequest = service.buildLegacyCampaignRequest;
    service.buildLegacyCampaignRequest = function buildPrivateLegacyCampaignRequest(...args) {
      return sanitizeLegacyCampaignRequest(originalLegacyRequest(...args));
    };
    Object.defineProperty(service, '__khaosAiCharacterPrivacyPatched', { value: true });
  }
}

module.exports = {
  install,
  boundedSafetyRecord,
  safetyRecord,
  safetyText,
  appendSafetyContext,
  sanitizeLegacyCampaignRequest
};
