'use strict';

const crypto = require('node:crypto');
const { appendDisclaimer, ensureClanMarker, panelFooter, upsertOwnedPanel, degradedEmbed } = require('../panels.cjs');
const { formatCt } = require('../bungie/time.cjs');

function shortHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function presentEmbed(panelId, embed, { degraded = false, asOf, lastGood = '' } = {}) {
  let title = embed?.title;
  let description = String(embed?.description || '');
  let fields = Array.isArray(embed?.fields) ? embed.fields.slice(0, 6) : [];
  if (degraded) {
    const collapsed = lastGood ? lastGood.split('\n').slice(0, 8).join('\n') : '';
    const body = degradedEmbed({
      title,
      asOf: formatCt(asOf || Date.now()),
      detail: collapsed
    });
    title = body.title;
    description = body.description;
    fields = [];
  }
  description = ensureClanMarker(panelId, description);
  return {
    title,
    description: appendDisclaimer(description).slice(0, 4000),
    fields,
    footer: { text: panelFooter(panelId) }
  };
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
