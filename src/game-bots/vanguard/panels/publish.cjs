'use strict';

const crypto = require('node:crypto');
const { appendDisclaimer, ensureClanMarker, panelFooter, upsertOwnedPanel, degradedEmbed } = require('../panels.cjs');
const { formatCt } = require('../bungie/time.cjs');

function shortHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function sourcePages(embed) {
  if (Array.isArray(embed?.embeds) && embed.embeds.length) return embed.embeds;
  return [embed || {}];
}

function presentEmbed(panelId, embed, { degraded = false, asOf, lastGood = '' } = {}) {
  if (degraded) {
    const collapsed = lastGood ? lastGood.split('\n').slice(0, 8).join('\n') : '';
    const body = degradedEmbed({
      title: embed?.title,
      asOf: formatCt(asOf || Date.now()),
      detail: collapsed
    });
    const page = {
      title: body.title,
      description: appendDisclaimer(ensureClanMarker(panelId, body.description)).slice(0, 4000),
      fields: []
    };
    return { ...page, embeds: [page], footer: { text: panelFooter(panelId) } };
  }
  const pages = sourcePages(embed).slice(0, 10).map((page) => ({
    title: page?.title,
    description: appendDisclaimer(ensureClanMarker(panelId, page?.description)).slice(0, 4000),
    fields: Array.isArray(page?.fields) ? page.fields.filter((field) => field && field.value).slice(0, 25) : []
  }));
  const first = pages[0] || {
    title: embed?.title,
    description: appendDisclaimer(ensureClanMarker(panelId, '')).slice(0, 4000),
    fields: []
  };
  return { ...first, embeds: pages.length ? pages : [first], footer: { text: panelFooter(panelId) } };
}

async function publishPanel(ctx, { guildId, panelId, channelId, embed, degraded = false, asOf, force = false } = {}) {
  const guild = String(guildId || '');
  if (!guild || !channelId) return { refreshed: false, reason: 'unset' };
  const saved = ctx.panelStore.read()?.[guild]?.[panelId] || {};
  const body = presentEmbed(panelId, embed, { degraded, asOf, lastGood: saved.lastGood || '' });
  const hash = shortHash(body);
  if (!force && !degraded && saved.lastHash === hash && saved.messageId && saved.channelId === channelId) {
    return { refreshed: false, reason: 'unchanged', messageId: saved.messageId };
  }
  const result = await upsertOwnedPanel(ctx.client, {
    channelId,
    messageId: saved.channelId === channelId ? saved.messageId : '',
    panelId,
    embeds: body.embeds,
    embed: { title: body.title, description: body.description, fields: body.fields },
    botId: ctx.client?.user?.id
  });
  if (!result?.messageId) return { refreshed: false, reason: result?.reason || 'missing' };
  await ctx.panelStore.update((state) => {
    state[guild] ||= {};
    state[guild][panelId] = {
      channelId,
      messageId: result.messageId,
      lastHash: hash,
      updatedAt: new Date().toISOString(),
      lastGood: degraded ? (saved.lastGood || '') : String(embed.description || '').slice(0, 1500)
    };
    return state;
  });
  return { refreshed: true, messageId: result.messageId, created: Boolean(result.created) };
}

module.exports = { shortHash, presentEmbed, publishPanel };
