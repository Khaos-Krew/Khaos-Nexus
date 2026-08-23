'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');

function clean(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function humanize(value) {
  return clean(value, 80).replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function scalar(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return clean(value);
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
  const lines = [];
  for (const [key, value] of Object.entries(object)) {
    if (omitted.has(key)) continue;
    const rendered = scalar(value);
    if (!rendered) continue;
    lines.push(`**${humanize(key)}:** ${rendered}`);
  }
  return lines;
}

function collectionFields(items, limit = 12) {
  return (Array.isArray(items) ? items : []).slice(0, limit).map((item, index) => {
    if (!item || typeof item !== 'object') {
      return { name: `Result ${index + 1}`, value: clean(item) || '—', inline: false };
    }
    const title = itemTitle(item, index);
    const omitted = new Set(['title', 'name', 'node', 'item', 'description', 'user', 'tier']);
    const lines = objectLines(item, omitted);
    if (item.node && clean(item.node) !== title) lines.unshift(`**Node:** ${clean(item.node)}`);
    if (item.description && clean(item.description) !== title) lines.unshift(clean(item.description));
    if (item.reward) lines.push(`**Reward:** ${clean(item.reward)}`);
    return { name: title || `Result ${index + 1}`, value: clean(lines.join('\n'), 1024) || 'No additional details.', inline: false };
  });
}

function genericEmbed(moduleId, actionId, data) {
  const module = getModule(moduleId);
  const title = `${module?.name || humanize(moduleId)} • ${humanize(actionId)}`.slice(0, 256);
  if (data === null || data === undefined) return { title, description: 'Completed successfully.' };
  if (typeof data !== 'object') return { title, description: clean(data, 4000) || 'Completed successfully.' };
  if (data.usage) {
    const examples = Array.isArray(data.examples) ? data.examples.map((item) => `• ${clean(item)}`).join('\n') : data.example ? `• ${clean(data.example)}` : '';
    return { title, description: `${clean(data.usage, 3000)}${examples ? `\n\n**Examples**\n${examples}` : ''}`.slice(0, 4096) };
  }

  const fields = [];
  const description = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      if (!value.length) continue;
      if (value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        fields.push({ name: humanize(key), value: clean(value.map(scalar).filter(Boolean).join(', '), 1024) || '—', inline: false });
      } else {
        fields.push(...collectionFields(value, Math.max(1, 25 - fields.length)));
      }
      continue;
    }
    if (value && typeof value === 'object') {
      const lines = objectLines(value);
      if (lines.length) fields.push({ name: humanize(key), value: clean(lines.join('\n'), 1024), inline: false });
      continue;
    }
    const rendered = scalar(value);
    if (rendered) description.push(`**${humanize(key)}:** ${rendered}`);
  }
  return {
    title,
    description: clean(description.join('\n'), 4096) || undefined,
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
    description: data.platform ? `Platform: **${String(data.platform).toUpperCase()}** • ${items.length} result${items.length === 1 ? '' : 's'}` : undefined,
    fields: collectionFields(items, 20)
  };
}

function warframeAlertEmbed(data) {
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  if (!alerts.length) return { title: 'WARFRAME • ALERTS', description: 'No active alerts.' };
  return {
    title: 'WARFRAME • ALERTS',
    description: `Platform: **${String(data.platform || 'pc').toUpperCase()}** • ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}`,
    fields: alerts.slice(0, 20).map((alert, index) => {
      const heading = [alert.type, alert.node].filter(Boolean).join(' • ') || `Alert ${index + 1}`;
      const lines = [];
      if (alert.faction) lines.push(`**Faction:** ${clean(alert.faction)}`);
      if (alert.reward) lines.push(`**Reward:** ${clean(alert.reward)}`);
      else lines.push('**Reward:** No item reward reported');
      if (alert.eta) lines.push(`**Time remaining:** ${clean(alert.eta)}`);
      if (alert.expiry) {
        const unix = Math.floor(new Date(alert.expiry).getTime() / 1000);
        if (Number.isFinite(unix)) lines.push(`**Expires:** <t:${unix}:R>`);
      }
      return { name: clean(heading, 256), value: clean(lines.join('\n'), 1024), inline: false };
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
  humanize,
  scalar,
  objectLines,
  collectionFields,
  genericEmbed,
  warframeEmbed,
  formatActionResult
};