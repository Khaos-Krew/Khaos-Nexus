'use strict';

const zlib = require('node:zlib');
const { normalizeCharacterImport, sha256 } = require('./dnd-content-catalog.cjs');

const CHARACTER_PDF_MAX_BYTES = 16 * 1024 * 1024;
const MAX_PDF_OBJECTS = 25000;
const MAX_PDF_FIELDS = 2000;
const MAX_OBJECT_STREAM_BYTES = 16 * 1024 * 1024;

function fail(message, code = 'DND_CHARACTER_PDF_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function decodePdfName(value) {
  return String(value || '').replace(/#([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodePdfHex(value) {
  const cleaned = String(value || '').replace(/\s+/g, '');
  if (!cleaned) return '';
  const even = cleaned.length % 2 ? `${cleaned}0` : cleaned;
  const bytes = Buffer.from(even, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let output = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    return output;
  }
  return bytes.toString('utf8').replace(/\u0000/g, '').trim();
}

function readLiteralString(source, start) {
  let output = '';
  let depth = 1;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      const next = source[++index];
      if (next === undefined) break;
      const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
      if (Object.prototype.hasOwnProperty.call(escapes, next)) { output += escapes[next]; continue; }
      if (/[0-7]/.test(next)) {
        let octal = next;
        for (let count = 0; count < 2 && /[0-7]/.test(source[index + 1] || ''); count += 1) octal += source[++index];
        output += String.fromCharCode(Number.parseInt(octal, 8));
        continue;
      }
      if (next === '\r' && source[index + 1] === '\n') index += 1;
      if (next === '\r' || next === '\n') continue;
      output += next;
      continue;
    }
    if (character === '(') { depth += 1; output += character; continue; }
    if (character === ')') {
      depth -= 1;
      if (!depth) return { value: output, end: index + 1 };
      output += character;
      continue;
    }
    output += character;
  }
  return { value: output, end: source.length };
}

function readPdfToken(source, key) {
  const expression = new RegExp(`${key.replace('/', '\\/')}(?=[\\s(<\\[/])`, 'g');
  const match = expression.exec(source);
  if (!match) return undefined;
  let index = match.index + key.length;
  while (/\s/.test(source[index] || '')) index += 1;
  if (source[index] === '(') return readLiteralString(source, index).value.replace(/\u0000/g, '').trim();
  if (source[index] === '<' && source[index + 1] !== '<') {
    const end = source.indexOf('>', index + 1);
    if (end < 0) return undefined;
    return decodePdfHex(source.slice(index + 1, end));
  }
  if (source[index] === '/') {
    const end = source.slice(index + 1).search(/[\s<>\[\](){}\/]/);
    return decodePdfName(source.slice(index + 1, end < 0 ? source.length : index + 1 + end));
  }
  const end = source.slice(index).search(/[\s<>\[\](){}\/]/);
  return source.slice(index, end < 0 ? source.length : index + end).trim();
}

function extractObjectBodies(buffer) {
  const source = buffer.toString('latin1');
  const objects = [];
  const expression = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  let match;
  while ((match = expression.exec(source)) && objects.length < MAX_PDF_OBJECTS) {
    objects.push({ id: Number(match[1]), body: match[3] });
  }
  if (objects.length >= MAX_PDF_OBJECTS) throw fail('PDF contains too many objects.', 'DND_CHARACTER_PDF_COMPLEX');

  const embedded = [];
  for (const object of objects) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.body) || !/\/FlateDecode\b/.test(object.body)) continue;
    const count = Number(/\/N\s+(\d+)/.exec(object.body)?.[1] || 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.body)?.[1] || 0);
    if (!(count > 0 && count <= MAX_PDF_OBJECTS && first > 0)) continue;
    const streamMarker = /stream\r?\n/.exec(object.body);
    const endStream = object.body.lastIndexOf('endstream');
    if (!streamMarker || endStream <= streamMarker.index) continue;
    const start = streamMarker.index + streamMarker[0].length;
    const compressed = Buffer.from(object.body.slice(start, endStream).replace(/\r?\n$/, ''), 'latin1');
    let inflated;
    try { inflated = zlib.inflateSync(compressed, { maxOutputLength: MAX_OBJECT_STREAM_BYTES }); }
    catch { continue; }
    const decoded = inflated.toString('latin1');
    if (first >= decoded.length) continue;
    const header = decoded.slice(0, first).trim().split(/\s+/).map(Number);
    for (let index = 0; index < count; index += 1) {
      const id = header[index * 2];
      const offset = header[index * 2 + 1];
      const nextOffset = index + 1 < count ? header[(index + 1) * 2 + 1] : decoded.length - first;
      if (!Number.isFinite(id) || !Number.isFinite(offset) || offset < 0 || nextOffset < offset) continue;
      embedded.push({ id, body: decoded.slice(first + offset, first + nextOffset) });
      if (objects.length + embedded.length >= MAX_PDF_OBJECTS) throw fail('PDF contains too many objects.', 'DND_CHARACTER_PDF_COMPLEX');
    }
  }
  return objects.concat(embedded);
}

