# Khaos Nexus Versioning

Khaos Nexus uses a four-part **visible product version** so every owner-test package has a unique, human-readable identity:

`release.beta.test.hotfix`

Example: `0.41.2.1`

- `release` — product release line.
- `beta` — beta line within that release.
- `test` — owner-test/candidate line.
- `hotfix` — rebuild or corrective revision of that exact test line.

## Current owner-test identity

Visible version: `0.41.2.1`

Electron/npm require SemVer, so the desktop package also carries a separate monotonic internal updater version. For owner-test builds the mapping is:

`R.B.T.H` -> `R.B.(T+1)-test.H`

Therefore visible `0.41.2.1` maps to internal `0.41.3-test.1`.

The visible four-part number is authoritative for humans, downloads, Discord/Sentinel reporting, Android `versionName`, installer filenames, diagnostics, and the desktop footer. The internal SemVer exists only where package/update tooling requires it.

## Single source of truth

`config/release-identity.json` owns the build identity. `scripts/apply-release-identity.cjs` validates that identity and propagates it to:

- `package.json` and Electron updater identity
- Windows installer and portable artifact names
- `package-lock.json` root package identity when the script is run
- Android `versionName`
- Android monotonic `versionCode`

Do not hand-edit downstream version strings for a normal version bump.

## Owner-test bump

Run:

```bash
npm run version:next-owner-test
```

This advances only the final owner-test revision, for example:

`0.41.2.1` -> `0.41.2.2`

It then reapplies the identity across desktop and Android metadata.

## Android versionCode

Android uses a numeric code derived from the visible version:

`release * 100000000 + beta * 10000 + test * 100 + hotfix`

For `0.41.2.1`, the code is `410201`.

## CI enforcement

`npm run check` runs `scripts/check-version-identity.cjs`. Owner-test validation fails if:

- the visible version is not four-part numeric `release.beta.test.hotfix`;
- Electron/npm internal identity does not match the expected mapping;
- Windows installer/portable artifact names do not include the visible version;
- Android `versionName` or `versionCode` drift;
- Windows or Android owner-test workflows stop rebuilding owner-test branches;
- workflow artifact names stop carrying the visible version;
- the sidebar regression protection allowing navigation copy to exceed the legacy 18px span width disappears.

## Packaging rule

**Two materially different owner-test packages must never ship with the same visible version.**

Any rebuild intended for human testing must increment the owner-test revision before its downloads are distributed. Windows and Android owner-test workflows rebuild on the same owner-test commit so a matched test pair can be traced to one SHA.

## Release updater vs Owner Test Center

The normal in-app updater remains the published release channel and depends on release metadata such as `latest.yml`.

Owner-test candidates are not required to be published GitHub Releases. The Owner Test Center and Nexus Sentinal build feed use successful GitHub Actions artifacts so pre-release manual testing is not blocked by release-channel metadata.
