# Run Khaos Nexus from source on Windows

Khaos Nexus is currently being stabilized on the `stabilize/nexus-66-baseline` branch. For active desktop development and owner-test preparation, use that branch rather than assuming the repository default branch represents the current application source tree.

## Requirements

- Windows x64
- internet access for dependency/runtime download on first setup
- Node.js 22 or newer **or** permission for the included bootstrap script to install a private project-local Node.js runtime

End-user release builds do not require a separate system Node.js installation.

## Assisted Windows setup

1. Check out `stabilize/nexus-66-baseline`, or extract a source archive of that branch to a normal folder such as `Documents\Khaos Nexus`.
2. Double-click `Install-and-Run.bat`.
3. The setup checks for a compatible Node.js installation.
4. If Node.js is missing or too old, the bootstrap script downloads an official Node.js runtime into the project's private `.runtime` folder and verifies the expected checksum before continuing.
5. Dependencies are installed locally and Khaos Nexus starts through `npm start`.

The private runtime does not require administrator access, does not replace the system-wide Node.js installation, and is reused on later launches.

## Manual developer setup

From PowerShell or Command Prompt in the repository root:

```text
npm install
npm test
npm run check
npm start
```

`npm test` and `npm run check` should pass before a documentation change makes claims about newly implemented behavior or before a product change is proposed for owner testing.

## Windows packaging

`Build-Windows.bat` performs the assisted Node.js setup when necessary, installs dependencies, runs the repository tests/checks, and then runs the Windows distribution build.

The equivalent packaging command is:

```text
npm run dist:win
```

The package configuration currently targets Windows x64 and can produce:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`

A successful local package is a build artifact only. It is **not** automatically a published or authorized release.

## Stabilization validation

The active reset adds release requirements beyond a successful `npm test`/`npm run check` run. Before an owner-facing candidate is promoted, the stabilization policy also requires Windows/package validation, the golden desktop-shell invariants, synchronized version/release identity, redaction checks, and the required functional stability score.

See [`docs/NEXUS_STABILIZATION_RESET.md`](docs/NEXUS_STABILIZATION_RESET.md).

## Credential safety

The setup scripts do not ask for or transmit Discord tokens, RCON passwords, provider API keys, or similar operational credentials. Add protected credentials only through the application surfaces intended for them. Do not place real secrets in source files, issues, test fixtures, screenshots, or documentation.

See [`SECURITY.md`](SECURITY.md).
