'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');
const { renderTemporal, discordTimestampPair } = require('./discord-time.cjs');
const { paragraphs, spacedItems, statRows } = require('./embed-layout.cjs');

function clean(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanBlock(value, max = 1000) {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.slice(0, max);
}

function humanize(value) {
  return clean(value, 80).replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function urlValue(value, key = '') {
  const text = clean(value, 1000);
  if (!/^https?:\/\/[^\s]+$/i.test(text)) return '';
  const label = /(?:source|official|news)/i.test(key) ? 'Official source' : 'Open link';
  return `[${label}](${text})`;
}

function scalar(value, key = '') {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const temporal = renderTemporal(value, key);
    return temporal !== String(value) ? temporal : Number.isFinite(value) ? String(value) : '';
  }
  if (typeof value === 'string') {
    const link = urlValue(value, key);
    if (link) return link;
    return clean(renderTemporal(value, key));
  }
  return '';
}

function itemTitle(item, index) {
  if (!item || typeof item !== 'object') return `Result ${index + 1}`;
  return clean(
    item.title || item.name || item.node || item.item || item.description || item.user || item.tier || `Result ${index + 1}`,
    240
  );
}

function objectLines(object, omitted = new Set()) {
  if (!object || typeof object !== 'object') return [];
  const rows = [];
  for (const [key, value] of Object.entries(object)) {
    if (omitted.has(key)) continue;
    const rendered = scalar(value, key);
    if (!rendered) continue;
    rows.push(`**${humanize(key)}**\n${rendered}`);
  }
  return rows;
}

function collectionFields(items, limit = 12) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item, index) => {
    if (!item || typeof item !== 'object') {
      return { name: `Result ${index + 1}`, value: clean(item) || '—', inline: false };
    }
    const title = itemTitle(item, index);
    const omitted = new Set(['title', 'name', 'node', 'item', 'description', 'user', 'tier']);
    const rows = objectLines(item, omitted);
    if (item.node && clean(item.node) !== title) rows.unshift(`**Node**\n${clean(item.node)}`);
    if (item.description && clean(item.description) !== title) rows.unshift(clean(item.description));
    if (item.reward) rows.push(`**Reward**\n${clean(item.reward)}`);
    return {
      name: title || `Result ${index + 1}`,
      value: cleanBlock(spacedItems(rows), 1024) || 'No additional details.',
      inline: false
    };
  });
}

function genericEmbed(moduleId, actionId, data) {
  const module = getModule(moduleId);
  const title = `${module?.name || humanize(moduleId)} • ${humanize(actionId)}`.slice(0, 256);
  if (data === null || data === undefined) return { title, description: 'Completed successfully.' };
  if (typeof data !== 'object') return { title, description: cleanBlock(data, 4000) || 'Completed successfully.' };
  if (data.usage) {
    const examples = Array.isArray(data.examples)
      ? spacedItems(data.examples.map((item) => `• ${clean(item)}`))
      : data.example ? `• ${clean(data.example)}` : '';
    return {
      title,
      description: cleanBlock(paragraphs(
        cleanBlock(data.usage, 3000),
        examples ? `**Examples**\n${examples}` : ''
      ), 4096)
    };
  }

  const fields = [];
  const descriptionRows = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (!value.length) continue;
      if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        const entries = value.map((item) => scalar(item, key)).filter(Boolean);
        fields.push({
          name: humanize(key),
          value: cleanBlock(spacedItems(entries), 1024) || '—',
          inline: false
        });
      } else {
        fields.push(...collectionFields(value, Math.max(1, 25 - fields.length)));
      }
      continue;
    }
    if (value && typeof value === 'object') {
      const rows = objectLines(value);
      if (rows.length) fields.push({ name: humanize(key), value: cleanBlock(spacedItems(rows), 1024), inline: false });
      continue;
    }
    const rendered = scalar(value, key);
    if (rendered) descriptionRows.push([humanize(key), rendered]);
  }
  return {
    title,
    description: descriptionRows.length ? cleanBlock(statRows(descriptionRows), 4096) : undefined,
    fields: fields.slice(0, 25)
  };
}

function warframeCollectionEmbed(actionId, data) {
  const keys = {
    news: 'news', events: 'events', alerts: 'alerts', fissures: 'fissures', invasions: 'invasions', kuva: 'kuva'
  };
  const key = keys[actionId];
  if (!key || !Array.isArray(data?.[key])) return null;
  const items = data[key];
  const title = `WARFRAME • ${humanize(actionId).toUpperCase()}`;
  if (!items.length) return { title, description: `No active ${humanize(actionId).toLowerCase()} were returned.` };
  return {
    title,
    description: data.platform
      ? paragraphs(`**Platform**\n${String(data.platform).toUpperCase()}`, `**Results**\n${items.length}`)
      : undefined,
    fields: collectionFields(items, 20)
  };
}

function warframeAlertEmbed(data) {
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  if (!alerts.length) return { title: 'WARFRAME • ALERTS', description: 'No active alerts.' };
  return {
    title: 'WARFRAME • ALERTS',
    description: paragraphs(
      `**Platform**\n${String(data.platform || 'pc').toUpperCase()}`,
      `**Active Alerts**\n${alerts.length}`
    ),
    fields: alerts.slice(0, 20).map((alert, index) => {
      const heading = [alert.type, alert.node].filter(Boolean).join(' • ') || `Alert ${index + 1}`;
      const rows = [];
      if (alert.faction) rows.push(`**Faction**\n${clean(alert.faction)}`);
      if (alert.reward) rows.push(`**Reward**\n${clean(alert.reward)}`);
      else rows.push('**Reward**\nNo item reward reported');
      if (alert.eta) rows.push(`**Time remaining**\n${clean(alert.eta)}`);
      const expires = discordTimestampPair(alert.expiry, 'expiry');
      if (expires) rows.push(`**Expires**\n${expires}`);
      return { name: clean(heading, 256), value: cleanBlock(spacedItems(rows), 1024), inline: false };
    })
  };
}

function warframeEmbed(actionId, data) {
  if (actionId === 'alerts') return warframeAlertEmbed(data);
  return warframeCollectionEmbed(actionId, data) || genericEmbed('warframe', actionId, data);
}

function formatActionResult(moduleId, actionId, result) {
  if (!result?.ok) return { content: `⚠️ ${result?.message || result?.code || 'Action failed.'}`, components: [], embeds: [] };
  const embed = moduleId === 'warframe' ? warframeEmbed(actionId, result.data) : genericEmbed(moduleId, actionId, result.data);
  return {
    content: `✅ **${getModule(moduleId)?.name || moduleId}** • ${humanize(actionId)}`,
    embeds: [{ ...embed, footer: { text: 'Nexus Sentinal • Backend-first game module' } }],
    components: [],
    allowed_mentions: { parse: [] }
  };
}

module.exports = {
  clean,
  cleanBlock,
  humanize,
  scalar,
  objectLines,
  collectionFields,
  genericEmbed,
  warframeEmbed,
  formatActionResult
};
