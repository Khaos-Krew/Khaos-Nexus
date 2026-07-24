# Run from the source package on Windows

This fallback is provided in case a GitHub Actions executable has not been published yet.

## One-click setup

1. Extract the source ZIP to a normal folder such as `Documents\Khaos Nexus Bot Manager`.
2. Double-click `Install-and-Run.bat`.
3. The setup checks for a compatible Node.js installation.
4. When Node.js is missing or too old, it downloads the current official Node.js LTS ZIP into the app's private `.runtime` folder, verifies the official SHA-256 checksum, and continues automatically.
5. The script installs the app dependencies and opens the desktop manager.

The private runtime does not require administrator access, does not alter the system-wide Node.js installation, and is reused on future launches.

## Create normal Windows executables

After the source version starts successfully, double-click `Build-Windows.bat`. The same integrated Node.js setup is available there. The build script runs the tests and creates both files in `dist`:

- assisted Windows installer;
- portable Windows executable.

The finished installer and portable executable include everything required to run the manager. End users do not need Node.js installed separately.

## Safety

The setup scripts do not ask for or transmit Discord tokens. Enter the token only inside the manager's Bot Setup screen, where Windows protected storage is used.
