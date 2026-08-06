'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const agentKey = String(process.argv[2] || '').trim().toLowerCase();
const entry = path.resolve(String(process.argv[3] || ''));
const allowedAgents = new Set(['dnd', 'core']);
let shuttingDown = false;

function diagnostic(code, message) {
  return JSON.stringify({
    event: 'khaos-nexus-ai-runtime.agent-launch-error',
    agent: agentKey || 'unknown',
    code,
    message: String(message || code).replace(/\s+/g, ' ').trim().slice(0, 500),
    exitCode: 70
  });
}

function shutdown(reason = 'parent-disconnected') {
  if (shuttingDown) return;
  shuttingDown = true;
  try { process.emit('SIGTERM', reason); } catch {}
  const timer = setTimeout(() => process.exit(0), 1500);
  timer.unref?.();
}

async function main() {
  if (!allowedAgents.has(agentKey)) {
    process.stderr.write(`${diagnostic('AI_AGENT_LAUNCHER_AGENT_INVALID', 'The runtime host supplied an invalid agent key.')}\n`);
    process.exitCode = 70;
    return;
  }
  if (!entry || !path.isAbsolute(entry)) {
    process.stderr.write(`${diagnostic('AI_AGENT_LAUNCHER_ENTRY_INVALID', 'The runtime host supplied an invalid agent entry point.')}\n`);
    process.exitCode = 70;
    return;
  }

  process.on('disconnect', () => shutdown());
  await import(pathToFileURL(entry).href);
}

main().catch((error) => {
  process.stderr.write(`${diagnostic(error?.code || 'AI_AGENT_LAUNCHER_FAILED', error?.message || error)}\n`);
  process.exitCode = 70;
});
