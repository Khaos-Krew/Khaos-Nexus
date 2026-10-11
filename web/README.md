# Khaos Nexus Web Sidecar

Incubating React/TypeScript PWA for Khaos Nexus. This package is intentionally isolated from the active Windows desktop stabilization branch and is not connected to production services.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Current scope

- Responsive Nexus application shell
- Mobile navigation
- PWA manifest/service-worker generation
- Read-only service placeholders
- Environment-configured API boundary
- Generic private-capability placeholder

## Security boundary

Do not place Discord bot tokens, database service-role keys, game-server credentials, API secrets, or other privileged values in `VITE_*` variables. Vite exposes those variables to the browser bundle. Privileged operations must be performed through authenticated Nexus backend endpoints with server-side authorization and auditing.

## Next implementation gate

Define a versioned, read-only development API contract and an authentication/capability model before connecting any real Nexus service.