function extractPdfFormFields(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw fail('Character PDF signature is invalid.', 'DND_CHARACTER_PDF_SIGNATURE');
  const fields = [];
  for (const object of extractObjectBodies(buffer)) {
    const name = readPdfToken(object.body, '/T');
    if (!name) continue;
    const fieldType = readPdfToken(object.body, '/FT') || '';
    let value = readPdfToken(object.body, '/V');
    if (value === undefined && fieldType === 'Btn') value = readPdfToken(object.body, '/AS');
    if (value === undefined) value = '';
    fields.push({ name: String(name).trim().slice(0, 240), type: String(fieldType).slice(0, 40), value: typeof value === 'string' ? value.slice(0, 12000) : value });
    if (fields.length > MAX_PDF_FIELDS) throw fail('Character PDF contains too many form fields.', 'DND_CHARACTER_PDF_COMPLEX');
  }
  return fields;
}

function fieldIndex(fields) {
  const exact = new Map();
  for (const field of fields) {
    const key = normalizeFieldName(field.name);
    if (!key) continue;
    const existing = exact.get(key);
    if (!existing || (String(existing.value || '').trim() === '' && String(field.value || '').trim() !== '')) exact.set(key, field);
  }
  return exact;
}

function pickField(index, aliases) {
  for (const alias of aliases) {
    const key = normalizeFieldName(alias);
    const exact = index.get(key);
    if (exact && String(exact.value ?? '').trim() !== '') return exact.value;
  }
  for (const alias of aliases) {
    const key = normalizeFieldName(alias);
    if (key.length < 3) continue;
    for (const [name, field] of index.entries()) {
      if ((name.startsWith(key) || key.startsWith(name)) && String(field.value ?? '').trim() !== '') return field.value;
    }
  }
  return undefined;
}

function numberValue(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const match = String(value).replace(/,/g, '').match(/[+-]?\d+/);
  return match ? Number(match[0]) : null;
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return Boolean(normalized && !['off', 'false', 'no', '0', 'none'].includes(normalized));
}

function classAndLevel(index) {
  const explicitClass = pickField(index, ['ClassName', 'Class']);
  const explicitLevel = numberValue(pickField(index, ['CharacterLevel', 'Level']));
  const combined = String(pickField(index, ['ClassLevel', 'ClassAndLevel', 'Class Level']) || '').trim();
  const className = String(explicitClass || combined.replace(/\b(?:[1-9]|1\d|20)\b/g, '').replace(/\s*[/,;|]\s*/g, ' / ').replace(/\s{2,}/g, ' ').replace(/^\s*\/|\/\s*$/g, '').trim()).slice(0, 120);
  let level = explicitLevel;
  if (level === null && combined) {
    const levels = [...combined.matchAll(/\b([1-9]|1\d|20)\b/g)].map((match) => Number(match[1]));
    const total = levels.reduce((sum, item) => sum + item, 0);
    if (total > 0 && total <= 30) level = total;
  }
  return { className, level: level === null ? 1 : level };
}

function abilityValue(index, longName, shortName) {
  const score = numberValue(pickField(index, [longName, `${longName}Score`, shortName, `${shortName}Score`]));
  if (score !== null && score >= 1 && score <= 30) return { score };
  const modifier = numberValue(pickField(index, [`${longName}Modifier`, `${longName}Mod`, `${shortName}Mod`, `${shortName}Modifier`]));
  return modifier === null ? undefined : { modifier };
}

