'use strict';

const fs = require('node:fs');
const path = require('node:path');

function runtimeDataDir(env = process.env) {
  const configured = String(env.NEXUS_DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  return configured ? path.resolve(configured) : path.resolve(__dirname, '../../data');
}

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

async function upsertEmbed(client, channelId, messageId, payload) {
  const id = String(channelId || '').trim();
  if (!/^\d{17,20}$/.test(id) || typeof client?.channels?.fetch !== 'function') {
    return { pinned: false, reason: 'unset' };
  }
  const channel = await client.channels.fetch(id).catch(() => null);
  if (!channel || typeof channel.send !== 'function') return { pinned: false, reason: 'missing' };
  const body = { ...payload, allowedMentions: { parse: [] } };
  const existingId = String(messageId || '').replace(/\D/g, '').slice(0, 20);
  if (existingId && channel.messages?.fetch) {
    const message = await channel.messages.fetch(existingId).catch(() => null);
    if (message?.edit) {
      await message.edit(body);
      return { pinned: true, messageId: existingId, edited: true };
    }
  }
  const sent = await channel.send(body);
  return { pinned: true, messageId: String(sent?.id || ''), edited: false };
}

module.exports = { runtimeDataDir, readJson, writeJson, upsertEmbed };
