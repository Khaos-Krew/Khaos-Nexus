'use strict';

const crypto = require('node:crypto');
const maps = require('./dnd-ai-maps.cjs');

const MAX_SVG_BYTES = maps.MAX_SVG_BYTES;
const STANDARD_SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const DANGEROUS_SVG_PATTERN = /<!doctype|<!entity|<\?xml|<\s*(?:script|foreignobject|image|use|a|iframe|object|embed|canvas|video|audio|animate|set|mpath|filter)\b|\bon[a-z]+\s*=|\b(?:href|xlink:href|src)\s*=|javascript\s*:|data\s*:|file\s*:|@import|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding/i;
const ALLOWED_SVG_ELEMENTS = new Set(['svg', 'g', 'rect', 'line', 'polygon', 'polyline', 'path', 'circle', 'ellipse', 'text', 'tspan', 'style', 'title', 'desc']);
const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns', 'width', 'height', 'viewbox', 'class', 'id', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points', 'transform', 'fill', 'stroke',
  'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-opacity',
  'opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline',
  'vector-effect', 'role', 'aria-label', 'aria-labelledby', 'data-seed', 'data-map-type'
]);

function cleanLine(value, maximum = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().replace(/\s+/g, ' ').slice(0, maximum);
}

function validationError(message, field, code = 'DND_AI_MAP_INVALID') {
  return Object.assign(new Error(message), { code, field });
}

function validateServiceSvg(svg) {
  const source = String(svg || '').trim();
  const bytes = Buffer.byteLength(source, 'utf8');
  if (!source || bytes > MAX_SVG_BYTES || !/^<svg\b/i.test(source) || !/<\/svg>$/i.test(source)) {
    throw validationError('Khaos Nexus AI returned an invalid or oversized SVG preview.', 'svg', 'DND_AI_MAP_SVG_INVALID');
  }

  const openingTag = source.match(/^<svg\b[^>]*>/i)?.[0] || '';
  const namespaceMatches = [...openingTag.matchAll(/\sxmlns\s*=\s*(["'])(.*?)\1/gi)];
  if (namespaceMatches.length !== 1 || namespaceMatches[0][2] !== STANDARD_SVG_NAMESPACE) {
    throw validationError('Khaos Nexus AI returned an SVG with an unsupported namespace.', 'svg.xmlns', 'DND_AI_MAP_SVG_UNSAFE');
  }
  if (DANGEROUS_SVG_PATTERN.test(source)) {
    throw validationError('Khaos Nexus AI returned unsafe SVG content.', 'svg', 'DND_AI_MAP_SVG_UNSAFE');
  }

  const tagPattern = /<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_SVG_ELEMENTS.has(name)) {
      throw validationError(`SVG element ${name} is not permitted.`, 'svg', 'DND_AI_MAP_SVG_UNSAFE');
    }
    if (match[0].startsWith('</') || name === 'style') continue;
    const attributePattern = /\s([a-zA-Z_:][\w:.-]*)\s*=/g;
    let attribute;
    while ((attribute = attributePattern.exec(match[0]))) {
      const attributeName = attribute[1].toLowerCase();
      if (!ALLOWED_SVG_ATTRIBUTES.has(attributeName)) {
        throw validationError(`SVG attribute ${attributeName} is not permitted.`, 'svg', 'DND_AI_MAP_SVG_UNSAFE');
      }
      if (attributeName === 'xmlns') {
        const namespaceValue = match[0].match(/\sxmlns\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
        if (namespaceValue !== STANDARD_SVG_NAMESPACE) {
          throw validationError('SVG namespace is not permitted.', 'svg.xmlns', 'DND_AI_MAP_SVG_UNSAFE');
        }
      }
    }
  }

  return {
    bytes,
    sha256: crypto.createHash('sha256').update(source).digest('hex')
  };
}

function parseMapResponse(payload = {}, request = null) {
  const result = maps.normalizeMapResult(payload.result || payload.map || payload);
  if (request) {
    for (const [field, actual, expected] of [
      ['mapType', result.mapType, request.mapType],
      ['seed', result.seed, request.seed],
      ['grid.width', result.grid.width, request.width],
      ['grid.height', result.grid.height, request.height],
      ['grid.type', result.grid.type, request.gridType],
      ['grid.scale', result.grid.scale, request.scale]
    ]) {
      if (actual !== expected) {
        throw validationError(`Khaos Nexus AI returned ${field} that does not match the approved request.`, `result.${field}`, 'DND_AI_MAP_RESULT_MISMATCH');
      }
    }
  }
  const serviceSvg = validateServiceSvg(payload.svg);
  return {
    result,
    playerSvg: maps.renderStructuredMapSvg(result, { includeSecrets: false }),
    gmSvg: maps.renderStructuredMapSvg(result, { includeSecrets: true }),
    serviceSvg,
    provider: cleanLine(payload.meta?.provider || payload.provider, 80),
    model: cleanLine(payload.meta?.model || payload.model, 120),
    generatedAt: payload.meta?.generatedAt || new Date().toISOString(),
    reproducible: payload.meta?.reproducible !== false
  };
}

module.exports = {
  ...maps,
  STANDARD_SVG_NAMESPACE,
  validateServiceSvg,
  parseMapResponse
};
