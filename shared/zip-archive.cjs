'use strict';

const path = require('node:path');
const zlib = require('node:zlib');

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 200,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 75 * 1024 * 1024
});

let crcTable = null;

function getCrcTable() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertRange(buffer, offset, size, label) {
  if (!Number.isInteger(offset) || !Number.isInteger(size) || offset < 0 || size < 0 || offset + size > buffer.length) {
    throw new Error(`The ZIP archive is truncated near ${label}.`);
  }
}

function safeEntryName(value) {
  const raw = String(value || '').replace(/\\/g, '/').replace(/\u0000/g, '');
  const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error('The ZIP archive contains an invalid absolute entry path.');
  }
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error('The ZIP archive contains an unsafe parent-directory entry.');
  }
  return normalized;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('The selected file is not a supported ZIP archive.');
}

function readZipEntries(input, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (!buffer.length) throw new Error('The selected ZIP archive is empty.');
  if (buffer.length > limits.maxArchiveBytes) throw new Error(`The ZIP archive exceeds the ${Math.round(limits.maxArchiveBytes / 1024 / 1024)} MB safety limit.`);

  const eocdOffset = findEndOfCentralDirectory(buffer);
  assertRange(buffer, eocdOffset, 22, 'the central directory footer');
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error('Multi-disk ZIP archives are not supported.');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error('ZIP64 migration archives are not supported.');
  if (entryCount > limits.maxEntries) throw new Error(`The ZIP archive contains more than ${limits.maxEntries} entries.`);
  assertRange(buffer, centralOffset, centralSize, 'the central directory');

  const entries = new Map();
  let cursor = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(buffer, cursor, 46, `central-directory entry ${index + 1}`);
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) throw new Error(`The ZIP archive has an invalid central-directory entry at index ${index}.`);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16) >>> 0;
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const diskStart = buffer.readUInt16LE(cursor + 34);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const recordSize = 46 + nameLength + extraLength + commentLength;
    assertRange(buffer, cursor, recordSize, `central-directory entry ${index + 1}`);
    if (flags & 0x0001) throw new Error('Encrypted ZIP entries are not supported.');
    if (diskStart !== 0) throw new Error('Multi-disk ZIP entries are not supported.');
    if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method ${method}.`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error('ZIP64 entries are not supported.');
    if (uncompressedSize > limits.maxEntryBytes) throw new Error(`A ZIP entry exceeds the ${Math.round(limits.maxEntryBytes / 1024 / 1024)} MB safety limit.`);

    const name = safeEntryName(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += recordSize;
    if (name.endsWith('/')) continue;
    if (entries.has(name)) throw new Error(`The ZIP archive contains duplicate entry ${name}.`);

    assertRange(buffer, localOffset, 30, `local header for ${name}`);
    if (buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error(`The ZIP archive has an invalid local header for ${name}.`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assertRange(buffer, dataOffset, compressedSize, `compressed data for ${name}`);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    try {
      content = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxEntryBytes });
    } catch (error) {
      throw new Error(`Could not decompress ${name}: ${error.message || String(error)}`);
    }
    if (content.length !== uncompressedSize) throw new Error(`The ZIP entry ${name} did not match its declared size.`);
    if (crc32(content) !== expectedCrc) throw new Error(`The ZIP entry ${name} failed CRC verification.`);
    totalUncompressed += content.length;
    if (totalUncompressed > limits.maxTotalBytes) throw new Error(`The ZIP archive exceeds the ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB expanded-data safety limit.`);
    entries.set(name, content);
  }
  return entries;
}

module.exports = {
  DEFAULT_LIMITS,
  crc32,
  safeEntryName,
  readZipEntries
};
