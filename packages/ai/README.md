# Embedded AI production source

This directory contains the production source snapshots shipped by Khaos Nexus.

- `dnd-ai/` is the embedded D&D AI sidecar source.
- `ai-core/` is the embedded Nexus AI Core sidecar source.
- `embedded-ai-lock.json` records immutable snapshot integrity evidence.

Do not edit synchronized service files directly. Reproduce and validate fixes in the corresponding isolated repository, update `config/embedded-ai-sources.json` to the exact green commit, and allow `.github/workflows/embed-ai-sources.yml` to regenerate these snapshots.

The desktop repository is the production authority. The services still run as independent Electron-embedded Node processes so their crashes, ports, credentials, logs, and restarts remain isolated from the Electron main process.
