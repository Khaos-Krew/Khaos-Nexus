# ADR-012 — Renderer lifecycle and state fan-out

Status: Accepted

## Context

Khaos Nexus accumulated renderer features as independent Electron extensions. Many extensions registered their own `browser-window-created` / `did-finish-load` listeners, read renderer assets synchronously on every load, and installed separate `state:update` IPC listeners in the renderer. The v0.40.0 performance audit showed that this extension fan-out amplified other polling/observer work and made performance regressions harder to reason about.

## Decision

1. Renderer assets that belong to the D&D production surface are registered through `main/renderer-asset-loader.cjs`.
2. The loader owns one BrowserWindow lifecycle listener and applies registered bundles in deterministic registration order.
3. Renderer asset contents are read once when a bundle is registered, rather than synchronously from disk on every page load.
4. Bundles are applied at most once per main-frame document generation and are reapplied after a real main-frame navigation.
5. Global `state:update` IPC fan-out is centralized through `renderer/state-hub.js`. Feature renderers subscribe to the hub instead of each installing another IPC listener.
6. `state-hub.js` is loaded before the base renderer application and is also part of the branded renderer bootstrap for compatibility/recovery loads.
7. Periodic renderer work must be visibility-gated or active-workspace-gated unless continuous execution is required for correctness.
8. This consolidation does not change product authority boundaries: AI remains manual-start, Veyra remains outside system maintenance, D&D deterministic mechanics remain authoritative, and Discord publication remains review-controlled.

## Consequences

- Main-process `did-finish-load` ownership is materially reduced.
- Renderer `state:update` IPC listener count is reduced to one on the primary interface.
- D&D renderer asset ordering is explicit and deterministic.
- Fewer independent lifecycle listeners means lower fan-out during startup, reload, recovery, and navigation.
- New renderer bundles should use the shared loader rather than adding a new BrowserWindow lifecycle hook unless a documented exception is required.
- New global state consumers should subscribe through the state hub rather than directly to `window.khaos.onState`.
