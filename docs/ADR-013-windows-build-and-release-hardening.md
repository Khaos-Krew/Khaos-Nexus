# ADR-013 — Windows Build and Release Hardening

Status: Accepted for implementation

## Context
Khaos Nexus is desktop-first on Windows. Production confidence therefore depends on validating the actual installer/portable package, not only source-level tests. The v0.40 performance audit also showed that release validation needs to stay deterministic and auditable as the application grows.

## Decision

1. CI uses the lockfile with `npm ci`; dependency downloads may be cached, but resolved versions may not drift from `package-lock.json`.
2. Windows builds cache npm, Electron, and Electron Builder downloads to reduce repeated build cost without changing application inputs.
3. Every Windows candidate must pass source tests/checks, packaged-content audit, unpacked packaged startup smoke, clean installer smoke, artifact hashing/manifest generation, and signing-policy verification.
4. Production publishers must additionally run the previous-public-release upgrade smoke against the frozen production version and require updater metadata (`latest.yml` + blockmap) before publication.
5. The production publisher must publish the same installer/portable/updater artifacts that passed its validation steps. Validation and publication may occur in one protected job; a second unvalidated rebuild is not an acceptable promotion step.
6. `app.asar` must not contain root development-only directories such as `.github`, `test`, `docs`, `scripts`, `coverage`, or `release-notes`. The package remains an explicit allowlist rather than a broad repository glob.
7. Authenticode verification is advisory until Owner-managed signing credentials are configured. Once configured, repository/environment variable `KHAOS_REQUIRE_SIGNING=1` converts the signing check into a hard release gate. Signing secrets/certificates must never be committed to the repository.
8. AI manual-start policy, Veyra/Sentinel authority boundaries, D&D deterministic mechanics, recovery rollback protections, and updater rollback metadata are release invariants and may not be weakened by build optimization.

## Windows matrix

Required automated baseline:
- GitHub-hosted Windows runner: source tests/checks, installer + portable build, packaged startup, clean install.

Production publisher:
- previous public release -> candidate upgrade using the same isolated user-data tree;
- persistence marker must survive the upgrade;
- candidate must reach full startup readiness after upgrade.

Future expansion when dedicated runners/VMs are available:
- Windows 10 x64 clean install + upgrade;
- Windows 11 x64 clean install + upgrade;
- low-resource VM profile;
- signed installer reputation/SmartScreen validation.

GitHub-hosted runners do not provide a Windows 10/11 consumer-client matrix, so those exact OS versions require self-hosted VMs or another Windows test service.

## Branch/release protection target

The production branch should require successful CI, Windows Build, and D&D AI Integration checks before merge, disallow force pushes, and avoid direct production commits except protected automation. Production release secrets should live in a protected GitHub Environment with Owner-controlled access.

## Consequences

Builds become more repeatable and slightly more comprehensive. Clean installer and production upgrade smoke add Windows runtime time, while dependency/Electron caching offsets part of that cost. Code signing can be activated later without another pipeline redesign.
