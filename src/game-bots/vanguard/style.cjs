'use strict';

const path = require('node:path');

// Shaped so a later shared brandEmbed('vanguard', ...) can replace this module.
const VANGUARD_STYLE = Object.freeze({
  name: 'Nexus Vanguard',
  color: 0xAEB4BD,
  bannerFile: 'vanguard-panel-banner.png',
  iconFile: 'icon-vanguard.png'
});

const ASSET_DIR = path.join(__dirname, '../../shared/brand-assets');

function assetPath(file) {
  return path.join(ASSET_DIR, file);
}

function clipLine(value, max = 60) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function boundedLines(items, { maxLines = 5, maxChars = 60 } = {}) {
  const clean = (Array.isArray(items) ? items : []).map((item) => clipLine(item, maxChars)).filter(Boolean);
  if (clean.length <= maxLines) return clean;
  const shown = clean.slice(0, maxLines - 1);
  shown.push(`+${clean.length - shown.length} more`);
  return shown;
}

module.exports = {
  VANGUARD_STYLE,
  ASSET_DIR,
  assetPath,
  clipLine,
  boundedLines
};
