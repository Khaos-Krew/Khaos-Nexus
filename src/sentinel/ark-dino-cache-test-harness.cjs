'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { deterministicRng, rollCache } = require('./ark-dino-cache-engine.cjs');
const { buildDinoDepotCommand, assertDeliverableRoll, classifyDeliveryResponse, cleanEosId } = require('./ark-dino-cache-purchase.cjs');

function journalFile() { return path.join(process.env.NEXUS_DATA_DIR || '/app/data', 'dino-cache-owner-tests.json'); }
function loadJournal(file = journalFile()) {
  try { const parsed = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(parsed.records) ? parsed : { version: 1, records: [] }; }
  catch (error) { if (error?.code === 'ENOENT') return { version: 1, records: [] }; throw error; }
}
function saveJournal(value, file = journalFile()) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
function updateRecord(id, patch, file = journalFile()) {
  const journal = loadJournal(file);
  const record = journal.records.find((entry) => entry.id === id);
  if (!record) throw new Error('Unknown Dino Cache test transaction.');
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  saveJournal(journal, file);
  return record;
}

async function runOwnerCacheTest({ cacheId, eosId, approved, rcon, rngSecret = process.env.NEXUS_DINO_CACHE_RNG_SECRET, file = journalFile() } = {}) {
  if (String(process.env.NEXUS_DINO_CACHE_TEST_MODE || 'false').toLowerCase() !== 'true') throw new Error('Dino Cache owner test mode is disabled.');
  if (approved !== true) throw new Error('Dino Cache test delivery requires approved=true.');
  const player = cleanEosId(eosId);
  const configuredOwner = cleanEosId(process.env.ARK_GEN1_OWNER_EOS_ID);
  if (player !== configuredOwner) throw new Error('Dino Cache testing is restricted to the configured MAP1 owner EOS ID.');
  if (!rcon?.execute) throw new Error('Sentinel RCON is unavailable.');
  const id = crypto.randomUUID();
  const roll = rollCache(String(cacheId || '').toLowerCase(), deterministicRng(rngSecret, `owner-test:gen1:${id}`));
  assertDeliverableRoll(roll);
  const now = new Date().toISOString();
  const journal = loadJournal(file);
  journal.records.push({ id, kind: 'NO_CHARGE_OWNER_TEST', serverId: 'gen1', playerEosId: player, cacheType: roll.cacheId, pointCost: 0, state: 'ROLLED', roll, createdAt: now, updatedAt: now });
  journal.records = journal.records.slice(-250);
  saveJournal(journal, file);
  updateRecord(id, { state: 'DELIVERING', deliveryStartedAt: new Date().toISOString() }, file);
  const command = buildDinoDepotCommand({ eosId: player, blueprint: roll.blueprint, level: roll.level });
  let response;
  try { response = await rcon.execute(command); }
  catch (error) {
    return updateRecord(id, { state: 'FAILED', failureClass: 'AMBIGUOUS', errorMessage: `RCON acknowledgement lost: ${String(error?.message || error).slice(0, 300)}` }, file);
  }
  const classified = classifyDeliveryResponse(response);
  if (classified.outcome !== 'DELIVERED') return updateRecord(id, { state: 'FAILED', failureClass: classified.outcome, errorMessage: classified.reason }, file);
  return updateRecord(id, { state: 'DELIVERED', deliveredAt: new Date().toISOString(), failureClass: '', errorMessage: '' }, file);
}

module.exports = { loadJournal, saveJournal, updateRecord, runOwnerCacheTest };
