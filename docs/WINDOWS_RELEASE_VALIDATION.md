# Khaos Nexus Windows Release Validation

This document defines the release-validation contract for the Nexus 0.1 Windows desktop line.

## Supported desktop target

- Architecture: Windows x64
- Installer: NSIS per-user/per-machine selectable install directory
- Update model: verified staged payload overlay with rollback and post-update health confirmation
- CI runtime: GitHub-hosted `windows-latest`

GitHub-hosted Windows runners are not a substitute for every consumer Windows build. CI is the automated release gate; owner-machine validation supplies the final real-device evidence for operating-system versions that GitHub does not host directly.

## Validation matrix

| Gate | Windows 11 | Windows 10 | Automated CI | Required for owner-test | Required for stable |
| --- | --- | --- | --- | --- | --- |
| Node tests + repository checks | Required | Required | `windows-latest` | Yes | Yes |
| NSIS package build | Required | Required | `windows-latest` | Yes | Yes |
| Silent clean install in isolated directory | Required | Required | `windows-latest` | Yes | Yes |
| Packaged app startup + embedded backend `/health` | Required | Required | `windows-latest` | Yes | Yes |
| Staged updater apply + restart | Required | Required | `windows-latest` | Yes | Yes |
| Post-update confirmation + rollback deadline | Required | Required | `windows-latest` | Yes | Yes |
| Deliberate failed update + automatic payload restoration + healthy restart | Required | Required | `windows-latest` | Yes | Yes |
| Installed `app.asar` matches staged payload | Required | Required | `windows-latest` | Yes | Yes |
| Packaged-content audit | Required | Required | `windows-latest` | Yes | Yes |
| Authenticode verification | Recommended | Recommended | `windows-latest` when credentials exist | No | **Yes** |
| Real desktop install/upgrade observation | Owner evidence | Owner evidence | No | Before broad owner testing | Before stable publication |

## CI evidence

Every accepted Windows artifact set must be produced from `Nexus Rebuild CI` and include:

- `Khaos-Nexus-<version>-Setup.exe`
- staged update ZIP
- `nexus-update-manifest.json`
- `nexus-windows-smoke-report.json`
- `nexus-package-audit.json`
- `nexus-windows-signing.json`

The smoke report must prove both paths: a successful staged update and an intentionally invalid staged payload that is rejected, rolled back byte-for-byte to the validated `app.asar`, and restarted with a healthy embedded backend.

Release publication promotes this exact validated artifact set. It does not rebuild the application during publication.

## Package-content policy

The packaged `app.asar` must contain the runtime entrypoints required by Nexus and must not contain repository-only or sensitive material. Automated audit rejects, at minimum:

- `.github/`
- test suites
- build/release scripts
- Electron/Electron Builder development packages
- `.env*`
- non-example local configuration files
- credential, token, private-key, or certificate material matching the audit rules

The public `config.example.json` remains permitted because it contains placeholders rather than deployment secrets.

## Signing policy

### Owner-test

Owner-test artifacts may remain unsigned while the signing certificate is not configured. The signing report must explicitly record that state as `unsigned-owner-test`.

If only part of the signing configuration is supplied, the build fails closed rather than silently producing an unsigned package.

### Stable

A stable validation run must have both protected GitHub secrets configured:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

The certificate/password are never committed to the repository. Electron Builder consumes these variables directly during the Windows build. After packaging, CI independently verifies Authenticode on both the packaged application executable and the NSIS installer. A stable artifact is rejected unless both signatures validate.

Stable publication must then consume the signing report from that exact validated CI artifact; an owner-test artifact cannot be relabeled as stable.

## Windows 10 / Windows 11 owner evidence

Before stable publication, perform at least one clean install and one staged upgrade on the oldest Windows version still intended to be supported and on the current Windows 11 owner environment where practical. Record:

1. OS version/build.
2. Installer launches and creates the expected desktop/Start Menu shortcuts.
3. Nexus starts without repair or compatibility prompts.
4. Embedded backend reaches healthy state.
5. Update downloads/stages/applies without running a second full installer.
6. Restart confirms the update and does not roll back.
7. Discord/admin configuration persists across the upgrade.

A failure on either OS blocks stable publication until repaired or the supported-OS statement is deliberately revised.

## Release boundary

Passing CI authorizes an artifact for further validation; it does not itself authorize a public/stable release. Stable publication remains an explicit owner action after signing credentials and owner-device evidence are available.
