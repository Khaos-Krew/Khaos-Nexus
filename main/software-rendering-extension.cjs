'use strict';

const { app } = require('electron');

let installed = false;

function hardwareRenderingRequested() {
  return process.argv.includes('--hardware-renderer') || process.env.KHAOS_NEXUS_HARDWARE_RENDERING === '1';
}

function install() {
  if (installed) return;
  installed = true;
  if (hardwareRenderingRequested()) {
    console.info('[Khaos Nexus] Hardware rendering explicitly enabled.');
    return;
  }
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  console.info('[Khaos Nexus] Software rendering enabled for Windows compatibility.');
}

module.exports = { install, hardwareRenderingRequested };
