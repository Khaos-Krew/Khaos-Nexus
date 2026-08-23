'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { envSecret } = require('../shared/config.cjs');

const DESKTOP_NAMES = ['ThoraDesktop.exe', 'AssistantDesktop.exe'];
const WIDGET_NAMES = ['ThoraWidget.exe', 'AssistantWidget.exe'];
const COMPANION_NAMES = ['ThoraCompanion.exe', 'AssistantCompanion.exe'];
const PAGE_TARGETS = new Map([
  ['home', 'home'],
  ['personal', 'personal'],
  ['rewards', 'rewards'],
  ['household', 'household'],
  ['companion-studio', 'companion'],
  ['advanced', 'advanced']
]);

function configuredPath(config) {
  return String(config.thora?.executablePath || envSecret(config.thora?.executableEnv) || '').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(String(value))))];
}

function candidateDirectories(config) {
  const configured = configuredPath(config);
  const configuredDirectory = configured ? (path.extname(configured) ? path.dirname(configured) : configured) : '';
  const local = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.ProgramFiles || process.env.PROGRAMFILES || '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
  return unique([
    configuredDirectory,
    local && path.join(local, 'Programs', 'Thora Desktop'),
    local && path.join(local, 'Programs', 'Assistant Desktop'),
    local && path.join(local, 'Thora Desktop'),
    local && path.join(local, 'Assistant Desktop'),
    programFiles && path.join(programFiles, 'Thora Desktop'),
    programFiles && path.join(programFiles, 'Assistant Desktop'),
    programFilesX86 && path.join(programFilesX86, 'Thora Desktop'),
    programFilesX86 && path.join(programFilesX86, 'Assistant Desktop')
  ]);
}

function findExecutable(directories, names) {
  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function resolveComponents(config) {
  const configured = configuredPath(config);
  const directories = candidateDirectories(config);
  let desktop = '';
  if (configured && path.extname(configured) && fs.existsSync(configured)) desktop = configured;
  if (!desktop) desktop = findExecutable(directories, DESKTOP_NAMES);
  const installationDirectory = desktop ? path.dirname(desktop) : directories.find((directory) => fs.existsSync(directory)) || '';
  const searchDirectories = unique([installationDirectory, ...directories]);
  return {
    installationDirectory,
    desktop,
    widget: findExecutable(searchDirectories, WIDGET_NAMES),
    companion: findExecutable(searchDirectories, COMPANION_NAMES)
  };
}

function executablePath(config) {
  return resolveComponents(config).desktop || configuredPath(config);
}

function thoraStatus(config) {
  const enabled = config.thora?.enabled === true;
  const components = resolveComponents(config);
  return {
    enabled,
    configured: Boolean(components.desktop),
    executableExists: Boolean(components.desktop),
    installationDirectory: components.installationDirectory,
    source: config.thora?.executablePath ? 'desktop-config' : components.desktop ? 'auto-detected' : configuredPath(config) ? 'environment' : 'missing',
    components: {
      desktop: Boolean(components.desktop),
      quickChat: Boolean(components.widget),
      companion: Boolean(components.companion)
    },
    integrationReady: Boolean(components.desktop && components.widget && components.companion)
  };
}

function launchExecutable(executable, args = []) {
  if (!executable || !fs.existsSync(executable)) throw new Error('The requested Thora component is not installed.');
  const child = spawn(executable, args, {
    cwd: path.dirname(executable),
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  });
  child.unref();
  return { launched: true, component: path.basename(executable) };
}

function launchThora(config, requestedTarget = 'home') {
  const status = thoraStatus(config);
  if (!status.enabled) throw new Error('Thora integration is disabled.');
  const components = resolveComponents(config);
  const target = String(requestedTarget || 'home').trim().toLowerCase();

  if (target === 'quick-chat') {
    const result = launchExecutable(components.widget);
    return { ...result, target };
  }
  if (target === 'companion') {
    const result = launchExecutable(components.companion);
    return { ...result, target };
  }

  const page = PAGE_TARGETS.get(target);
  if (!page) throw new Error('Unknown Thora launch target.');
  if (!components.desktop) throw new Error('Choose or install the approved Thora Desktop build before launching Thora.');
  const result = launchExecutable(components.desktop, ['--page', page, '--from-nexus']);
  return { ...result, target, page };
}

module.exports = {
  DESKTOP_NAMES,
  WIDGET_NAMES,
  COMPANION_NAMES,
  PAGE_TARGETS,
  candidateDirectories,
  configuredPath,
  executablePath,
  launchThora,
  resolveComponents,
  thoraStatus
};
