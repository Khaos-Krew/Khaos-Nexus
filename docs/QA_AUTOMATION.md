# Nexus QA Automation

Nexus QA is designed to make validation automatic and low-friction. Developers should not have to remember a long sequence of test commands before every change or release.

## Everyday use

On Windows, double-click `Run-QA.bat` or run it from a terminal:

```bat
Run-QA.bat
```

The default `quick` mode performs:

- package/release metadata consistency checks;
- JavaScript syntax/package checks;
- a small critical smoke set covering access recovery, application monitoring, and diagnostic reporting when those tests are present.

For the complete suite:

```bat
Run-QA.bat full
```

Full mode runs the metadata contract, syntax/package checks, and the complete Node test suite.

If `node_modules` is missing, the Windows launcher automatically runs `npm ci` first so a developer does not need a separate setup step.

## Reports

Every run writes machine-readable and human-readable reports to:

- `.validation/qa/latest.json`
- `.validation/qa/latest.md`

The directory is intentionally ignored by Git so local QA output never creates repository noise.

## GitHub Actions

`.github/workflows/qa.yml` runs the full Windows QA suite automatically on pull requests and relevant development/release branches. It also supports `workflow_dispatch` for a one-click manual run in GitHub Actions.

The workflow uploads `.validation/qa/` as a short-lived artifact even when QA fails. This makes defect review easier because the exact failing checks remain attached to the run.

## Release gate

The stable Windows release workflow must run `node scripts/qa.cjs full` before packaging. A failed QA run stops the job before installer generation or publication.

The release workflow also uploads the QA report so a failed release candidate has an inspectable validation artifact instead of only console output.

## Regression rule

When a defect is fixed, add or strengthen an automated test that reproduces the defect whenever practical. The goal is for a fixed defect to become permanently harder to reintroduce.

## Test tiers

The intended long-term tiers are:

1. **Quick** — metadata, syntax, and critical smoke tests for routine development.
2. **Full** — all unit/integration tests and package checks for PRs and release candidates.
3. **System** — Windows UI, installer/update, service-failure, database, Discord, game-adapter, and performance tests as those harnesses are added.

The single QA runner should remain the front door. New test systems should be attached behind it instead of requiring developers to memorize additional commands.