function mapPdfFieldsToCharacter(fields) {
  const index = fieldIndex(fields);
  const name = String(pickField(index, ['CharacterName', 'Character Name', 'Name']) || '').trim();
  if (!name) throw fail('No character name was found in the PDF form fields. Use D&D Beyond Export PDF rather than Print to PDF.', 'DND_CHARACTER_PDF_NAME_REQUIRED');
  const classLevel = classAndLevel(index);
  const maximumHp = numberValue(pickField(index, ['HPMax', 'MaxHP', 'MaximumHP', 'HitPointMaximum', 'HitPointsMax']));
  const currentHp = numberValue(pickField(index, ['HPCurrent', 'CurrentHP', 'CurrentHitPoints', 'HitPointsCurrent', 'HitPoints']));
  const maxHp = maximumHp === null ? (currentHp === null ? 0 : currentHp) : maximumHp;
  const hp = currentHp === null ? maxHp : currentHp;
  const armorClass = numberValue(pickField(index, ['AC', 'ArmorClass', 'Armor Class']));
  const initiativeModifier = numberValue(pickField(index, ['Initiative', 'InitiativeModifier', 'Init']));
  const abilities = {};
  for (const [longName, shortName] of [['strength', 'str'], ['dexterity', 'dex'], ['constitution', 'con'], ['intelligence', 'int'], ['wisdom', 'wis'], ['charisma', 'cha']]) {
    const value = abilityValue(index, longName, shortName);
    if (value) abilities[longName] = value;
  }
  return {
    name: name.slice(0, 120),
    className: classLevel.className,
    level: classLevel.level,
    hp,
    maxHp,
    armorClass: armorClass === null ? 10 : armorClass,
    initiativeModifier: initiativeModifier === null ? 0 : initiativeModifier,
    inspiration: booleanValue(pickField(index, ['Inspiration', 'HeroicInspiration'])),
    abilities,
    metadata: {
      pdfImport: {
        fieldCount: fields.length,
        sourceKind: 'fillable-character-pdf',
        ancestry: String(pickField(index, ['Race', 'Species', 'Ancestry']) || '').trim().slice(0, 120),
        background: String(pickField(index, ['Background']) || '').trim().slice(0, 160),
        playerName: String(pickField(index, ['PlayerName', 'Player Name']) || '').trim().slice(0, 160),
        alignment: String(pickField(index, ['Alignment']) || '').trim().slice(0, 80),
        detectedFieldNames: fields.map((field) => field.name).filter(Boolean).slice(0, 250)
      }
    }
  };
}

async function parsePdfCharacterImportBuffer(buffer, context = {}) {
  if (!Buffer.isBuffer(buffer)) throw fail('Character PDF must be a file buffer.');
  if (!buffer.length || buffer.length > CHARACTER_PDF_MAX_BYTES) throw fail('Character PDF is invalid or too large.', 'DND_CHARACTER_PDF_SIZE');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw fail('Character PDF signature is invalid.', 'DND_CHARACTER_PDF_SIGNATURE');
  const raw = buffer.toString('latin1');
  if (/\/Encrypt\b/.test(raw)) throw fail('Encrypted or password-protected character PDFs are not supported.', 'DND_CHARACTER_PDF_ENCRYPTED');
  const fields = extractPdfFormFields(buffer);
  if (!fields.length) throw fail('This PDF has no readable fillable character fields. Use D&D Beyond Export PDF rather than Print to PDF.', 'DND_CHARACTER_PDF_FORM_REQUIRED');
  const character = mapPdfFieldsToCharacter(fields);
  return normalizeCharacterImport({ format: 'dnd-character-pdf-form-v1', character }, { ...context, sourceSha256: sha256(buffer) });
}

module.exports = {
  CHARACTER_PDF_MAX_BYTES,
  normalizeFieldName,
  decodePdfName,
  decodePdfHex,
  readPdfToken,
  extractObjectBodies,
  extractPdfFormFields,
  mapPdfFieldsToCharacter,
  parsePdfCharacterImportBuffer
};
