'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const mode = String(process.argv[2] || 'quick').toLowerCase();
const validModes = new Set(['quick', 'full']);

if (!validModes.has(mode)) {
  console.error(`Unknown QA mode: ${mode}. Use "quick" or "full".`);
  process.exit(2);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const startedAt = new Date();
const results = [];

function runStep(name, command, args, options = {}) {
  const stepStarted = Date.now();
  console.log(`\n== ${name} ==`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'test' },
    shell: options.shell ?? (process.platform === 'win32' && /\.cmd$/i.test(command)),
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(`Unable to start ${command}: ${result.error.message}`);

  const passed = result.status === 0 && !result.error;
  const errors = result.error ? [result.error.message] : undefined;
  results.push({
    name,
    passed,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - stepStarted,
    ...(errors ? { errors } : {}),
  });

  console.log(`${passed ? 'PASS' : 'FAIL'}: ${name}`);
  return passed;
}

function validatePackageContract() {
  const stepStarted = Date.now();
  const name = 'Package/release metadata contract';
  console.log(`\n== ${name} ==`);

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    const errors = [];

    if (lock.version !== pkg.version) {
      errors.push(`package-lock.json version ${lock.version} does not match package.json ${pkg.version}`);
    }

    if (pkg.khaosRelease?.updaterVersion && pkg.khaosRelease.updaterVersion !== pkg.version) {
      errors.push(`khaosRelease.updaterVersion ${pkg.khaosRelease.updaterVersion} does not match package version ${pkg.version}`);
    }

    const displayVersion = pkg.khaosRelease?.displayVersion;
    const artifactVersion = pkg.khaosRelease?.artifactVersion;
    const publicTag = pkg.khaosRelease?.publicTag;

    if (displayVersion && artifactVersion && displayVersion !== artifactVersion) {
      errors.push(`displayVersion ${displayVersion} does not match artifactVersion ${artifactVersion}`);
    }
    if (displayVersion && publicTag && publicTag !== `v${displayVersion}`) {
      errors.push(`publicTag ${publicTag} does not match displayVersion ${displayVersion}`);
    }

    if (errors.length) {
      for (const error of errors) console.error(`- ${error}`);
      results.push({ name, passed: false, exitCode: 1, durationMs: Date.now() - stepStarted, errors });
      console.log(`FAIL: ${name}`);
      return false;
    }

    results.push({ name, passed: true, exitCode: 0, durationMs: Date.now() - stepStarted });
    console.log(`PASS: ${name}`);
    return true;
  } catch (error) {
    console.error(error.stack || error.message);
    results.push({ name, passed: false, exitCode: 1, durationMs: Date.now() - stepStarted, errors: [error.message] });
    console.log(`FAIL: ${name}`);
    return false;
  }
}

function runQuickSmokeTests() {
  const candidates = [
    'test/access-recovery.test.cjs',
    'test/application-monitor.test.cjs',
    'test/diagnostic-github-bridge.test.cjs',
  ].filter((file) => fs.existsSync(path.join(root, file)));

  if (!candidates.length) {
    results.push({
      name: 'Critical smoke tests',
      passed: true,
      skipped: true,
      exitCode: 0,
      durationMs: 0,
    });
    console.log('\nSKIP: Critical smoke tests (no smoke test files found)');
    return true;
  }

  return runStep('Critical smoke tests', process.execPath, ['--test', ...candidates], { shell: false });
}

validatePackageContract();
runStep('JavaScript syntax/package checks', npmCommand, ['run', 'check']);

if (mode === 'quick') {
  runQuickSmokeTests();
} else {
  runStep('Complete automated test suite', npmCommand, ['test']);
}

const finishedAt = new Date();
const passed = results.every((result) => result.passed);
const reportDir = path.join(root, '.validation', 'qa');
fs.mkdirSync(reportDir, { recursive: true });

const report = {
  schemaVersion: 1,
  mode,
  passed,
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  durationMs: finishedAt.getTime() - startedAt.getTime(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  results,
};

fs.writeFileSync(path.join(reportDir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# Nexus QA Report',
  '',
  `- Mode: **${mode}**`,
  `- Result: **${passed ? 'PASS' : 'FAIL'}**`,
  `- Started: ${report.startedAt}`,
  `- Finished: ${report.finishedAt}`,
  `- Platform: ${report.platform}`,
  `- Node: ${report.node}`,
  '',
  '## Checks',
  '',
  ...results.map((result) => `- ${result.passed ? '✅' : '❌'} ${result.name}${result.skipped ? ' (skipped)' : ''} — ${result.durationMs} ms${result.errors?.length ? ` — ${result.errors.join('; ')}` : ''}`),
  '',
];
fs.writeFileSync(path.join(reportDir, 'latest.md'), `${markdown.join('\n')}\n`);

console.log('\n==============================');
console.log(`NEXUS QA: ${passed ? 'PASS' : 'FAIL'} (${mode})`);
console.log(`Report: ${path.relative(root, path.join(reportDir, 'latest.md'))}`);
console.log('==============================');

process.exit(passed ? 0 : 1);
