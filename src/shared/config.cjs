'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadConfig() {
  const root = path.resolve(__dirname, '../..');
  const requested = process.env.NEXUS_CONFIG ? path.resolve(process.env.NEXUS_CONFIG) : path.join(root, 'config.json');
  const fallback = path.join(root, 'config.example.json');
  const source = fs.existsSync(requested) ? requested : fallback;
  const config = readJson(source);
  config.__source = source;
  return config;
}

function envSecret(name) {
  return name ? String(process.env[name] || '') : '';
}

module.exports = { loadConfig, envSecret };
