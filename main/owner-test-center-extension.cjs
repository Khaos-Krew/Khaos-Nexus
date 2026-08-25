'use strict';

const path = require('node:path');
const { ipcMain, shell } = require('electron');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

const OWNER = 'Khaos-Krew';
const REPO = 'Khaos-Nexus';
const BRANCH = 'owner-test/android-resume-v0.41.2';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const REQUIRED_WORKFLOWS = Object.freeze([
  'CI',
  'Diagnostics Runtime Integration',
  'Bundled AI Runtimes',
  'Windows Build',
  'Android Owner Test'
]);
const CACHE_MS = 60 * 1000;

let installed = false;
let cache = null;
let cacheAt = 0;

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Khaos-Nexus-Owner-Test-Center'
  };
}

async function github(pathname) {
  const response = await fetch(`${API_ROOT}${pathname}`, { headers: githubHeaders() });
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const suffix = remaining === '0' ? ' GitHub API rate limit reached; try again later.' : '';
    throw new Error(`GitHub Actions request failed with status ${response.status}.${suffix}`);
  }
  return response.json();
}

function runTime(run) {
  return Date.parse(run?.updated_at || run?.created_at || '') || 0;
}

function summarizeRun(run) {
  if (!run) return null;
  return {
    id: Number(run.id),
    name: String(run.name || ''),
    status: String(run.status || 'unknown'),
    conclusion: run.conclusion ? String(run.conclusion) : null,
    runNumber: Number(run.run_number || 0),
    url: String(run.html_url || `https://github.com/${OWNER}/${REPO}/actions/runs/${run.id}`),
    updatedAt: run.updated_at || run.created_at || null
  };
}

function artifactUiUrl(runId, artifactId) {
  return `https://github.com/${OWNER}/${REPO}/actions/runs/${runId}/artifacts/${artifactId}`;
}

function usefulArtifact(artifact) {
  if (!artifact || artifact.expired) return false;
  const name = String(artifact.name || '');
  return !/(failed|failure|diagnostic|smoke-output|test-output|audit|manifest|checksum-only)/i.test(name);
}

async function artifactsFor(run) {
  if (!run?.id || run.status !== 'completed' || run.conclusion !== 'success') return [];
  const payload = await github(`/actions/runs/${run.id}/artifacts?per_page=100`);
  return (payload.artifacts || []).filter(usefulArtifact).map((artifact) => ({
    id: Number(artifact.id),
    name: String(artifact.name || 'Artifact'),
    size: Number(artifact.size_in_bytes || 0),
    expired: Boolean(artifact.expired),
    createdAt: artifact.created_at || null,
    url: artifactUiUrl(run.id, artifact.id),
    runId: Number(run.id)
  }));
}

function chooseArtifact(artifacts, platform) {
  const patterns = platform === 'windows'
    ? [/Khaos-Nexus-Windows/i, /Windows/i, /Setup/i, /Portable/i]
    : [/Khaos-Nexus-Mobile-Android/i, /Android/i, /Mobile/i, /APK/i];
  return artifacts.find((item) => patterns.some((pattern) => pattern.test(item.name))) || null;
}

function workflowState(workflows) {
  const required = REQUIRED_WORKFLOWS.map((name) => workflows.get(name)).filter(Boolean);
  const missing = REQUIRED_WORKFLOWS.filter((name) => !workflows.has(name));
  const active = required.some((run) => run.status !== 'completed');
  const failed = required.filter((run) => run.status === 'completed' && run.conclusion !== 'success');
  const ready = missing.length === 0 && !active && failed.length === 0;
  return { ready, missing, active, failed: failed.map((run) => run.name) };
}

async function buildCandidate(group) {
  const windowsRun = group.workflows.get('Windows Build');
  const androidRun = group.workflows.get('Android Owner Test');
  const [windowsArtifacts, androidArtifacts] = await Promise.all([
    artifactsFor(windowsRun),
    artifactsFor(androidRun)
  ]);
  const state = workflowState(group.workflows);
  const windows = chooseArtifact(windowsArtifacts, 'windows');
  const android = chooseArtifact(androidArtifacts, 'android');
  return {
    sha: group.sha,
    shortSha: group.sha.slice(0, 8),
    branch: group.branch,
    updatedAt: new Date(group.updatedAt).toISOString(),
    ready: state.ready && Boolean(windows) && Boolean(android),
    workflowReady: state.ready,
    missingWorkflows: state.missing,
    active: state.active,
    failedWorkflows: state.failed,
    workflows: REQUIRED_WORKFLOWS.map((name) => summarizeRun(group.workflows.get(name))).filter(Boolean),
    artifacts: { windows, android },
    runUrl: windowsRun?.html_url || androidRun?.html_url || `https://github.com/${OWNER}/${REPO}/actions`
  };
}

async function queryOwnerTests(force = false) {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const query = new URLSearchParams({ branch: BRANCH, per_page: '50' });
  const payload = await github(`/actions/runs?${query.toString()}`);
  const groups = new Map();
  for (const run of payload.workflow_runs || []) {
    if (!REQUIRED_WORKFLOWS.includes(run.name)) continue;
    const sha = String(run.head_sha || '').trim();
    if (!sha) continue;
    let group = groups.get(sha);
    if (!group) {
      group = { sha, branch: run.head_branch || BRANCH, updatedAt: runTime(run), workflows: new Map() };
      groups.set(sha, group);
    }
    group.updatedAt = Math.max(group.updatedAt, runTime(run));
    const existing = group.workflows.get(run.name);
    if (!existing || runTime(run) > runTime(existing)) group.workflows.set(run.name, run);
  }

  const ordered = [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const candidates = [];
  for (const group of ordered) candidates.push(await buildCandidate(group));

  cache = {
    source: 'github-actions',
    repository: `${OWNER}/${REPO}`,
    branch: BRANCH,
    checkedAt: new Date().toISOString(),
    releaseUpdaterIndependent: true,
    candidates
  };
  cacheAt = Date.now();
  return cache;
}

function allowedExternalUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(`/${OWNER}/${REPO}/actions/`);
  } catch {
    return false;
  }
}

function registerIpc() {
  ipcMain.handle('owner-test:list', async (_event, input = {}) => queryOwnerTests(Boolean(input?.force)));
  ipcMain.handle('owner-test:open', async (_event, input = {}) => {
    const url = String(input?.url || '');
    if (!allowedExternalUrl(url)) throw new Error('Owner Test Center blocked an untrusted artifact URL.');
    await shell.openExternal(url);
    return { opened: true, url };
  });
}

function registerRenderer() {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  registerRendererBundle({
    id: 'owner-test-center',
    styles: [path.join(rendererRoot, 'owner-test-center.css')],
    scripts: [path.join(rendererRoot, 'owner-test-center.js')],
    source: 'owner-test-center-extension'
  });
}

function install() {
  if (installed) return;
  installed = true;
  registerIpc();
  registerRenderer();
}

module.exports = { install, queryOwnerTests, allowedExternalUrl, REQUIRED_WORKFLOWS, BRANCH };
