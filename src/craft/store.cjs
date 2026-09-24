'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRconEndpoint } = require('../backend/transports/source-rcon.cjs');
const { runtimeDataDir } = require('../game-bots/panel-message.cjs');

const VERSION = 1;

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function writeExclusive(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeServerName(value) {
  const name = String(value || 'default').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new Error('Server name must use letters, numbers, dash, or underscore.');
  return name;
}

function normalizePassword(value) {
  const password = String(value || '');
  if (!password || password.length > 256 || /[\r\n\u0000]/.test(password)) throw new Error('RCON password is invalid.');
  return password;
}

function snowflake(value) {
  const id = String(value || '').trim();
  return /^\d{17,20}$/.test(id) ? id : '';
}

class CraftStore {
  constructor(root, env = {}) {
    this.dir = root ? path.resolve(String(root)) : runtimeDataDir(env);
    this.env = env;
    this.file = path.join(this.dir, 'nexus-craft.json');
    this.rconFile = path.join(this.dir, 'nexus-craft-rcon.json');
    this.secretFile = path.join(this.dir, 'nexus-craft-rcon-secret');
  }

  emptyState() {
    return { version: VERSION, boardChannelId: '', statusPanel: null, listings: {}, applications: {} };
  }

  readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return this.emptyState();
      return {
        version: VERSION,
        boardChannelId: snowflake(parsed.boardChannelId),
        statusPanel: parsed.statusPanel && typeof parsed.statusPanel === 'object' ? parsed.statusPanel : null,
        listings: parsed.listings && typeof parsed.listings === 'object' ? parsed.listings : {},
        applications: parsed.applications && typeof parsed.applications === 'object' ? parsed.applications : {}
      };
    } catch {
      return this.emptyState();
    }
  }

  writeState(state) {
    const safe = {
      version: VERSION,
      boardChannelId: snowflake(state.boardChannelId),
      statusPanel: state.statusPanel || null,
      listings: state.listings || {},
      applications: state.applications || {},
      updatedAt: new Date().toISOString()
    };
    atomicWrite(this.file, `${JSON.stringify(safe, null, 2)}\n`);
    return safe;
  }

  boardChannelId() {
    return this.readState().boardChannelId;
  }

  setBoardChannel(channelId) {
    const id = snowflake(channelId);
    if (!id) throw new Error('Board channel id is invalid.');
    const state = this.readState();
    state.boardChannelId = id;
    this.writeState(state);
    return id;
  }

  createListing({ ownerId, name, edition, description, slots, image = '', channelId = '', messageId = '' } = {}) {
    const owner = snowflake(ownerId);
    if (!owner) throw new Error('Realm owner is invalid.');
    const state = this.readState();
    const id = crypto.randomBytes(6).toString('hex');
    const now = new Date().toISOString();
    state.listings[id] = {
      id,
      ownerId: owner,
      name: String(name || '').slice(0, 80),
      edition: edition === 'bedrock' ? 'bedrock' : 'java',
      description: String(description || '').slice(0, 1000),
      slots: Math.max(0, Math.min(50, Number(slots) || 0)),
      image: String(image || '').slice(0, 300),
      channelId: snowflake(channelId),
      messageId: snowflake(messageId),
      status: 'open',
      createdAt: now,
      updatedAt: now
    };
    this.writeState(state);
    return state.listings[id];
  }

  getListing(id) {
    const key = String(id || '').trim().toLowerCase();
    return this.readState().listings[key] || null;
  }

  saveListing(listing) {
    const current = this.getListing(listing?.id);
    if (!current) throw new Error('That Realm listing was not found.');
    const state = this.readState();
    state.listings[current.id] = { ...current, ...listing, id: current.id, ownerId: current.ownerId, updatedAt: new Date().toISOString() };
    this.writeState(state);
    return state.listings[current.id];
  }

  addApplication({ listingId, applicantId, gamertag, note = '' } = {}) {
    const listing = this.getListing(listingId);
    const applicant = snowflake(applicantId);
    if (!listing || listing.status !== 'open') throw new Error('That Realm listing is closed.');
    if (!applicant) throw new Error('Applicant is invalid.');
    const state = this.readState();
    const pending = Object.values(state.applications).some((item) => item
      && item.listingId === listing.id
      && item.applicantId === applicant
      && item.status === 'pending');
    if (pending) {
      const error = new Error('You already have a pending application for that Realm.');
      error.code = 'PENDING';
      throw error;
    }
    const id = crypto.randomBytes(6).toString('hex');
    state.applications[id] = {
      id,
      listingId: listing.id,
      applicantId: applicant,
      gamertag: String(gamertag || '').slice(0, 32),
      note: String(note || '').slice(0, 200),
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    this.writeState(state);
    return state.applications[id];
  }

  getApplication(id) {
    const key = String(id || '').trim().toLowerCase();
    return this.readState().applications[key] || null;
  }

  setApplicationStatus(id, status) {
    const current = this.getApplication(id);
    if (!current) throw new Error('That Realm application was not found.');
    const state = this.readState();
    state.applications[current.id] = { ...current, status, updatedAt: new Date().toISOString() };
    this.writeState(state);
    return state.applications[current.id];
  }

  getStatusPanel() {
    return this.readState().statusPanel;
  }

  setStatusPanel(panel) {
    const state = this.readState();
    state.statusPanel = {
      channelId: snowflake(panel.channelId),
      messageId: snowflake(panel.messageId),
      host: String(panel.host || '').slice(0, 255),
      javaPort: Number(panel.javaPort) || 25565,
      bedrockPort: Number(panel.bedrockPort) || 19132
    };
    this.writeState(state);
    return state.statusPanel;
  }

  readRcon() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.rconFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return { version: VERSION, servers: {} };
      return { version: VERSION, servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {} };
    } catch {
      return { version: VERSION, servers: {} };
    }
  }

  writeRcon(state) {
    atomicWrite(this.rconFile, `${JSON.stringify({ version: VERSION, servers: state.servers || {} }, null, 2)}\n`);
  }

  hasCiphertext() {
    return Object.values(this.readRcon().servers).some((record) => record && record.password);
  }

  secret() {
    const explicit = String(this.env.NEXUS_RCON_CONFIG_SECRET || '').trim();
    if (explicit) {
      if (Buffer.byteLength(explicit) < 32) throw new Error('NEXUS_RCON_CONFIG_SECRET must contain at least 32 characters.');
      return explicit;
    }
    try {
      const existing = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
      if (existing) return existing;
    } catch {}
    if (this.hasCiphertext()) {
      const error = new Error('RCON vault key is missing. Refusing to mint a new key over saved ciphertext.');
      error.code = 'RCON_VAULT_KEY_MISSING';
      throw error;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    try {
      writeExclusive(this.secretFile, `${generated}\n`);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const stored = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
    if (stored) return stored;
    throw new Error('Unable to initialize the RCON config secret.');
  }

  encryptionKey() {
    return crypto.createHash('sha256').update(this.secret()).digest();
  }

  encrypt(value) {
    const text = String(value || '');
    if (!text) throw new Error('RCON password cannot be empty.');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return {
      v: 1,
      alg: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64')
    };
  }

  decrypt(payload) {
    if (!payload || payload.v !== 1 || payload.alg !== 'aes-256-gcm') return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey(), Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return '';
    }
  }

  getServer(name = 'default') {
    const key = normalizeServerName(name);
    const record = this.readRcon().servers[key];
    if (!record) return null;
    let password = '';
    let passwordUnreadable = false;
    if (record.password) {
      try {
        password = this.decrypt(record.password);
        passwordUnreadable = !password;
      } catch (error) {
        if (error?.code !== 'RCON_VAULT_KEY_MISSING') throw error;
        passwordUnreadable = true;
      }
    }
    return {
      name: key,
      host: String(record.host || ''),
      port: Number(record.port || 0),
      password,
      passwordConfigured: Boolean(password),
      passwordUnreadable,
      timeoutMs: 8000,
      source: 'discord-store'
    };
  }

  publicStatus(name = 'default') {
    const server = this.getServer(name);
    if (!server) {
      return { name: normalizeServerName(name), host: '', port: 0, password: 'missing', source: 'discord-store' };
    }
    return {
      name: server.name,
      host: server.host,
      port: server.port,
      password: server.passwordUnreadable ? 'unreadable' : server.passwordConfigured ? 'configured' : 'missing',
      source: 'discord-store'
    };
  }

  listPublicStatus() {
    return Object.keys(this.readRcon().servers).sort().map((name) => this.publicStatus(name));
  }

  saveServer({ name = 'default', host, port, password, actorId = '' } = {}) {
    const key = normalizeServerName(name);
    const endpoint = normalizeRconEndpoint(host, port);
    const state = this.readRcon();
    if (!state.servers[key] && Object.keys(state.servers).length >= 20) throw new Error('Too many RCON servers are saved.');
    state.servers[key] = {
      host: endpoint.host,
      port: endpoint.port,
      password: this.encrypt(normalizePassword(password)),
      updatedAt: new Date().toISOString(),
      updatedBy: snowflake(actorId)
    };
    this.writeRcon(state);
    return this.publicStatus(key);
  }

  clearServer(name = 'default') {
    const key = normalizeServerName(name);
    const state = this.readRcon();
    const existed = Boolean(state.servers[key]);
    delete state.servers[key];
    this.writeRcon(state);
    return existed;
  }
}

function openCraftStore(env = process.env) {
  return new CraftStore(runtimeDataDir(env), env);
}

module.exports = {
  CraftStore,
  openCraftStore,
  normalizeServerName,
  normalizePassword
};
