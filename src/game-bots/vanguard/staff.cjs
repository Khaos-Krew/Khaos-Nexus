'use strict';

const { hasStaffRole } = require('./config.cjs');

function actorIsStaff(interaction, env = process.env) {
  if (hasStaffRole(interaction, env)) return true;
  const { isStaff } = require('../ops-spine.cjs');
  const { loadConfig } = require('../../shared/config.cjs');
  let config = { discord: {} };
  try {
    config = loadConfig();
  } catch {
    config = { discord: {} };
  }
  return isStaff(interaction, config);
}

module.exports = { actorIsStaff };
