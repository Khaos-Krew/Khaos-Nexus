# ADR-011 — Self-Healing and Adaptive Local AI

**Status:** Accepted for Khaos Nexus desktop production architecture  
**Date:** 2026-08-08

## Context

Khaos Nexus must support self-hosted AI on a low-end Windows PC first, scale upward as CPU, RAM, VRAM, and provider capacity become available, and later move the same agent identities to a LAN server, rack, hosted GPU, or optional API fallback. The system must also recover safely from common runtime failures without giving an LLM unrestricted control of the desktop.

The existing production architecture already has one supervised Khaos Nexus AI Runtime with two isolated workers:

- **Veyra** — D&D Lorewarden and Co-DM.
- **Nexus Sentinel** — system health and assistance AI.

The AI Runtime remains Owner-controlled and manual-start only.

## Decision

### 1. Deterministic Recovery Supervisor

A non-LLM Recovery Supervisor sits below Veyra and Nexus Sentinel. It owns deterministic health sampling, resource budgeting, approved repair execution, verification, rollback, crash-window tracking, and Recovery Safe Mode state.

The Recovery Supervisor must continue to function when either AI agent or all inference providers are unavailable.

### 2. Manual-start authorization is preserved

Installing or starting the desktop Recovery Supervisor does **not** authorize AI startup.

Automatic runtime recovery may only retry agents that were already observed in `starting`, `running`, or `ready` state during the current desktop session and then became failed. Intentional `stopping` clears recovery authorization. A cold or intentionally stopped AI Runtime must remain stopped.

### 3. Repair authority levels

- **L0 — Automatic transient repair:** restart an already-authorized failed runtime, reload a model, or clear explicitly bounded transient AI cache.
- **L1 — Automatic safe-state repair:** restore a known-good local configuration or rebuild an explicitly bounded local index/cache.
- **L2 — Controlled repair:** reinstall a component or alter service configuration. Owner approval is required before execution.
- **L3 — High-impact repair:** source code, database schema, permissions, credentials, updater, or security changes. Owner approval is always required before execution.

Only deterministic, allowlisted repair handlers may execute. There is no generic shell/command repair action.

### 4. Agent authority boundaries

Veyra receives no application diagnostics, repair actions, system credentials, or maintenance authority.

Nexus Sentinel may diagnose faults and propose repairs, but it does not directly execute repair handlers. Approved execution is performed by the deterministic Recovery Supervisor.

Nexus Sentinel continues to receive no campaign, character, homebrew, or DM-only data.

### 5. Checkpoint, verify, rollback, journal

Every executed repair must:

1. create a bounded checkpoint;
2. apply one allowlisted repair handler;
3. run an explicit verification step;
4. keep the repair only when verification passes;
5. invoke its rollback handler when verification fails and rollback is available;
6. append bounded audit evidence to the repair journal.

Recovery files are path-contained inside explicit Khaos Nexus recovery/data roots.

### 6. Recovery Safe Mode

Repeated failures within a bounded crash window enter Recovery Safe Mode. Recovery Safe Mode disables automatic AI restart attempts until explicitly cleared through a trusted Owner path. It must not make the desktop unusable; core non-AI Khaos Nexus functionality remains available.

Future recovery work may use this state as an input to broader module-safe startup, but it must not silently broaden repair authority.

### 7. Adaptive resource governor

The local AI baseline is CPU-capable and low-resource. The governor selects a bounded runtime budget based on verified available resources and current pressure rather than a fixed GPU requirement.

Supported operating profiles are:

- **Eco** — tiny model tier, short context, one request, low CPU use.
- **Gaming** — automatically throttled model/context/concurrency while the machine is under game or system pressure.
- **Balanced** — normal desktop use with capacity scaled to available hardware.
- **AI Priority** — explicitly permits larger model/context/concurrency budgets when resources exist.

Unknown VRAM is treated conservatively; Khaos Nexus does not guess GPU capacity.

### 8. Provider and model portability

Veyra and Nexus Sentinel identities are independent from any model. The runtime may select among registered local, LAN, hosted, and optional API providers. API fallback is opt-in, not automatic.

Model registrations declare tier and resource requirements. The governor selects only models that fit the current verified budget.

This allows the same Khaos Nexus installation to move from a gaming PC to a rack or hosted inference service without redesigning the agents.

## Consequences

- Low-end computers remain supported, with reduced model/context budgets instead of failing installation.
- Stronger systems gain capability without requiring a different Khaos Nexus build.
- Common AI runtime failures can be recovered without unrestricted LLM execution rights.
- Repeated failures fail safe into Recovery Safe Mode rather than restart loops.
- Code/database/security repairs remain human-authorized even when Nexus Sentinel can generate a high-quality proposal.
- Public updater publication remains a separate Owner-authorized release action.
