'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RULES_PATH = path.join(__dirname, '..', 'config', 'ark-rules.json');

function cleanText(value, max = 1024) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function loadArkRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  const config = JSON.parse(raw);
  const rules = (Array.isArray(config.rules) ? config.rules : [])
    .filter((rule) => rule && rule.enabled !== false)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

  return {
    schemaVersion: Number(config.schemaVersion || 1),
    title: cleanText(config.title, 256) || 'Khaos Nexus — ARK Cluster Rules',
    updatedAt: cleanText(config.updatedAt, 40),
    intro: cleanText(config.intro, 1000),
    rules
  };
}

function buildArkRulesReply() {
  const config = loadArkRules();
  const fields = config.rules.slice(0, 25).map((rule) => ({
    name: cleanText(rule.title, 256) || 'Rule',
    value: cleanText(rule.body, 1024) || 'See staff for clarification.',
    inline: false
  }));

  return {
    embeds: [{
      title: `📜 ${config.title}`.slice(0, 256),
      description: config.intro || 'Current Khaos Nexus ARK cluster rules.',
      color: 0xe3264f,
      fields,
      footer: { text: config.updatedAt ? `Khaos Nexus • Rules updated ${config.updatedAt}` : 'Khaos Nexus • ARK Cluster Rules' }
    }],
    allowed_mentions: { parse: [] },
    ephemeral: true
  };
}

module.exports = { RULES_PATH, loadArkRules, buildArkRulesReply };
